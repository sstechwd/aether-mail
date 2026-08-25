import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { appRoot } from "./approot.js";
import { FIXTURE_ACCOUNT, FIXTURE_MAIL } from "./fixture.js";
import { runAgent, chatWithMail, type AgentSkill } from "./agent.js";
import { SqlStore } from "./sqlstore.js";
import { PROVIDERS } from "./providers.js";
import { AccountBook, peekSecret } from "./accounts.js";
import { corsHeaders, MAX_BODY_BYTES, publicAccount, rejectCrossSite } from "./security.js";
import { LlmSettings } from "./llm.js";
import { ChatThread } from "./chat.js";
import { buildMailCliArgs, runMailCli } from "./mailio.js";
import { prepareSend } from "./send-prepare.js";
import { AuditLog } from "./audit.js";
import { PersonaBook } from "./persona.js";
import { scoreThreat } from "./threat.js";
import { inspectHeaders, inspectSummary } from "./inspect.js";
import { InspectBook } from "./inspect-prefs.js";
import { readableBody, toIsoDate, countHiddenMedia } from "./mailtext.js";
import { looksLikeHtml, remoteImageCount, sanitizeMailHtml } from "./html-mail.js";
import {
  attachmentStrip,
  inlineCidImages,
  safeFilename,
  type LoadedPart,
  type MailAttachment,
} from "./attachments.js";
import { buildReply, buildForward } from "./reply.js";
import { Outbox } from "./outbox.js";
import { canonicalFolder, pickSyncFolders, sortFolders } from "./folders.js";
import { isCalendarPart, parseIcs, toIcsFile } from "./ics.js";
import { SignatureBook, applySignature } from "./signatures.js";
import { harvestContacts, suggestContacts } from "./contacts.js";
import { groupIntoThreads, normalizeSubject } from "./threading.js";
import { parseJsonBody, asString, asStringArray } from "./reqbody.js";
import { sanitizeComposedHtml, htmlToPlainText, hasFormatting } from "./compose-html.js";
import { CalendarStore } from "./calendar.js";
import { ImagePolicy } from "./imagepolicy.js";
import { RuleBook } from "./rules.js";
import { SnoozeBook, snoozeUntil, type SnoozePreset } from "./snooze.js";
import { MuteBook } from "./mute.js";
import { mergeAccounts } from "./unified.js";
import { createBackup, listBackupContents, restoreBackup } from "./backup.js";
import { parseProposal, describeProposal, PROPOSAL_SCHEMA } from "./agent-tools.js";
import { providerOAuth, buildAuthUrl, exchangeCode, refreshAccessToken } from "./oauth.js";
import { TokenCache } from "./tokencache.js";
import { ensureFreshToken, type RefreshDeps } from "./tokenrefresh.js";
import { SyncState, planFetch } from "./syncstate.js";
import { findBulkSenders } from "./bulksenders.js";
import { parseUnsubscribe } from "./unsubscribe.js";
import { buildConversation } from "./conversation.js";
import { previewKind } from "./attachpreview.js";
import { fetchFolderFor } from "./remotefolder.js";
import { TemplateBook } from "./templates.js";
import { THEMES } from "./themes.js";
import { usageSnapshot } from "./usage.js";
import { SibylMemory } from "./sibyl.js";
import { resolveAccountSwitch } from "./account-switch.js";
import { applyWorkflows, compileWorkflows, WorkflowBook } from "./workflows.js";

const PORT = Number(process.env.AETHER_PORT ?? 8787);
const here = appRoot();
const dataFile = process.env.AETHER_MAIL_FILE ?? path.join(here, "data/mail.json");
/*
 * Mail lives in SQLite.
 *
 * The JSON store held every message — bodies, HTML and all — in memory and
 * rewrote the whole file on any change: 7.9 MB for 246 messages, so roughly
 * 325 MB at 10,000. SqlStore keeps bodies on disk, indexes them with FTS5, and
 * migrates the old mail.json across exactly once on first run.
 *
 * AETHER_MAIL_FILE still points at the JSON path so the migration knows where
 * to look; the database sits beside it.
 */
const dbFile = process.env.AETHER_MAIL_DB ?? path.join(here, "data/mail.db");
const store = SqlStore.openFile(dbFile, dataFile);
if (store.listFolders(FIXTURE_ACCOUNT.id).length === 0) {
  store.loadFixture(FIXTURE_MAIL);
  store.save();
} else {
  store.fillMissingHeaders(FIXTURE_MAIL);
}
store.ensureFolder(FIXTURE_ACCOUNT.id, "Spam");
store.ensureFolder(FIXTURE_ACCOUNT.id, "Archive");
store.ensureFolder(FIXTURE_ACCOUNT.id, "Trash");
store.ensureFolder(FIXTURE_ACCOUNT.id, "Drafts");
const accounts = new AccountBook(path.join(here, "data/accounts.json"));
const llm = new LlmSettings(path.join(here, "data/llm.json"));
const workflows = new WorkflowBook(path.join(here, "data/workflows.json"));
const audit = new AuditLog(path.join(here, "data/audit.jsonl"));
const persona = new PersonaBook(path.join(here, "data/persona.json"));
const sibyl = new SibylMemory(path.join(here, "data/sibyl.db"));
const templates = new TemplateBook(path.join(here, "data/templates.json"));
const inspectPrefs = new InspectBook(path.join(here, "data/inspect.json"));
const outbox = Outbox.openFile(path.join(here, "data/outbox.json"));
const signatures = SignatureBook.openFile(path.join(here, "data/signatures.json"));
const calendar = CalendarStore.openFile(path.join(here, "data/calendar.json"));
const imagePolicy = ImagePolicy.openFile(path.join(here, "data/images.json"));
const ruleBook = RuleBook.openFile(path.join(here, "data/rules.json"));
const snoozeBook = SnoozeBook.openFile(path.join(here, "data/snooze.json"));
const muteBook = MuteBook.openFile(path.join(here, "data/mute.json"));

/*
 * OAuth access tokens, and how to renew them.
 *
 * Only the short-lived access token is cached here; the refresh token stays in
 * the OS keyring. Dependencies are passed as an object so the refresh decision
 * logic stays unit-testable without a network or a keyring.
 */
const tokenCache = TokenCache.openFile(path.join(here, "data/tokens.json"));

/*
 * Where each folder's sync got to, so a fetch asks only for what is new
 * instead of pulling the newest 40 with full bodies every few minutes.
 */
const syncState = SyncState.openFile(path.join(here, "data/syncstate.json"));

const refreshDeps: RefreshDeps = {
  clientIdFor: (provider) => process.env[`AETHER_OAUTH_CLIENT_${provider.toUpperCase()}`] ?? "",
  loadRefreshToken: (secretRef) => {
    // Stored beside the access token when the user signed in.
    const raw = peekSecret(`${secretRef}:refresh`);
    return raw ?? "";
  },
  refresh: async (provider, clientId, refreshToken) => {
    const cfg = providerOAuth(provider);
    if (!cfg) return null;
    return refreshAccessToken(cfg, clientId, refreshToken);
  },
  storeAccessToken: (secretRef, accessToken, refreshToken) => {
    // Both go to the keyring: the CLI reads the access token, and the refresh
    // token may have been rotated by the provider.
    void runMailCli(buildMailCliArgs({ action: "secret-put", secretRef }), `oauth2:${accessToken}`);
    void runMailCli(
      buildMailCliArgs({ action: "secret-put", secretRef: `${secretRef}:refresh` }),
      refreshToken,
    );
  },
};

/**
 * Wake any snoozed message whose time has come, and put it back where it was.
 *
 * Runs at startup and on a tick, the same way the Outbox drains — so a snooze
 * set before closing the app still fires when it reopens.
 */
function wakeSnoozed(): void {
  const due = snoozeBook.due(Date.now());
  if (due.length === 0) return;
  for (const item of due) {
    if (store.getMessage(item.id)) store.move(item.id, item.from);
    snoozeBook.remove(item.id);
  }
  store.saveNow();
  audit.append({ actor: "workflow", action: "snooze.wake", detail: `${due.length} message(s)` });
}
/**
 * Addresses the user removed from Contacts. Kept separately from the mail
 * store: the message they came from is still there, so without this list a
 * removed contact would reappear on the next sync.
 */
