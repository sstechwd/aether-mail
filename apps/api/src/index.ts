import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_ACCOUNT, FIXTURE_MAIL } from "./fixture.js";
import { runAgent, chatWithMail, type AgentSkill } from "./agent.js";
import { MailStore } from "./store.js";
import { PROVIDERS } from "./providers.js";
import { AccountBook, peekSecret } from "./accounts.js";
import { allowOrigin, MAX_BODY_BYTES, publicAccount, rejectCrossSite } from "./security.js";
import { LlmSettings } from "./llm.js";
import { ChatThread } from "./chat.js";
import { buildMailCliArgs, runMailCli } from "./mailio.js";
import { prepareSend } from "./send-prepare.js";
import { AuditLog } from "./audit.js";
import { PersonaBook } from "./persona.js";
import { scoreThreat } from "./threat.js";
import { SibylMemory } from "./sibyl.js";
import { applyWorkflows, compileWorkflows, WorkflowBook } from "./workflows.js";

const PORT = Number(process.env.AETHER_PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.AETHER_MAIL_FILE ?? path.resolve(here, "../../../data/mail.json");
const store = MailStore.openFile(dataFile);
if (store.listFolders(FIXTURE_ACCOUNT.id).length === 0) {
  store.loadFixture(FIXTURE_MAIL);
  store.save();
}
store.ensureFolder(FIXTURE_ACCOUNT.id, "Spam");
store.ensureFolder(FIXTURE_ACCOUNT.id, "Archive");
store.ensureFolder(FIXTURE_ACCOUNT.id, "Trash");
store.ensureFolder(FIXTURE_ACCOUNT.id, "Drafts");
const accounts = new AccountBook(path.resolve(here, "../../../data/accounts.json"));
const llm = new LlmSettings(path.resolve(here, "../../../data/llm.json"));
const workflows = new WorkflowBook(path.resolve(here, "../../../data/workflows.json"));
const audit = new AuditLog(path.resolve(here, "../../../data/audit.jsonl"));
const persona = new PersonaBook(path.resolve(here, "../../../data/persona.json"));
const sibyl = new SibylMemory(path.resolve(here, "../../../data/sibyl.db"));
const chat = new ChatThread();
let lastFetchAt: string | null = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(here, "../../../data/meta.json"), "utf8")) as {
      lastFetchAt?: string;
    };
    return raw.lastFetchAt ?? null;
  } catch {
    return null;
  }
})();

