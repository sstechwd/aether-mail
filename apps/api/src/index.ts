import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_ACCOUNT, FIXTURE_MAIL } from "./fixture.js";
import { runAgent, type AgentSkill } from "./agent.js";
import { MailStore } from "./store.js";
import { PROVIDERS } from "./providers.js";
import { AccountBook } from "./accounts.js";

const PORT = Number(process.env.AETHER_PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.AETHER_MAIL_FILE ?? path.resolve(here, "../../../data/mail.json");
const store = MailStore.openFile(dataFile);
if (store.listFolders(FIXTURE_ACCOUNT.id).length === 0) {
  store.loadFixture(FIXTURE_MAIL);
  store.save();
}
const accounts = new AccountBook(path.resolve(here, "../../../data/accounts.json"));

type Draft = { messageId: string; text: string; updatedAt: string };
const drafts = new Map<string, Draft>();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) return notFound(res);
  if (req.method === "OPTIONS") return json(res, 204, {});

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, account: FIXTURE_ACCOUNT, ollama: "http://127.0.0.1:11434" });
    }

    if (req.method === "GET" && url.pathname === "/api/folders") {
      return json(res, 200, { account: FIXTURE_ACCOUNT, folders: store.listFolders(FIXTURE_ACCOUNT.id) });
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      const folder = url.searchParams.get("folder") ?? "INBOX";
      return json(res, 200, { folder, messages: store.listMessages(FIXTURE_ACCOUNT.id, folder) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length));
      const message = store.getMessage(id);
      if (!message) return notFound(res);
      store.markRead(id);
      return json(res, 200, { message, draft: drafts.get(id) ?? null });
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      return json(res, 200, { q, messages: store.search(FIXTURE_ACCOUNT.id, q) });
    }

    if (req.method === "POST" && url.pathname === "/api/agent/run") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { messageId?: string; skill?: AgentSkill };
      const message = body.messageId ? store.getMessage(body.messageId) : undefined;
      if (!message || (body.skill !== "summarize" && body.skill !== "draft-reply")) {
        return json(res, 400, { error: "need messageId and skill summarize|draft-reply" });
      }
      const result = await runAgent({
        skill: body.skill,
        subject: message.subject,
        from: message.from,
        body: message.body,
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

    if (req.method === "GET" && url.pathname === "/api/providers") {
      return json(res, 200, { providers: PROVIDERS, hosting: false });
    }

    if (req.method === "GET" && url.pathname === "/api/accounts") {
      return json(res, 200, { accounts: accounts.list() });
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
        return json(res, 201, {
          account,
          probe: "saved locally; IMAP LOGIN probe is the next Rust slice. Password is not in accounts.json.",
        });
      } catch (e) {
        return json(res, 400, { error: "bad_account", message: e instanceof Error ? e.message : String(e) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/send") {
      return json(res, 409, {
        error: "send_not_wired",
        message: "Send requires an explicit human confirm and SMTP is not connected in this MVP. Draft is saved locally only.",
      });
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