const hiddenContactsPath = path.join(here, "data/hidden-contacts.json");
function readHiddenContacts(): string[] {
  try {
    const rows = JSON.parse(fs.readFileSync(hiddenContactsPath, "utf8")) as string[];
    return Array.isArray(rows) ? rows.filter((r) => typeof r === "string") : [];
  } catch {
    return [];
  }
}
function writeHiddenContacts(rows: string[]): void {
  fs.mkdirSync(path.dirname(hiddenContactsPath), { recursive: true });
  fs.writeFileSync(hiddenContactsPath, JSON.stringify([...new Set(rows)]), "utf8");
}
const chat = new ChatThread();
const metaPath = path.join(here, "data/meta.json");
type MetaFile = { lastFetchAt?: string; activeAccountId?: string };
function readMeta(): MetaFile {
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as MetaFile;
  } catch {
    return {};
  }
}
function writeMeta(next: MetaFile): void {
  try {
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(next, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}
const bootMeta = readMeta();
let lastFetchAt: string | null = bootMeta.lastFetchAt ?? null;
let activeAccountId: string = bootMeta.activeAccountId || FIXTURE_ACCOUNT.id;
if (activeAccountId !== FIXTURE_ACCOUNT.id && !accounts.get(activeAccountId)) {
  activeAccountId = FIXTURE_ACCOUNT.id;
}

function rememberFetch(): void {
  lastFetchAt = new Date().toISOString();
  writeMeta({ lastFetchAt, activeAccountId });
}

function rememberActive(id: string): void {
  activeAccountId = id;
  writeMeta({ lastFetchAt: lastFetchAt ?? undefined, activeAccountId });
}

type Draft = { messageId: string; text: string; updatedAt: string };
const drafts = new Map<string, Draft>();
/** Mail servers commonly reject over ~25MB; refuse before uploading. */
const MAX_ATTACH_TOTAL = 24 * 1024 * 1024;
/** Sanity cap on how many files one message can carry. */
const MAX_ATTACHMENTS = 20;

const pendingSends = new Map<string, { to: string; subject: string; body: string; html?: string; accountId: string; expires: number; attachments?: string[]; sendAt?: number | null }>();
/**
 * In-flight OAuth sign-ins, keyed by state.
 *
 * In memory on purpose: an interrupted sign-in should expire, not persist. Ten
 * minutes is longer than any real consent screen takes.
 */
const pendingOAuth = new Map<
  string,
  { provider: string; verifier: string; email: string; expires: number }
>();

/**
 * Inline image bytes, pulled on demand from the user's own IMAP server.
 * Bounded on purpose: a mailbox of newsletters would otherwise pin megabytes of
 * base64 in RAM for the life of the process.
 */
const inlineCache = new Map<string, Record<string, LoadedPart>>();
const INLINE_CACHE_MAX = 12;

async function loadInlineParts(
  message: { id: string; accountId: string; uid?: string; folder: string },
  parts: MailAttachment[],
): Promise<Record<string, LoadedPart>> {
  const cached = inlineCache.get(message.id);
  if (cached) return cached;
  const account = accounts.get(message.accountId);
  if (!account || !message.uid) return {};
  const wanted = parts.filter(
    (p) => p.inline && p.contentId && p.mimeType.toLowerCase().startsWith("image/"),
  );
  const out: Record<string, LoadedPart> = {};
  for (const part of wanted.slice(0, 8)) {
    const result = await runMailCli(
      buildMailCliArgs({
        action: "part",
        secretRef: account.secret_ref,
        host: account.imap_host,
        port: account.imap_port,
        tls: account.imap_tls,
        username: account.username,
        folder: fetchFolderFor(message),
        uid: message.uid,
        part: part.part,
      }),
    );
    if (result.ok && result.part && part.contentId) {
      out[part.contentId] = { mimeType: result.part.mime_type, data: result.part.data };
    }
  }
  if (inlineCache.size >= INLINE_CACHE_MAX) {
    const oldest = inlineCache.keys().next().value;
    if (oldest) inlineCache.delete(oldest);
  }
  inlineCache.set(message.id, out);
  return out;
}

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

/**
 * The Origin of the request currently being served.
 *
 * Every handler used to have to remember to pass `origin` into json(); most did
 * not, so data routes returned 200 with no Access-Control-Allow-Origin and the
 * packaged webview silently discarded them. Node handles one request at a time
 * per tick here, so a module-level value is safe and removes the whole class of
 * bug rather than fixing call sites one by one.
 */
let currentOrigin: string | undefined;

function json(res: http.ServerResponse, status: number, body: unknown, origin?: string): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin ?? currentOrigin),
  };
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

/**
 * Deliver one queued message over SMTP.
 *
 * Shared by the immediate-send path and the outbox worker so scheduled mail
 * goes out through exactly the same code as mail sent right now — no second
 * implementation to drift.
 */
async function deliver(item: {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  /** Already-sanitized HTML; present only when the user formatted the mail. */
  html?: string;
  attachments?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const account = accounts.get(item.accountId);
  if (!account) return { ok: false, error: "no_account" };
  const result = await runMailCli(
    buildMailCliArgs({
      action: "send",
      secretRef: account.secret_ref,
      username: account.username,
      smtpHost: account.smtp_host,
      smtpPort: account.smtp_port,
      from: account.email,
      to: item.to,
      subject: item.subject,
    }),
    JSON.stringify({ body: item.body, html: item.html, attachments: item.attachments ?? [] }),
  );
  return { ok: Boolean(result.ok), error: result.error };
}

/**
 * Outbox worker. Wakes every 30s, sends whatever is due, and records failures
 * so the user can see them. `claimDue` marks items in flight, so a slow SMTP
 * server cannot cause the same message to be sent twice by an overlapping tick.
 */
let draining = false;
async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const due = outbox.claimDue(Date.now());
    for (const item of due) {
      const sent = await deliver(item);
      if (sent.ok) {
        outbox.markSent(item.id);
        audit.append({ actor: "user", action: "outbox.sent", detail: `to=${item.to}` });
      } else {
        outbox.markFailed(item.id, sent.error ?? "send failed");
        audit.append({ actor: "user", action: "outbox.failed", detail: `to=${item.to}` });
      }
    }
  } catch {
    // A worker crash must never take the API down.
  } finally {
    draining = false;
  }
}

const outboxTimer = setInterval(() => {
  void drainOutbox();
  // Snoozed mail wakes on the same tick — one scheduler, two queues.
  wakeSnoozed();
}, 30_000);
if (typeof outboxTimer.unref === "function") outboxTimer.unref();

/*
 * Automatic mail sync.
 *
 * Mail that only arrives when you press a button is not a mail client, it is a
 * viewer. Every account is synced on an interval and once shortly after start.
 *
 * Deliberately conservative: a five-minute default, skipped entirely while a
 * manual sync is running so the two cannot overlap on the same mailbox, and a
 * single failure is logged rather than retried aggressively — a wrong password
 * should not become a login-attempt flood at someone's provider.
 */
const AUTO_SYNC_MS = Number(process.env.AETHER_SYNC_MS ?? 5 * 60 * 1000);
let autoSyncRunning = false;

async function autoSyncAll(): Promise<void> {
  if (autoSyncRunning) return;
  autoSyncRunning = true;
  try {
    for (const account of accounts.list()) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/accounts/${account.id}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://tauri.localhost" },
          body: "{}",
        });
        if (!r.ok) console.warn(`auto-sync: ${account.email} -> HTTP ${r.status}`);
      } catch (e) {
        console.warn(`auto-sync failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    autoSyncRunning = false;
  }
}

if (AUTO_SYNC_MS > 0) {
  const syncTimer = setInterval(() => void autoSyncAll(), AUTO_SYNC_MS);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
  // Not at t=0: let the server finish binding before hitting its own port.
  const firstSync = setTimeout(() => void autoSyncAll(), 20_000);
  if (typeof firstSync.unref === "function") firstSync.unref();
}

/*
 * IMAP IDLE — push instead of polling.
 *
 * The interval above is the floor, not the mechanism. IDLE (RFC 2177) holds a
 * connection open and the server speaks the moment mail arrives, so mail shows
 * up immediately rather than "within five minutes".
 *
 * The CLI does one wait per invocation and exits. The loop lives here so the
 * retry policy stays in one place and a crashed child costs one restart rather
 * than a wedged daemon.
 *
 * Failures back off instead of hammering: a server that refuses IDLE, or a
 * laptop that just closed its lid, must not become a reconnect storm at
 * someone's provider. The polling timer keeps running underneath, so if IDLE
 * never works the app degrades to exactly its previous behaviour.
 */
const IDLE_ENABLED = process.env.AETHER_IDLE !== "0";
const IDLE_WINDOW_S = Number(process.env.AETHER_IDLE_WINDOW ?? 600);
const idleStopped = new Set<string>();

async function idleLoop(accountId: string): Promise<void> {
  let backoffMs = 5_000;

  for (;;) {
    if (idleStopped.has(accountId)) return;
    const account = accounts.get(accountId);
    if (!account) return;

    try {
      const fresh = await ensureFreshToken(account, tokenCache, refreshDeps);
      if (!fresh.ok) {
        // Signed out: stop rather than loop on a credential that cannot work.
        console.warn(`idle: ${fresh.reason}`);
        return;
      }

      const result = await runMailCli(
        buildMailCliArgs({
          action: "idle",
          secretRef: account.secret_ref,
          host: account.imap_host,
          port: account.imap_port,
          tls: account.imap_tls,
          username: account.username,
          folder: "INBOX",
          timeout: IDLE_WINDOW_S,
        }),
      );

      if (!result.ok) throw new Error(result.error ?? "idle failed");
      backoffMs = 5_000;

      // Woke on activity: fetch. Woke on timeout: loop and idle again.
      if (result.woke === "activity") {
        await autoSyncAll();
      }
    } catch (e) {
      console.warn(`idle: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, backoffMs));
      // Cap at five minutes: past that the polling timer covers us anyway.
      backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
    }
  }
}