function rememberFetch(): void {
  lastFetchAt = new Date().toISOString();
  try {
    const p = path.resolve(here, "../../../data/meta.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ lastFetchAt }, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

type Draft = { messageId: string; text: string; updatedAt: string };
const drafts = new Map<string, Draft>();
const pendingSends = new Map<string, { to: string; subject: string; body: string; accountId: string; expires: number }>();
let activeAccountId: string = FIXTURE_ACCOUNT.id;

function runWorkflows(accountId: string): Array<{ id: string; apply: string[] }> {
  const rules = workflows.list();
  const applied: Array<{ id: string; apply: string[] }> = [];
  for (const id of store.idsForAccount(accountId)) {
    const mail = store.getMessage(id);
    if (!mail) continue;
    const out = applyWorkflows(rules, {
      id: mail.id,
      subject: mail.subject,
      from: mail.from,
      body: mail.body,
    });
    if (out.apply.includes("star")) store.setStarred(id, true);
    if (out.apply.includes("archive") && mail.folder === "INBOX") store.move(id, "Archive");
    if (out.apply.includes("file") && out.fileTo) {
      store.ensureFolder(accountId, out.fileTo);
      store.move(id, out.fileTo);
    }
    if (out.apply.includes("keep")) store.markUnread(id);
    if (out.apply.length) applied.push(out);
  }
  return applied;
}

function json(res: http.ServerResponse, status: number, body: unknown, origin?: string): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
  const allowed = allowOrigin(origin);
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  res.writeHead(status, headers);
  res.end(payload);
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c) => {
      const buf = c as Buffer;
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) return notFound(res);
  const origin = req.headers.origin;
  if (rejectCrossSite(origin)) {
    return json(res, 403, { error: "forbidden_origin" }, origin);
  }
  if (req.method === "OPTIONS") return json(res, 204, {}, origin);

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        account: { id: activeAccountId },
        lastFetchAt,
        unread: store.listFolders(activeAccountId).reduce((n, f) => n + (f.name === "Starred" ? 0 : f.unread), 0),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/folders") {
      return json(res, 200, { account: { id: activeAccountId }, folders: store.listFolders(activeAccountId) });
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      const folder = url.searchParams.get("folder") ?? "INBOX";
      return json(res, 200, { folder, messages: store.listMessages(activeAccountId, folder) });
    }

    if (req.method === "POST" && url.pathname.endsWith("/star") && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length, -"/star".length));
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { starred?: boolean };
      store.setStarred(id, Boolean(body.starred));
      return json(res, 200, { message: store.getMessage(id) }, origin);
    }

    if (req.method === "POST" && url.pathname.endsWith("/move") && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length, -"/move".length));
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { folder?: string };
      const folder = body.folder === "Trash" || body.folder === "Archive" || body.folder === "INBOX" ? body.folder : "";
      if (!folder) return json(res, 400, { error: "folder must be INBOX|Archive|Trash" }, origin);
      store.move(id, folder);
      return json(res, 200, { message: store.getMessage(id), folders: store.listFolders(FIXTURE_ACCOUNT.id) }, origin);
    }

    if (req.method === "POST" && url.pathname.endsWith("/unread") && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length, -"/unread".length));
      store.markUnread(id);
      return json(res, 200, { message: store.getMessage(id) }, origin);
    }

    if (req.method === "POST" && url.pathname.endsWith("/reply") && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length, -"/reply".length));
      try {
        const message = store.reply(id);
        return json(res, 201, { message, folders: store.listFolders(FIXTURE_ACCOUNT.id) }, origin);
      } catch (e) {
        return json(res, 404, { error: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "POST" && url.pathname.endsWith("/forward") && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length, -"/forward".length));
      try {
        const message = store.forward(id);
        return json(res, 201, { message, folders: store.listFolders(FIXTURE_ACCOUNT.id) }, origin);
      } catch (e) {
        return json(res, 404, { error: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "POST" && url.pathname === "/api/compose") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { to?: string; subject?: string; body?: string };
      if (!body.to || !body.subject) {
        return json(res, 400, { error: "need to and subject" }, origin);
      }
      const message = store.compose({
        accountId: FIXTURE_ACCOUNT.id,
        to: body.to,
        subject: body.subject,
        body: body.body ?? "",
      });
      return json(res, 201, { message, folders: store.listFolders(FIXTURE_ACCOUNT.id) }, origin);
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length));
      const message = store.getMessage(id);
      if (!message) return notFound(res);
      store.markRead(id);
      const threat = scoreThreat(message);
      return json(res, 200, { message, draft: drafts.get(id) ?? null, threat });
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      return json(res, 200, { q, messages: store.search(FIXTURE_ACCOUNT.id, q) });
    }

    if (req.method === "POST" && url.pathname === "/api/agent/run") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { messageId?: string; skill?: AgentSkill };
      const message = body.messageId ? store.getMessage(body.messageId) : undefined;
      const allowed = ["summarize", "draft-reply", "triage", "action-items"];
      if (!message || !body.skill || !allowed.includes(body.skill)) {
        return json(res, 400, { error: "need messageId and skill summarize|draft-reply|triage|action-items" });
      }
      const cfg = llm.resolve();
      const memory = await sibyl.promptBlock(`${message.from} ${message.subject}`).catch(() => "");
      const result = await runAgent({
        skill: body.skill,
        subject: message.subject,
        from: message.from,
        body: message.body,
        model: cfg.model,
        ollamaUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        provider: cfg.provider,
        allowCloud: cfg.allowCloud,
        voice: persona.promptBlock() || undefined,
        memory: memory || undefined,
      });
      if (result.skill === "draft-reply") {
        drafts.set(message.id, {
          messageId: message.id,
          text: result.text,
          updatedAt: new Date().toISOString(),
        });
      }
      return json(res, 200, { result, draft: drafts.get(message.id) ?? null });
    }

    if (req.method === "POST" && url.pathname === "/api/folders/read") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { folder?: string };
      const name = body.folder ?? "INBOX";
      store.markFolderRead(activeAccountId, name);
      return json(res, 200, { folders: store.listFolders(activeAccountId) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/folders") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { name?: string };
      const name = (body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "need name" }, origin);
      store.ensureFolder(activeAccountId, name);
      audit.append({ actor: "user", action: "folder.create", detail: name });
      return json(res, 201, { folders: store.listFolders(activeAccountId) }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/persona") {
      const p = persona.read();
      return json(res, 200, { count: p.samples.length, updatedAt: p.updatedAt }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/persona") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { sample?: string };
      try {
        const p = persona.add(body.sample ?? "");
        void sibyl.remember("voice", "user", { samples: p.samples.length, hint: (body.sample ?? "").slice(0, 200) });
        return json(res, 200, { count: p.samples.length }, origin);
      } catch (e) {
        return json(res, 400, { error: "bad_persona", message: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/providers") {
      return json(res, 200, { providers: PROVIDERS, hosting: false });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/accounts/") && !url.pathname.endsWith("/sync")) {
      const id = decodeURIComponent(url.pathname.slice("/api/accounts/".length));
      const row = accounts.get(id);
      const ok = accounts.remove(id);
      if (!ok) return json(res, 404, { error: "not_found" }, origin);
      if (row) {
        void runMailCli(buildMailCliArgs({ action: "secret-delete", secretRef: row.secret_ref }));
      }
      audit.append({ actor: "user", action: "account.remove", detail: id });
      return json(res, 200, { accounts: accounts.list().map(publicAccount) }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/accounts") {
      return json(res, 200, { accounts: accounts.list().map(publicAccount) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/accounts") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as {
        provider?: string;
        email?: string;
        username?: string;
        password?: string;
        display_name?: string;
        imap_host?: string;
        imap_port?: number;
        smtp_host?: string;
        smtp_port?: number;
      };
      try {
        const account = accounts.add({
          provider: body.provider ?? "custom",
          email: body.email ?? "",
          username: body.username,
          password: body.password,
          display_name: body.display_name,
          imap_host: body.imap_host,
          imap_port: body.imap_port,
          smtp_host: body.smtp_host,
          smtp_port: body.smtp_port,
        });
        const password = peekSecret(account.secret_ref) ?? "";
        const put = await runMailCli(
          buildMailCliArgs({ action: "secret-put", secretRef: account.secret_ref }),
          password,
        );
        let probeNote = put.ok
          ? "App password stored in the OS keyring (not in accounts.json)."
          : `Keyring CLI unavailable (${put.error}). Password is only in this process until restart.`;
        const probe = await runMailCli(
          buildMailCliArgs({
            action: "probe",
            secretRef: account.secret_ref,
            host: account.imap_host,
            port: account.imap_port,
            tls: account.imap_tls,
            username: account.username,
          }),
        );
        if (probe.ok) {
          probeNote += ` IMAP LOGIN+LIST ok (${(probe.folders ?? []).slice(0, 6).join(", ") || "folders"}).`;
        } else {
          probeNote += ` IMAP probe failed: ${probe.error}. Account metadata saved; mail not fetched.`;
        }
        return json(res, 201, {
          account: publicAccount(account),
          probe: probeNote,
          folders: probe.folders ?? [],
        }, origin);
      } catch (e) {
        return json(res, 400, { error: "bad_account", message: e instanceof Error ? e.message : String(e) });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/settings/llm") {
      return json(res, 200, { llm: llm.publicView() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/settings/llm") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as {
        provider?: string;
        baseUrl?: string;
        model?: string;
        apiKey?: string;
        allowCloud?: boolean;
      };
      try {
        return json(res, 200, { llm: llm.save(body) }, origin);
      } catch (e) {
        return json(res, 400, { error: "bad_llm", message: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/agent/chat") {
      return json(res, 200, { turns: chat.list(), llm: llm.publicView() }, origin);
    }

    if (req.method === "DELETE" && url.pathname === "/api/agent/chat") {
      chat.clear();
      return json(res, 200, { turns: [] }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/agent/chat") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { text?: string; messageId?: string };
      const text = (body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "need text" }, origin);
      const mail = body.messageId ? store.getMessage(body.messageId) : undefined;
      chat.add("user", text);
      const rememberMatch = text.match(/^(remember that|remember:|note that)\s+(.+)/i);
      if (rememberMatch) {
        const note = rememberMatch[2].slice(0, 800);
        const name = note.split(/\s+/).slice(0, 4).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "") || "note";
        try {
          await sibyl.remember("note", name, { text: note });
          await sibyl.journal(`remembered ${name}`);
          const summary = `Saved to Sibyl memory on this machine (not uploaded): ${note}`;
          chat.add("assistant", summary);
          audit.append({ actor: "user", action: "sibyl.remember", detail: name });
          return json(res, 200, { turns: chat.list(), result: { text: summary, model: "sibyl", refused: [] } }, origin);
        } catch (e) {
          return json(res, 500, { error: "sibyl", message: e instanceof Error ? e.message : String(e) }, origin);
        }
      }
      if (/what do you remember|show memory|list memory/i.test(text)) {
        const listed = await sibyl.list().catch(() => []);
        const summary = listed.length
          ? `Sibyl (local):\n${listed.map((h) => `• ${h.kind}/${h.name}`).join("\n")}`
          : "Sibyl memory is empty. Say “remember that …”";
        chat.add("assistant", summary);
        return json(res, 200, { turns: chat.list(), result: { text: summary, model: "sibyl", refused: [] } }, origin);
      }
      if (/^(what|list|show)\b.*\b(rule|workflow)/i.test(text) || /^(rules|workflows)\??$/i.test(text)) {
        const listed = workflows.publicList();
        const summary = listed.length
          ? `I have ${listed.length} rule(s):\n${listed.map((r) => `• ${r.action} — ${r.spoken}`).join("\n")}`
          : "No workflows yet. Tell me in English, e.g. star invoices.";
        chat.add("assistant", summary);
        return json(res, 200, { turns: chat.list(), result: { text: summary, model: "rules", refused: [] } }, origin);
      }
      try {
        const taught = compileWorkflows(text);
        if (taught.length) {
          for (const rule of taught) {
            workflows.add(rule);
            void sibyl.remember("workflow", rule.id, { spoken: rule.spoken, action: rule.action, folder: rule.folder });
          }
          const ran = runWorkflows(activeAccountId);
          const summary = `Saved ${taught.length} workflow(s): ${taught.map((r) => r.action + (r.folder ? " → " + r.folder : "")).join(", ")}. Applied to ${ran.length} messages. I will not send or delete.`;
          chat.add("assistant", summary);
          audit.append({ actor: "agent", action: "workflow.teach", detail: text.slice(0, 200) });
          return json(res, 200, { turns: chat.list(), result: { text: summary, model: "rules", refused: [] } }, origin);
        }
      } catch {
        /* not a workflow sentence — fall through to LLM */
      }
      const cfg = llm.resolve();
      const memory = await sibyl.promptBlock(text).catch(() => "");
      try {
        const result = await chatWithMail({
          history: chat.promptBlock(),
          userText: text,
          mail: mail ? { subject: mail.subject, from: mail.from, body: mail.body } : undefined,
          model: cfg.model,
          ollamaUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          provider: cfg.provider,
          allowCloud: cfg.allowCloud,
          memory: memory || undefined,
        });
        chat.add("assistant", result.text);
        return json(res, 200, { turns: chat.list(), result }, origin);
      } catch (e) {
        return json(res, 502, { error: "llm_failed", message: e instanceof Error ? e.message : String(e), turns: chat.list() }, origin);
      }
    }

    if (req.method === "POST" && url.pathname.endsWith("/sync") && url.pathname.startsWith("/api/accounts/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/accounts/".length, -"/sync".length));
      const account = accounts.get(id);
      if (!account) return json(res, 404, { error: "unknown_account" }, origin);
      const fetched = await runMailCli(
        buildMailCliArgs({
          action: "fetch",
          secretRef: account.secret_ref,
          host: account.imap_host,
          port: account.imap_port,
          tls: account.imap_tls,
          username: account.username,
          folder: "INBOX",
        }),
      );
      if (!fetched.ok) {
        return json(res, 502, { error: "fetch_failed", message: fetched.error }, origin);
      }
      store.loadFixture(
        (fetched.messages ?? []).map((m) => ({
          id: `${account.id}-${m.id}`,
          accountId: account.id,
          folder: m.folder || "INBOX",
          from: m.from,
          to: m.to,
          subject: m.subject,
          date: m.date || new Date().toISOString(),
          unread: m.unread,
          body: m.body,
        })),
      );
      store.save();
      activeAccountId = account.id;
      rememberFetch();
      const ran = runWorkflows(account.id);
      return json(res, 200, { folders: store.listFolders(account.id), count: fetched.messages?.length ?? 0, workflows: ran }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/workflows") {
      return json(res, 200, { workflows: workflows.publicList() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/workflows") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { spoken?: string };
      try {
        const added = compileWorkflows(body.spoken ?? "").map((rule) => workflows.add(rule));
        const ran = runWorkflows(activeAccountId);
        return json(res, 201, {
          workflow: added[0] ? { id: added[0].id, spoken: added[0].spoken, action: added[0].action } : null,
          workflows: added.map((r) => ({ id: r.id, spoken: r.spoken, action: r.action })),
          applied: ran,
        }, origin);
      } catch (e) {
        return json(res, 400, { error: "bad_workflow", message: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/workflows/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/workflows/".length));
      const ok = workflows.remove(id);
      if (!ok) return json(res, 404, { error: "not_found" }, origin);
      audit.append({ actor: "user", action: "workflow.remove", detail: id });
      return json(res, 200, { workflows: workflows.publicList() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/send") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as {
        confirmId?: string;
        messageId?: string;
        to?: string;
        subject?: string;
        draft?: { text?: string } | string;
        accountId?: string;
      };
      if (body.confirmId) {
        const pending = pendingSends.get(body.confirmId);
        if (!pending || pending.expires < Date.now()) {
          return json(res, 410, { error: "confirm_expired", message: "Confirm again. Send tokens last 5 minutes." }, origin);
        }
        pendingSends.delete(body.confirmId);
        const account = accounts.get(pending.accountId);
        if (!account) {
          return json(res, 400, { error: "no_account", message: "Add a mail account in Settings first." }, origin);
        }
        const sent = await runMailCli(
          buildMailCliArgs({
            action: "send",
            secretRef: account.secret_ref,
            username: account.username,
            smtpHost: account.smtp_host,
            smtpPort: account.smtp_port,
            from: account.email,
            to: pending.to,
            subject: pending.subject,
          }),
          pending.body,
        );
        if (!sent.ok) {
          return json(res, 502, { error: "smtp_failed", message: sent.error }, origin);
        }
        return json(res, 200, { sent: true }, origin);
      }
      const src = body.messageId ? store.getMessage(body.messageId) : undefined;
      let prepared: { to: string; subject: string; body: string };
      try {
        prepared = prepareSend({
          draft: body.draft,
          to: body.to,
          subject: body.subject,
          source: src ?? null,
        });
      } catch (e) {
        return json(res, 400, { error: "need_to_and_body", message: e instanceof Error ? e.message : String(e) }, origin);
      }
      const confirmId = `send-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const accountId = body.accountId || accounts.list()[0]?.id;
      if (!accountId) {
        return json(res, 409, {
          error: "send_not_wired",
          message: "Add a real mail account in Settings, then Confirm send. SMTP is not available on the fixture inbox.",
          preview: prepared,
        }, origin);
      }
      pendingSends.set(confirmId, {
        to: prepared.to,
        subject: prepared.subject,
        body: prepared.body,
        accountId,
        expires: Date.now() + 5 * 60 * 1000,
      });
      audit.append({ actor: "user", action: "send.prepare", detail: `to=${prepared.to}` });
      return json(res, 202, {
        confirmId,
        preview: { to: prepared.to, subject: prepared.subject },
        message: "Click Confirm send again to actually deliver. The agent cannot do this for you.",
      }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      return json(res, 200, { events: audit.list() }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/memory") {
      const hits = await sibyl.list().catch(() => []);
      return json(res, 200, { hits, backend: "sibyl-memory-client" }, origin);
    }

    return notFound(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(res, 500, { error: "server_error", message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`aether-api listening on http://127.0.0.1:${PORT}\n`);
});