if (IDLE_ENABLED) {
  const startIdle = setTimeout(() => {
    for (const account of accounts.list()) void idleLoop(account.id);
  }, 25_000);
  if (typeof startIdle.unref === "function") startIdle.unref();
}
// Catch anything that came due while the app was closed.
setTimeout(() => {
  void drainOutbox();
  wakeSnoozed();
}, 3_000).unref?.();

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) return notFound(res);
  const origin = req.headers.origin;
  // Remember it for this request so every json() response carries CORS.
  currentOrigin = origin;
  if (rejectCrossSite(origin)) {
    return json(res, 403, { error: "forbidden_origin" }, origin);
  }
  if (req.method === "OPTIONS") {
    // Preflight must answer with the CORS headers, not a bare 204.
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

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
      const order = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
      const messages = store.listMessages(activeAccountId, folder, order);
      // Threading is opt-in per request so the flat list stays available and
      // the client can toggle without a resync.
      if (url.searchParams.get("threaded") === "1") {
        // Group from the full rows: envelopes deliberately omit `headers`, and
        // References/In-Reply-To live there. Only the envelope of the newest
        // message is returned, so the response stays envelope-sized.
        const full = store.allForAccount(activeAccountId).filter((m) => {
          if (folder === "Starred") return Boolean(m.starred);
          return m.folder === folder;
        });
        const envelopeById = new Map(messages.map((m) => [m.id, m]));
        const threads = groupIntoThreads(full).map((t) => ({
          ...(envelopeById.get(t.latest.id) ?? t.latest),
          threadKey: t.key,
          threadCount: t.count,
          unread: t.unread,
          participants: t.participants,
          threadIds: t.ids,
        }));
        return json(res, 200, { folder, account: activeAccountId, sort: order, threaded: true, messages: threads });
      }
      return json(res, 200, {
        folder,
        account: activeAccountId,
        sort: order,
        messages,
      });
    }

    if (req.method === "POST" && url.pathname.endsWith("/star") && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length, -"/star".length));
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { starred?: boolean };
      store.setStarred(id, Boolean(body.starred));
      return json(res, 200, { message: store.getMessage(id) }, origin);
    }

    /**
     * Act on many messages at once.
     *
     * Multi-select without a bulk route means 40 round trips to clear 40
     * newsletters, each re-writing the store. One call, one write.
     *
     * Note this is a UI convenience only: it moves and flags, and there is no
     * bulk send. The agent still has no path to either.
     */
    if (req.method === "POST" && url.pathname === "/api/messages/bulk") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const ids = asStringArray(body.ids, 500);
      const action = asString(body.action);
      if (ids.length === 0) return json(res, 400, { error: "no_ids" }, origin);
      // Validate the action before touching anything. Doing it inside the loop
      // meant an unknown action returned 200 whenever none of the ids existed.
      if (!["move", "read", "unread", "star", "unstar"].includes(action)) {
        return json(res, 400, { error: "unknown_action" }, origin);
      }
      const moveTo = action === "move" ? asString(body.folder, "", 200) : "";
      if (action === "move" && !moveTo) return json(res, 400, { error: "no_folder" }, origin);

      const done: string[] = [];
      for (const id of ids) {
        const msg = store.getMessage(id);
        if (!msg) continue;
        if (action === "move") {
          store.move(id, moveTo);
        } else if (action === "read") {
          store.markRead(id);
        } else if (action === "unread") {
          store.markUnread(id);
        } else if (action === "star") {
          store.setStarred(id, true);
        } else if (action === "unstar") {
          store.setStarred(id, false);
        }
        done.push(id);
      }
      store.saveNow();
      audit.append({ actor: "user", action: `bulk.${action}`, detail: `${done.length} message(s)` });
      return json(res, 200, { done, folders: store.listFolders(activeAccountId) }, origin);
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

    /*
     * The whole conversation around one message.
     *
     * The list already groups threads, but opening one used to show a single
     * message, so a reply was read with its own question missing. 86 of 180
     * live inbox messages sit in multi-message threads.
     *
     * Must sit ABOVE the catch-all GET /api/messages/:id below, which would
     * otherwise match this path first and return a single message.
     */
    if (req.method === "GET" && url.pathname.startsWith("/api/messages/") && url.pathname.endsWith("/conversation")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/messages/".length, -"/conversation".length),
      );
      const message = store.getMessage(id);
      if (!message) return json(res, 404, { error: "unknown_message" }, origin);

      // Search the folder the message actually lives in, not the active view:
      // a conversation opened from search may span a different folder.
      const convo = buildConversation(
        store.listMessages(message.accountId, message.folder, "newest"),
        id,
      );

      return json(
        res,
        200,
        {
          focusId: convo.focusId,
          unread: convo.unread,
          truncated: convo.truncated,
          // Envelopes only. Bodies are fetched per message as they open, so a
          // 40-message thread does not drag 40 HTML payloads into the pane.
          messages: convo.messages.map((m) => ({
            id: m.id,
            from: m.from,
            to: m.to,
            subject: m.subject,
            date: m.date,
            unread: m.unread,
            preview: m.preview,
          })),
        },
        origin,
      );
    }

    /*
     * Unsubscribe.
     *
     * Filing a newsletter hides it; unsubscribing stops it. 93 of 180 messages
     * in the live inbox carry List-Unsubscribe and 90 support RFC 8058
     * One-Click, so this is worth doing properly.
     *
     * GET reports what is possible. The POST below performs it, and only for
     * an https endpoint — a mailto: unsubscribe means SENDING MAIL, which is
     * the one capability this app withholds, so it is handed to the human
     * confirm-to-send path instead of being actioned here.
     */
    if (req.method === "GET" && url.pathname.startsWith("/api/messages/") && url.pathname.endsWith("/unsubscribe")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/messages/".length, -"/unsubscribe".length),
      );
      const message = store.getMessage(id);
      if (!message) return json(res, 404, { error: "unknown_message" }, origin);
      const found = parseUnsubscribe(message.headers ?? "");
      if (!found) return json(res, 200, { available: false }, origin);
      return json(res, 200, { available: true, ...found }, origin);
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/messages/") && url.pathname.endsWith("/unsubscribe")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/messages/".length, -"/unsubscribe".length),
      );
      const message = store.getMessage(id);
      if (!message) return json(res, 404, { error: "unknown_message" }, origin);

      const found = parseUnsubscribe(message.headers ?? "");
      if (!found?.url) {
        /*
         * Either there is no unsubscribe, or it is mailto-only. Both are a
         * refusal here. The URL is re-parsed from the stored headers rather
         * than accepted from the client, so a hostile page cannot talk this
         * endpoint into fetching an arbitrary address.
         */
        return json(
          res,
          409,
          {
            error: "not_actionable",
            message: found?.mailto
              ? "This sender only accepts unsubscribe by email. Aether will not send mail on your behalf — use Compose to send it yourself."
              : "No unsubscribe link in this message.",
            mailto: found?.mailto,
          },
          origin,
        );
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(found.url, {
          // RFC 8058 One-Click is a POST; anything else gets a plain GET.
          method: found.oneClick ? "POST" : "GET",
          headers: found.oneClick
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : undefined,
          body: found.oneClick ? "List-Unsubscribe=One-Click" : undefined,
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timer);

        audit.append({
          actor: "user",
          action: "unsubscribe",
          detail: `${found.fromDomain ?? "unknown"} -> HTTP ${response.status}`,
        });

        return json(
          res,
          200,
          {
            ok: response.ok,
            status: response.status,
            oneClick: found.oneClick,
            // Honest about the limit: a 200 means the request was accepted,
            // not that the sender actually honoured it.
            message: response.ok
              ? "Unsubscribe request sent. Senders can take a few days to stop."
              : `The sender's unsubscribe page returned ${response.status}.`,
          },
          origin,
        );
      } catch (e) {
        return json(
          res,
          502,
          {
            error: "unreachable",
            message: `Could not reach the unsubscribe address: ${
              e instanceof Error ? e.message : String(e)
            }`,
          },
          origin,
        );
      }
    }

    // Download one attachment. Bytes come straight from the user's IMAP server
    // via aether-cli; the API never stores them on disk.
    if (req.method === "GET" && /^\/api\/messages\/.+\/parts\/\d+$/.test(url.pathname)) {
      const [, rawId, rawPart] = url.pathname.match(/^\/api\/messages\/(.+)\/parts\/(\d+)$/) ?? [];
      const message = store.getMessage(decodeURIComponent(rawId ?? ""));
      if (!message) return notFound(res);
      const account = accounts.get(message.accountId);
      const meta = (message.attachments ?? []).find((a) => a.part === Number(rawPart));
      if (!account || !meta || !message.uid) {
        return json(res, 404, { error: "no_such_part" }, origin);
      }
      const result = await runMailCli(
        buildMailCliArgs({
          action: "part",
          secretRef: account.secret_ref,
          host: account.imap_host,
          port: account.imap_port,
          tls: account.imap_tls,
          username: account.username,
          folder: fetchFolderFor(message),
          uid: message.uid,
          part: meta.part,
        }),
      );
      if (!result.ok || !result.part) {
        return json(res, 502, { error: "part_failed", message: result.error }, origin);
      }
      const bytes = Buffer.from(result.part.data, "base64");

      /*
       * ?preview=1 renders in-app instead of downloading.
       *
       * The content-type is decided HERE from an allow-list, never echoed
       * from the sender's claim, and only for types we can display safely.
       * Anything else still downloads, so a mislabelled executable cannot
       * talk the webview into rendering it.
       *
       * `inline` disposition + `nosniff` + a CSP that forbids scripts means
       * even a hostile file that reaches this path cannot execute.
       */
      const wantsPreview = url.searchParams.get("preview") === "1";
      const kind = previewKind(meta.mimeType ?? "", meta.filename ?? "");
      if (wantsPreview && kind !== "none") {
        const safeType =
          kind === "pdf"
            ? "application/pdf"
            : kind === "text"
              ? "text/plain; charset=utf-8"
              : (meta.mimeType ?? "").split(";")[0].trim().toLowerCase();
        res.writeHead(200, {
          "content-type": safeType,
          "content-length": String(bytes.length),
          "content-disposition": `inline; filename="${safeFilename(meta.filename).replace(/"/g, "")}"`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; img-src 'self' data:; object-src 'none'; script-src 'none'",
          ...corsHeaders(origin),
        });
        res.end(bytes);
        return;
      }

      // attachment; disposition + a sanitized name: never let mail name a path.
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.length),
        "content-disposition": `attachment; filename="${safeFilename(meta.filename).replace(/"/g, "")}"`,
        "x-content-type-options": "nosniff",
        ...corsHeaders(origin),
      });
      res.end(bytes);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/messages/".length));
      const message = store.getMessage(id);
      if (!message) return notFound(res);
      store.markRead(id);
      const threat = scoreThreat(message);
      const prefs = inspectPrefs.read();
      const inspect = message.headers ? inspectHeaders(message.headers) : null;
      if (inspect && inspect.label !== "ok") {
        for (const f of inspect.findings) {
          if (!threat.reasons.includes(f)) threat.reasons.push(f);
        }
        if (inspect.label === "danger" && threat.score < 70) {
          threat.score = 70;
          threat.label = "danger";
        } else if (inspect.label === "caution" && threat.label === "ok") {
          threat.label = "caution";
          threat.score = Math.max(threat.score, 40);
        }
      }
      const autoOpen = Boolean(
        inspect && ((prefs.autoInspect && inspect.label !== "ok") || prefs.alwaysShow),
      );
      // The explicit ?images= param wins for this one view; otherwise the
      // remembered policy decides, so a trusted sender loads without a click.
      const imagesParam = url.searchParams.get("images");
      const allowImages =
        imagesParam === "1" ? true : imagesParam === "0" ? false : imagePolicy.allows(message.from);
      // Inline cid: parts are resolved from the message's own MIME bytes BEFORE
      // sanitizing, because the sanitizer replaces any leftover cid: with a
      // placeholder. Nothing here touches the network.
      const parts = message.attachments ?? [];
      const wantsInline = parts.some((p) => p.inline && p.contentId);
      let rawHtml = message.html ?? null;
      if (rawHtml && wantsInline && message.uid) {
        const loaded = await loadInlineParts(message, parts).catch(() => ({}));
        rawHtml = inlineCidImages(rawHtml, parts, loaded);
      }
      const html = rawHtml ? sanitizeMailHtml(rawHtml, { allowRemoteImages: allowImages }) : null;
      const remoteImages = message.html ? remoteImageCount(message.html) : 0;
      const { html: _raw, ...safeMessage } = message;
      // Calendar invite? Fetch just that part and parse it, so the reading pane
      // can show "Tuesday 3:00 PM" instead of an unreadable .ics attachment.
      let invite = null;
      const icsPart = parts.find((p) => isCalendarPart(p));
      if (icsPart && message.uid) {
        const loaded = await loadInlineParts(message, [icsPart]).catch(
          () => ({}) as Record<string, LoadedPart>,
        );
        const found = loaded[String(icsPart.part)];
        if (found?.data) {
          try {
            invite = parseIcs(Buffer.from(found.data, "base64").toString("utf8"));
          } catch {
            invite = null;
          }
        }
      }
      return json(
        res,
        200,
        {
          message: safeMessage,
          html,
          remoteImages,
          imagesOn: allowImages,
          attachments: attachmentStrip(parts),
          invite,
          draft: drafts.get(id) ?? null,
          threat,
          inspect,
          autoOpen,
        },
        origin,
      );
    }

    // Size/name for a file the user picked in the native dialog. Read-only
    // metadata; the file itself is never opened here.
    // Reply / Reply-all / Forward scaffolding. Returns a composed draft; it
    // never sends. Sending still requires the two-click confirm flow.
    if (req.method === "POST" && url.pathname === "/api/compose/reply") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const messageId = asString(body.messageId);
      const src = messageId ? store.getMessage(messageId) : undefined;
      if (!src) return json(res, 404, { error: "unknown_message" }, origin);
      const account = accounts.get(src.accountId);
      const me = account?.email ?? src.to ?? "";
      const mode = asString(body.mode);
      const composed =
        mode === "forward" ? buildForward(src) : buildReply(src, { me, all: mode === "all" });
      return json(res, 200, { compose: composed }, origin);
    }

    // Outbox: what is queued or scheduled, and cancel/retry controls.
    // Hand an invite to whatever calendar the user already uses. We write a
    // minimal .ics and let the OS open it rather than syncing a calendar.
    if (req.method === "POST" && url.pathname === "/api/calendar/ics") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const src = body.invite;
      if (!src || typeof src !== "object" || Array.isArray(src)) {
        return json(res, 400, { error: "need_invite" }, origin);
      }
      // Coerce every field: a client sending {summary: 42} must get a 400 or a
      // sane file, never a 500 from .replace() on a number.
      const inv = src as Record<string, unknown>;
      const file = toIcsFile({
        summary: asString(inv.summary, "(no title)", 500),
        description: asString(inv.description, "", 5000) || undefined,
        location: asString(inv.location, "", 500) || undefined,
        organizer: asString(inv.organizer, "", 320) || undefined,
        attendees: asStringArray(inv.attendees, 200),
        start: asString(inv.start) || null,
        end: asString(inv.end) || null,
        allDay: inv.allDay === true,
        uid: asString(inv.uid, "", 200) || undefined,
      });
      res.writeHead(200, {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="invite.ics"',
        "x-content-type-options": "nosniff",
        ...corsHeaders(origin),
      });
      res.end(file);
      return;
    }

    // Contacts harvested from mail we already have — no address book to sync.
    if (req.method === "GET" && url.pathname === "/api/contacts") {
      const q = url.searchParams.get("q") ?? "";
      const account = accounts.get(activeAccountId);
      const me = account?.email ?? "";
      const book = harvestContacts(
        store.allForAccount(activeAccountId).map((m) => ({
          from: m.from,
          to: m.to,
          folder: m.folder,
          date: m.date,
        })),
        me,
        readHiddenContacts(),
      );
      return json(res, 200, { contacts: q ? suggestContacts(book, q) : book.slice(0, 200) }, origin);
    }

    // Remove a contact. The mail it came from stays; the address is remembered
    // as hidden so it does not come back on the next sync.
    if (req.method === "DELETE" && url.pathname.startsWith("/api/contacts/")) {
      const address = decodeURIComponent(url.pathname.slice("/api/contacts/".length))
        .trim()
        .toLowerCase();
      if (!address.includes("@")) return json(res, 400, { error: "bad_address" }, origin);
      writeHiddenContacts([...readHiddenContacts(), address]);
      return json(res, 200, { removed: address }, origin);
    }

    // Bring every removed contact back.
    if (req.method === "POST" && url.pathname === "/api/contacts/restore") {
      writeHiddenContacts([]);
      return json(res, 200, { restored: true }, origin);
    }

    // Calendar: a real local calendar, not just invite detection.
    if (req.method === "GET" && url.pathname === "/api/calendar") {
      const all = url.searchParams.get("all") === "1";
      return json(res, 200, { events: all ? calendar.list() : calendar.upcoming() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/calendar") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      try {
        const event = calendar.add({
          summary: asString(body.summary, "", 500),
          description: asString(body.description, "", 5000) || undefined,
          location: asString(body.location, "", 500) || undefined,
          organizer: asString(body.organizer, "", 320) || undefined,
          attendees: asStringArray(body.attendees, 200),
          start: asString(body.start),
          end: asString(body.end) || null,
          allDay: body.allDay === true,
          uid: asString(body.uid, "", 200) || undefined,
          messageId: asString(body.messageId, "", 200) || undefined,
        });
        audit.append({ actor: "user", action: "calendar.add", detail: event.summary.slice(0, 80) });
        return json(res, 201, { event }, origin);
      } catch (e) {
        return json(res, 400, { error: "bad_event", message: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/calendar/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/calendar/".length));
      const ok = calendar.remove(id);
      return json(res, ok ? 200 : 404, { removed: ok }, origin);
    }

    /*
     * OAuth2 sign-in.
     *
     * Loopback redirect with PKCE, opened in the SYSTEM browser. Never an
     * embedded webview: a window inside a mail client asking for a Google
     * password is indistinguishable from phishing, and the system browser
     * already holds the user's session and password manager. We never see the
     * password — only a scoped token the user can revoke from their provider.
     */
    if (req.method === "POST" && url.pathname === "/api/oauth/start") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);

      const provider = asString(body.provider, "", 40);
      const cfg = providerOAuth(provider);
      if (!cfg) return json(res, 400, { error: "provider_has_no_oauth" }, origin);

      // The client id is not a secret (a desktop app cannot keep one) but it
      // is per-deployment, so it is configured rather than hardcoded.
      const clientId = process.env[`AETHER_OAUTH_CLIENT_${provider.toUpperCase()}`] ?? "";
      if (!clientId) {
        return json(
          res,
          501,
          {
            error: "no_client_id",
            message:
              `Set AETHER_OAUTH_CLIENT_${provider.toUpperCase()} to an OAuth client id ` +
              `registered for a desktop/native app. See docs/OAUTH.md.`,
            revokeHint: cfg.revokeHint,
          },
          origin,
        );
      }

      const started = buildAuthUrl(cfg, clientId, PORT);
      pendingOAuth.set(started.state, {
        provider,
        verifier: started.verifier,
        email: asString(body.email, "", 200),
        expires: Date.now() + 10 * 60_000,
      });
      audit.append({ actor: "user", action: "oauth.start", detail: provider });
      return json(res, 200, { url: started.url, state: started.state }, origin);
    }

    /*
     * The provider redirects the browser here with ?code=&state=.
     *
     * The state must match a flow we started: without that check another local
     * process could feed us a code for an account the user never chose.
     */
    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const pending = pendingOAuth.get(state);
      pendingOAuth.delete(state);

      const page = (msg: string): void => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Aether Mail</title>` +
            `<body style="font:15px system-ui;padding:40px;max-width:30rem">` +
            `<h2>Aether Mail</h2><p>${msg}</p>` +
            `<p style="color:#666">You can close this tab.</p>`,
        );
      };

      if (!code || !pending || pending.expires < Date.now()) {
        page("Sign-in failed or expired. Start again from Aether.");
        return;
      }

      const cfg = providerOAuth(pending.provider);
      const clientId = process.env[`AETHER_OAUTH_CLIENT_${pending.provider.toUpperCase()}`] ?? "";
      if (!cfg || !clientId) {
        page("Sign-in is not configured.");
        return;
      }

      const token = await exchangeCode(cfg, clientId, code, pending.verifier, PORT);
      if (!token) {
        page("The provider refused the sign-in. Please try again.");
        return;
      }

      /*
       * Tokens go to the keyring like every other credential — never to JSON.
       *
       * Two entries: the access token under the account's secret_ref (what the
       * mail CLI reads) and the refresh token under a ":refresh" suffix (what
       * tokenrefresh.ts reads). Splitting them means a rotated access token
       * never overwrites the long-lived one.
       */
      const secretRef = `oauth:${pending.provider}:${pending.email}`;
      const stored = await runMailCli(
        buildMailCliArgs({ action: "secret-put", secretRef }),
        `oauth2:${token.accessToken}`,
      );
      if (token.refreshToken) {
        await runMailCli(
          buildMailCliArgs({ action: "secret-put", secretRef: `${secretRef}:refresh` }),
          token.refreshToken,
        );
      }
      tokenCache.set(secretRef, {
        accessToken: token.accessToken,
        expiresAt: token.expiresAt,
      });
      audit.append({
        actor: "user",
        action: "oauth.complete",
        detail: `${pending.provider} ${stored.ok ? "stored" : "store-failed"}`,
      });
      page(stored.ok ? "Signed in. Return to Aether." : "Signed in, but storing the token failed.");
      return;
    }

    /*
     * Folder-level automation candidates.
     *
     * "These 33 messages share a sender, one rule files them all" is far more
     * useful than a suggestion about the one message you happen to have open.
     *
     * Computed, not generated: counting senders is arithmetic, and a local 7B
     * model would do it slower and occasionally wrong. No LLM is involved, so
     * this also works with no model configured at all.
     *
     * The domains the user has WRITTEN TO are excluded — someone who mails you
     * a lot and whom you reply to is a correspondent, not a newsletter, and
     * "sends a lot" is exactly the signal a naive version would key on.
     */
    if (req.method === "GET" && url.pathname === "/api/agent/folder-suggestions") {
      const folder = asString(url.searchParams.get("folder") ?? "INBOX", "INBOX", 100);

      const corresponded = new Set<string>();
      for (const sent of store.listMessages(activeAccountId, "Sent", "newest")) {
        for (const piece of (sent.to ?? "").split(",")) {
          const angled = /<([^>]+)>/.exec(piece);
          const addr = (angled ? angled[1] : piece).trim().toLowerCase();
          const domain = addr.includes("@") ? addr.split("@").pop() ?? "" : "";
          if (domain) corresponded.add(domain);
        }
      }

      const candidates = findBulkSenders(
        store.listMessages(activeAccountId, folder, "newest").map((m) => ({
          from: m.from,
          subject: m.subject,
          unread: m.unread,
        })),
        {
          corresponded,
          alreadyRuled: ruleBook.list().map((r) => r.contains),
          // Ask for withheld domains too, so the panel can explain the
          // omission instead of silently showing a shorter list. They come
          // back after the cap, so they never cost an actionable suggestion.
          includeWithheld: true,
        },
      );

      return json(res, 200, { folder, candidates }, origin);
    }

    /*
     * Agent proposals: the model suggests, a human commits.
     *
     * The model is asked for a structured proposal rather than prose. We
     * validate it against a closed allow-list (agent-tools.ts), show the user
     * plain language, and only act on an explicit approve call carrying the
     * exact proposal they saw.
     *
     * The model never reaches the store. Mail is attacker-controlled input, so
     * a model that could act on it could be told to act by whoever wrote the
     * message. There is no send or delete action in the schema at all.
     */
    if (req.method === "POST" && url.pathname === "/api/agent/propose") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const messageId = asString(body.messageId, "", 400);
      const msg = messageId ? store.getMessage(messageId) : null;
      if (!msg) return json(res, 404, { error: "no_message" }, origin);

      try {
        const reply = await runAgent({
          skill: "triage",
          from: msg.from,
          subject: msg.subject,
          body: (msg.body ?? "").slice(0, 4000),
          instructionOverride: `${PROPOSAL_SCHEMA}\n\nSuggest one automation for this message.`,
        });
        const proposal = parseProposal(reply.text ?? "");
        if (!proposal) {
          return json(res, 200, { proposal: null, note: "No safe automation suggested." }, origin);
        }
        return json(
          res,
          200,
          { proposal, describe: describeProposal(proposal), note: proposal.why ?? null },
          origin,
        );
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : "agent_failed" }, origin);
      }
    }

    /* Execute a proposal the user approved. Re-validated, never trusted. */
    if (req.method === "POST" && url.pathname === "/api/agent/approve") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);

      // Re-parse from the wire rather than trusting a client-side object: the
      // approve call is the security boundary, not the propose call.
      const proposal = parseProposal(JSON.stringify(body.proposal ?? {}));
      if (!proposal) return json(res, 400, { error: "bad_proposal" }, origin);

      if (proposal.action === "create_rule" && proposal.rule) {
        const rule = ruleBook.add({
          field: proposal.rule.field,
          contains: proposal.rule.contains,
          action: proposal.rule.then,
          folder: proposal.rule.folder,
          enabled: true,
        });
        audit.append({ actor: "user", action: "agent.rule.approved", detail: rule.contains });
        return json(res, 201, { created: "rule", rule, rules: ruleBook.list() }, origin);
      }

      if (proposal.action === "create_template" && proposal.template) {
        const tpl = templates.add({
          name: proposal.template.name,
          subject: "",
          body: proposal.template.body,
        });
        audit.append({ actor: "user", action: "agent.template.approved", detail: tpl.name });
        return json(res, 201, { created: "template", template: tpl }, origin);
      }

      if (proposal.action === "mute_thread" && proposal.mute) {
        /*
         * Mute, then file what is already here.
         *
         * Muting only affects mail that has not arrived yet, so approving a
         * mute and watching eight copies stay in the inbox reads as broken.
         * Same two-step reasoning as accepting a folder suggestion.
         */
        muteBook.mute(proposal.mute.subject);
        let filed = 0;
        for (const msg of store.listMessages(activeAccountId, "INBOX", "newest")) {
          if (normalizeSubject(msg.subject ?? "") !== normalizeSubject(proposal.mute.subject)) {
            continue;
          }
          store.markRead(msg.id);
          store.move(msg.id, "Archive");
          filed += 1;
        }
        audit.append({
          actor: "user",
          action: "agent.mute.approved",
          detail: `${proposal.mute.subject} (${filed} filed)`,
        });
        return json(
          res,
          201,
          { created: "mute", subject: proposal.mute.subject, filed, muted: muteBook.list() },
          origin,
        );
      }

      if (proposal.action === "snooze" && proposal.snooze) {
        // Snooze acts on the message the proposal was made about, so the id
        // comes from the request rather than from the model.
        const targetId = asString(body.messageId);
        const msg = targetId ? store.getMessage(targetId) : null;
        if (!msg) return json(res, 400, { error: "no_message" }, origin);

        const wakeAt = snoozeUntil(proposal.snooze.preset as SnoozePreset).getTime();
        snoozeBook.add(msg.id, msg.folder ?? "INBOX", wakeAt);
        store.move(msg.id, "Snoozed");
        audit.append({
          actor: "user",
          action: "agent.snooze.approved",
          detail: `${proposal.snooze.preset} -> ${new Date(wakeAt).toISOString()}`,
        });
        return json(
          res,
          201,
          { created: "snooze", wakeAt, preset: proposal.snooze.preset },
          origin,
        );
      }

      return json(res, 400, { error: "bad_proposal" }, origin);
    }

    /*
     * Backup and restore.
     *
     * The archive is a plain directory: a SQLite file anyone can open with
     * `sqlite3` plus the settings as JSON. Credentials are never included —
     * they live in the OS keyring, so a backup is deliberately not a copy of
     * your passwords.
     */
    if (req.method === "POST" && url.pathname === "/api/backup") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw) ?? {};
      const dest = asString(body.dest, "", 500) || path.join(here, "backups");
      try {
        fs.mkdirSync(dest, { recursive: true });
        const result = createBackup(path.join(here, "data"), dest);
        audit.append({
          actor: "user",
          action: "backup.create",
          detail: `${result.messages} message(s)`,
        });
        return json(res, 200, result, origin);
      } catch (e) {
        return json(res, 500, { error: e instanceof Error ? e.message : "backup_failed" }, origin);
      }
    }

    // What backups exist, newest first.
    if (req.method === "GET" && url.pathname === "/api/backup") {
      const dest = path.join(here, "backups");
      if (!fs.existsSync(dest)) return json(res, 200, { backups: [], dir: dest }, origin);
      const rows = fs
        .readdirSync(dest)
        .map((name) => ({ name, info: listBackupContents(path.join(dest, name)) }))
        .filter((r) => r.info !== null)
        .map((r) => ({
          name: r.name,
          path: path.join(dest, r.name),
          createdAt: r.info?.createdAt ?? "",
          messages: r.info?.messages ?? 0,
          files: r.info?.files.length ?? 0,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(res, 200, { backups: rows, dir: dest }, origin);
    }

    /*
     * Restore. The current profile is moved aside, never deleted, so an
     * accidental restore costs a rename to undo rather than someone's mail.
     * A restart is required afterwards: the store holds an open handle to the
     * database that was just replaced.
     */
    if (req.method === "POST" && url.pathname === "/api/backup/restore") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const from = asString(body.path, "", 500);
      if (!from) return json(res, 400, { error: "no_path" }, origin);
      try {
        const result = restoreBackup(from, path.join(here, "data"));
        audit.append({ actor: "user", action: "backup.restore", detail: from.slice(0, 80) });
        return json(res, 200, { ...result, restartRequired: true }, origin);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : "restore_failed" }, origin);
      }
    }

    /**
     * Unified inbox: every account's INBOX in one date-ordered list.
     *
     * `meaningful` tells the client whether to show the nav entry at all —
     * with one account this view is identical to the inbox, and a menu item
     * that appears to do nothing is worse than no menu item.
     */
    if (req.method === "GET" && url.pathname === "/api/unified") {
      const all = accounts.list();
      const merged = mergeAccounts(
        all.map((acct) => ({
          accountId: acct.id,
          email: acct.email,
          messages: store.listMessages(acct.id, "INBOX", "newest").map((m) => ({
            id: m.id,
            from: m.from,
            subject: m.subject,
            date: m.date,
            unread: m.unread,
            starred: m.starred,
            preview: m.preview,
          })),
        })),
      );
      return json(
        res,
        200,
        { messages: merged, accounts: all.length, meaningful: all.length > 1 },
        origin,
      );
    }

    // Muted threads. A muted thread's new replies arrive read and archived
    // rather than being deleted — muting is not unsubscribing.
    if (req.method === "GET" && url.pathname === "/api/mute") {
      return json(res, 200, { muted: muteBook.list() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/mute") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const subject = asString(body.subject, "", 500);
      if (!subject.trim()) return json(res, 400, { error: "no_subject" }, origin);
      const off = body.unmute === true;
      if (off) muteBook.unmute(subject);
      else muteBook.mute(subject);

      // Apply immediately to what is already in the inbox, so muting a live
      // storm quiets it now rather than only affecting future mail.
      let filed = 0;
      if (!off) {
        for (const msg of store.listMessages(activeAccountId, "INBOX", "newest")) {
          if (!muteBook.isMuted(msg.subject ?? "")) continue;
          store.markRead(msg.id);
          store.move(msg.id, "Archive");
          filed += 1;
        }
        store.saveNow();
      }
      audit.append({ actor: "user", action: off ? "thread.unmute" : "thread.mute", detail: subject.slice(0, 60) });
      return json(
        res,
        200,
        { muted: muteBook.list(), filed, folders: store.listFolders(activeAccountId) },
        origin,
      );
    }

    // Filing rules. Deterministic, user-visible, and structurally unable to
    // send: the action type has no reply or forward variant.
    if (req.method === "GET" && url.pathname === "/api/rules") {
      return json(res, 200, { rules: ruleBook.list() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/rules") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const field = asString(body.field);
      const action = asString(body.action);
      if (!["from", "to", "subject"].includes(field)) {
        return json(res, 400, { error: "bad_field" }, origin);
      }
      if (!["move", "star", "read"].includes(action)) {
        return json(res, 400, { error: "bad_action" }, origin);
      }
      try {
        const rule = ruleBook.add({
          field: field as "from" | "to" | "subject",
          contains: asString(body.contains, "", 300),
          action: action as "move" | "star" | "read",
          folder: asString(body.folder, "", 200) || undefined,
          enabled: true,
        });
        audit.append({ actor: "user", action: "rule.add", detail: `${field} ~ ${rule.contains}` });
        return json(res, 201, { rule, rules: ruleBook.list() }, origin);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : "bad_rule" }, origin);
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/rules/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/rules/".length));
      const ok = ruleBook.remove(id);
      return json(res, ok ? 200 : 404, { removed: ok, rules: ruleBook.list() }, origin);
    }

    /**
     * Run every rule over the current folder.
     *
     * Explicit rather than automatic on sync: the user presses the button and
     * sees what happened. Filing a mailbox behind someone's back the first
     * time they write a rule is how you lose their trust in the feature.
     */
    if (req.method === "POST" && url.pathname === "/api/rules/run") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw) ?? {};
      const folder = asString(body.folder, "INBOX", 200) || "INBOX";
      let filed = 0;
      for (const msg of store.listMessages(activeAccountId, folder, "newest")) {
        const rule = ruleBook.apply({
          from: msg.from ?? "",
          to: msg.to ?? "",
          subject: msg.subject ?? "",
          folder: msg.folder ?? folder,
        });
        if (!rule) continue;
        if (rule.action === "move" && rule.folder) store.move(msg.id, rule.folder);
        else if (rule.action === "star") store.setStarred(msg.id, true);
        else if (rule.action === "read") store.markRead(msg.id);
        filed += 1;
      }
      store.saveNow();
      audit.append({ actor: "user", action: "rule.run", detail: `${filed} message(s)` });
      return json(res, 200, { filed, folders: store.listFolders(activeAccountId) }, origin);
    }

    // Snooze: hide a message until a time, then restore it where it was.
    if (req.method === "GET" && url.pathname === "/api/snooze") {
      wakeSnoozed();
      return json(res, 200, { items: snoozeBook.list() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/snooze") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const id = asString(body.id, "", 400);
      const preset = asString(body.preset);
      const msg = id ? store.getMessage(id) : null;
      if (!msg) return json(res, 404, { error: "no_message" }, origin);
      if (!["later", "tomorrow", "week", "weekend"].includes(preset)) {
        return json(res, 400, { error: "bad_preset" }, origin);
      }
      const wakeAt = snoozeUntil(preset as SnoozePreset).getTime();
      snoozeBook.add(id, msg.folder ?? "INBOX", wakeAt);
      store.move(id, "Snoozed");
      store.saveNow();
      audit.append({ actor: "user", action: "snooze.set", detail: preset });
      return json(res, 200, { wakeAt, folders: store.listFolders(activeAccountId) }, origin);
    }

    // Wake a snoozed message early.
    if (req.method === "POST" && url.pathname === "/api/snooze/wake") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const id = asString(body.id, "", 400);
      const item = snoozeBook.list().find((i) => i.id === id);
      if (!item) return json(res, 404, { error: "not_snoozed" }, origin);
      store.move(item.id, item.from);
      snoozeBook.remove(item.id);
      store.saveNow();
      return json(res, 200, { woke: id, folders: store.listFolders(activeAccountId) }, origin);
    }

    // Remote image policy: ask (default) / always / never, plus trusted senders.
    if (req.method === "GET" && url.pathname === "/api/images/policy") {
      return json(res, 200, { mode: imagePolicy.mode(), trusted: imagePolicy.trusted() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/images/policy") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      const mode = asString(body.mode);
      if (mode === "ask" || mode === "always" || mode === "never") imagePolicy.setMode(mode);
      const trust = asString(body.trust);
      if (trust) imagePolicy.trust(trust);
      const untrust = asString(body.untrust);
      if (untrust) imagePolicy.untrust(untrust);
      return json(res, 200, { mode: imagePolicy.mode(), trusted: imagePolicy.trusted() }, origin);
    }

    // Per-account signature.
    if (req.method === "GET" && url.pathname === "/api/signature") {
      return json(res, 200, { signature: signatures.get(activeAccountId) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/signature") {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) return json(res, 400, { error: "bad_json" }, origin);
      signatures.set(activeAccountId, asString(body.signature, "", 2000));
      return json(res, 200, { signature: signatures.get(activeAccountId) }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/outbox") {
      return json(res, 200, { items: outbox.list() }, origin);
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/outbox/") && url.pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/outbox/".length, -"/cancel".length),
      );
      const removed = outbox.cancel(id);
      if (removed) audit.append({ actor: "user", action: "outbox.cancel", detail: id });
      return json(res, removed ? 200 : 404, { cancelled: removed }, origin);
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/outbox/") && url.pathname.endsWith("/retry")) {
      const id = decodeURIComponent(url.pathname.slice("/api/outbox/".length, -"/retry".length));
      const ok = outbox.retry(id);
      if (ok) void drainOutbox();
      return json(res, ok ? 200 : 404, { retrying: ok }, origin);
    }

    // Send the whole queue now, ignoring schedules.
    if (req.method === "POST" && url.pathname === "/api/outbox/flush") {
      void drainOutbox();
      return json(res, 202, { flushing: true }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/fileinfo") {
      const target = url.searchParams.get("path") ?? "";
      if (!target) return json(res, 400, { error: "need_path" }, origin);
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) return json(res, 400, { error: "not_a_file" }, origin);
        return json(res, 200, { name: path.basename(target), size: stat.size }, origin);
      } catch {
        return json(res, 404, { error: "unreadable" }, origin);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      return json(res, 200, { q, account: activeAccountId, messages: store.search(activeAccountId, q) });
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

    /*
     * Remove a folder the user created.
     *
     * The store refuses when the folder still holds mail or is a standard mail
     * folder, so a 409 here means "that would lose messages", not a bug.
     */
    if (req.method === "DELETE" && url.pathname.startsWith("/api/folders/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/folders/".length));
      if (!name) return json(res, 400, { error: "need name" }, origin);
      const removed = store.removeFolder(activeAccountId, name);
      if (!removed) {
        return json(
          res,
          409,
          {
            error: "cannot_remove",
            message: "Only empty folders you created can be removed.",
          },
          origin,
        );
      }
      audit.append({ actor: "user", action: "folder.remove", detail: name });
      return json(res, 200, { folders: store.listFolders(activeAccountId) }, origin);
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
      if (activeAccountId === id) activeAccountId = FIXTURE_ACCOUNT.id;
      audit.append({ actor: "user", action: "account.remove", detail: id });
      return json(res, 200, { accounts: accounts.list().map(publicAccount) }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/accounts") {
      return json(res, 200, { accounts: accounts.list().map(publicAccount), active: activeAccountId }, origin);
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/accounts/") && url.pathname.endsWith("/select")) {
      const id = decodeURIComponent(url.pathname.slice("/api/accounts/".length, -"/select".length));
      const next = resolveAccountSwitch({
        requested: id,
        fixtureId: FIXTURE_ACCOUNT.id,
        savedIds: accounts.list().map((a) => a.id),
      });
      if (!next) return json(res, 404, { error: "unknown_account" }, origin);
      rememberActive(next);
      return json(res, 200, { active: activeAccountId, folders: store.listFolders(activeAccountId) }, origin);
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

    if (req.method === "GET" && url.pathname === "/api/settings/inspect") {
      return json(res, 200, { inspect: inspectPrefs.read() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/settings/inspect") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { autoInspect?: boolean; alwaysShow?: boolean };
      return json(res, 200, { inspect: inspectPrefs.save(body) }, origin);
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
      if (/\b(inbox|what.?s new|recent mail|any mail)\b/i.test(text) && !mail) {
        const recent = store.listMessages(activeAccountId, "INBOX").slice(0, 8);
        const summary = recent.length
          ? `Latest in INBOX (${recent.length}):\n${recent.map((m) => `• ${m.date.slice(0, 10)} ${m.from} — ${m.subject}`).join("\n")}`
          : "INBOX list is empty. Fetch INBOX first.";
        chat.add("assistant", summary);
        return json(res, 200, { turns: chat.list(), result: { text: summary, model: "store", refused: [] } }, origin);
      }
      if (/\b(inspect|headers?|who sent|spf|dkim|dmarc|suspect)\b/i.test(text)) {
        if (!mail?.headers) {
          const summary = mail
            ? "No stored headers on this message. Fetch INBOX again (newest 40) so Return-Path / Auth-Results are kept."
            : "Open a message first, then say inspect headers.";
          chat.add("assistant", summary);
          return json(res, 200, { turns: chat.list(), result: { text: summary, model: "inspect", refused: [] } }, origin);
        }
        const report = inspectHeaders(mail.headers);
        const summary = inspectSummary(report);
        chat.add("assistant", summary);
        return json(res, 200, { turns: chat.list(), result: { text: summary, model: "inspect", refused: [] } }, origin);
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

      /*
       * Refresh the OAuth session before doing anything.
       *
       * Access tokens last about an hour, so without this a signed-in account
       * works for one sync and then fails — and it presents as a mailbox that
       * stopped updating rather than as an expired credential.
       *
       * A password account short-circuits inside ensureFreshToken.
       */
      const fresh = await ensureFreshToken(account, tokenCache, refreshDeps);
      if (!fresh.ok) {
        audit.append({ actor: "user", action: "oauth.refresh.failed", detail: fresh.reason });
        return json(res, 401, { error: "reauth_required", message: fresh.reason }, origin);
      }
      if (fresh.refreshed) {
        audit.append({ actor: "workflow", action: "oauth.refresh", detail: account.provider });
      }

      // Ask the server what folders exist, then sync the ones a mail client
      // needs. Providers name these differently ("[Gmail]/Sent Mail" vs
      // "Sent Items"), so the remote name is used for IMAP and the canonical
      // name is what the UI shows.
      const probed = await runMailCli(
        buildMailCliArgs({
          action: "probe",
          secretRef: account.secret_ref,
          host: account.imap_host,
          port: account.imap_port,
          tls: account.imap_tls,
          username: account.username,
        }),
      );
      const targets = pickSyncFolders(probed.ok ? probed.folders ?? [] : []);

      let total = 0;
      let firstError: string | undefined;
      for (const target of targets) {
        /*
         * Ask only for what is new.
         *
         * The server's UIDVALIDITY only comes back WITH the response, so the
         * order is: fetch incrementally based on what we knew, then check what
         * the server said. If it renumbered, everything we just got is
         * untrustworthy — drop the stored position and refetch fully next
         * pass. Asking for UID 901+ in a mailbox that restarted at 1 returns
         * nothing forever, with no error to notice.
         */
        const known = syncState.get(account.id, target.canonical);
        const plan = planFetch(known, known?.uidValidity ?? 0);

        const fetched = await runMailCli(
          buildMailCliArgs({
            action: "fetch",
            secretRef: account.secret_ref,
            host: account.imap_host,
            port: account.imap_port,
            tls: account.imap_tls,
            username: account.username,
            folder: target.remote,
            sinceUid: plan.sinceUid,
          }),
        );
        if (!fetched.ok) {
          // One bad folder must not abort the whole sync.
          if (target.canonical === "INBOX") firstError = fetched.error;
          continue;
        }
        total += fetched.messages?.length ?? 0;

        /*
         * Record where we got to, now that the server has told us its
         * UIDVALIDITY. A renumber invalidates the position we just used, so
         * reset instead of recording — the next pass then does a full window.
         */
        const serverValidity = fetched.uid_validity ?? 0;
        if (known && serverValidity && serverValidity !== known.uidValidity) {
          syncState.reset(account.id, target.canonical);
          audit.append({
            actor: "workflow",
            action: "sync.uidvalidity_changed",
            detail: `${target.canonical}: ${known.uidValidity} -> ${serverValidity}`,
          });
        } else if (serverValidity && fetched.highest_uid) {
          syncState.record(account.id, target.canonical, {
            uidValidity: serverValidity,
            highestUid: fetched.highest_uid,
          });
        }

        store.loadFixture(
          (fetched.messages ?? []).map((m) => ({
            id: `${account.id}-${target.canonical}-${m.id}`,
            accountId: account.id,
            folder: target.canonical,
            from: m.from,
            to: m.to,
            subject: m.subject,
            date: toIsoDate(m.date || ""),
            unread: m.unread,
            body: readableBody(m.body || ""),
            headers: m.headers,
            preview: m.preview || undefined,
            uid: m.id,
            remoteFolder: target.remote,
            attachments: (m.attachments ?? []).map((a) => ({
              part: a.part,
              filename: a.filename,
              mimeType: a.mime_type,
              size: a.size,
              contentId: a.content_id ?? null,
              inline: a.inline,
            })),
            hiddenMedia:
              remoteImageCount(m.html || m.body || "") || countHiddenMedia(m.html || m.body || ""),
            html: m.html
              ? m.html.slice(0, 200_000)
              : looksLikeHtml(m.body || "")
                ? (m.body || "").slice(0, 40_000)
                : undefined,
          })),
        );
      }

      /*
       * Apply muted threads and filing rules to what just arrived.
       *
       * Mute has to run here, not only when the user clicks Mute: the whole
       * point is to keep FUTURE replies out of the inbox. Rules run here too
       * so "set once, runs forever" is true rather than a button you have to
       * remember to press. Both are local and neither can send.
       */
      let autoFiled = 0;
      for (const msg of store.listMessages(activeAccountId, "INBOX", "newest")) {
        if (muteBook.isMuted(msg.subject ?? "")) {
          store.markRead(msg.id);
          store.move(msg.id, "Archive");
          autoFiled += 1;
          continue;
        }
        const rule = ruleBook.apply({
          from: msg.from ?? "",
          to: msg.to ?? "",
          subject: msg.subject ?? "",
          folder: msg.folder ?? "INBOX",
        });
        if (!rule) continue;
        if (rule.action === "move" && rule.folder) store.move(msg.id, rule.folder);
        else if (rule.action === "star") store.setStarred(msg.id, true);
        else if (rule.action === "read") store.markRead(msg.id);
        autoFiled += 1;
      }
      if (autoFiled > 0) {
        store.saveNow();
        audit.append({ actor: "workflow", action: "sync.filed", detail: `${autoFiled} message(s)` });
      }

      if (total === 0 && firstError) {
        return json(res, 502, { error: "fetch_failed", message: firstError }, origin);
      }
      store.saveNow();
      activeAccountId = account.id;
      rememberFetch();
      const ran = runWorkflows(account.id);
      return json(
        res,
        200,
        {
          folders: sortFolders(store.listFolders(account.id)),
          count: total,
          synced: targets.map((t) => t.canonical),
          workflows: ran,
        },
        origin,
      );
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
        attachments?: string[];
        html?: string;
        sendAt?: number;
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
        // Scheduled mail goes to the Outbox instead of out now. Still gated by
        // the same two human clicks — the token above was already consumed.
        if (pending.sendAt) {
          const queued = outbox.enqueue({
            accountId: pending.accountId,
            to: pending.to,
            subject: pending.subject,
            body: pending.body,
            html: pending.html,
            attachments: pending.attachments ?? [],
            sendAt: pending.sendAt,
          });
          audit.append({ actor: "user", action: "outbox.queue", detail: `to=${pending.to}` });
          return json(res, 200, { queued: true, id: queued.id, sendAt: queued.sendAt }, origin);
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
          // JSON envelope so attachment paths never appear on argv, where any
          // process on the machine could read them.
          JSON.stringify({ body: pending.body, html: pending.html, attachments: pending.attachments ?? [] }),
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
      // Append the account signature once, at prepare time, so what the user
      // confirms is exactly what goes out.
      const sig = signatures.get(body.accountId || accounts.list()[0]?.id || activeAccountId);
      if (sig) prepared.body = applySignature(prepared.body, sig);
      const confirmId = `send-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // Attachments are local file paths chosen by the human in the compose
      // window. Validate every one now, so a bad path fails at compose time
      // rather than after the user clicks Confirm.
      const attachPaths: string[] = [];
      let attachBytes = 0;
      for (const raw of (body.attachments ?? []).slice(0, MAX_ATTACHMENTS)) {
        if (typeof raw !== "string" || !raw.trim()) continue;
        let stat;
        try {
          stat = fs.statSync(raw);
        } catch {
          return json(res, 400, {
            error: "attachment_missing",
            message: `Cannot read ${path.basename(raw)}. Was it moved or deleted?`,
          }, origin);
        }
        if (!stat.isFile()) {
          return json(res, 400, {
            error: "attachment_not_a_file",
            message: `${path.basename(raw)} is not a file.`,
          }, origin);
        }
        attachBytes += stat.size;
        if (attachBytes > MAX_ATTACH_TOTAL) {
          return json(res, 413, {
            error: "attachments_too_large",
            message: `Attachments total more than ${Math.round(MAX_ATTACH_TOTAL / (1024 * 1024))} MB. Most mail servers reject that — share a link instead.`,
          }, origin);
        }
        attachPaths.push(raw);
      }
      const accountId = body.accountId || accounts.list()[0]?.id;
      if (!accountId) {
        return json(res, 409, {
          error: "send_not_wired",
          message: "Add a real mail account in Settings, then Confirm send. SMTP is not available on the fixture inbox.",
          preview: prepared,
        }, origin);
      }
      /*
       * Formatted body.
       *
       * Sanitized HERE, at prepare, not at send: whatever survives this is
       * exactly what the user sees in the two-click confirm preview, so the
       * thing they approve is the thing that goes out. The plain part is
       * derived from the sanitized HTML for the same reason.
       *
       * If there is no real formatting we drop the HTML entirely — a
       * multipart/alternative whose HTML part is `<div>hi</div>` is noise.
       */
      const rawHtmlBody = asString(body.html, "", 200_000);
      let safeHtml: string | undefined;
      let plainBody = prepared.body;
      if (rawHtmlBody && hasFormatting(rawHtmlBody)) {
        safeHtml = sanitizeComposedHtml(rawHtmlBody);
        const derived = htmlToPlainText(safeHtml);
        if (derived.trim()) plainBody = derived;
      }

      pendingSends.set(confirmId, {
        to: prepared.to,
        subject: prepared.subject,
        body: plainBody,
        html: safeHtml,
        accountId,
        expires: Date.now() + 5 * 60 * 1000,
        attachments: attachPaths,
        sendAt: typeof body.sendAt === "number" && body.sendAt > Date.now() ? body.sendAt : null,
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

    if (req.method === "GET" && url.pathname === "/api/usage") {
      return json(res, 200, usageSnapshot(), origin);
    }

    if (req.method === "GET" && url.pathname === "/api/themes") {
      return json(res, 200, { themes: THEMES }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/templates") {
      return json(res, 200, { templates: templates.list() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/templates") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { name?: string; subject?: string; body?: string };
      try {
        const row = templates.add({ name: body.name ?? "", subject: body.subject ?? "", body: body.body ?? "" });
        return json(res, 201, { template: row, templates: templates.list() }, origin);
      } catch (e) {
        return json(res, 400, { error: "bad_template", message: e instanceof Error ? e.message : String(e) }, origin);
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/templates/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/templates/".length));
      if (!templates.remove(id)) return json(res, 404, { error: "not_found" }, origin);
      return json(res, 200, { templates: templates.list() }, origin);
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

// Writes are debounced, so a pending read/star change must be flushed before we
// exit or the user loses it. Tauri kills this sidecar when the window closes,
// which arrives as SIGTERM.
let flushed = false;
function flushAndExit(code: number): void {
  if (!flushed) {
    flushed = true;
    try {
      store.saveNow();
    } catch {
      // Never block shutdown on a failed write.
    }
  }
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(sig, () => flushAndExit(0));
}
process.on("beforeExit", () => {
  if (!flushed) {
    flushed = true;
    try {
      store.saveNow();
    } catch {
      /* ignore */
    }
  }
});
