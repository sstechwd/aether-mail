/**
 * Black-box fuzzing of the local API.
 *
 * Run against a live server:
 *   npx tsx apps/api/src/index.ts        # in one shell
 *   npx tsx scripts/fuzz-api.ts          # in another
 *
 * Read-only and reversible only: it never sends mail and never deletes. The
 * outbox endpoints it touches are list/cancel on bogus ids.
 *
 * A 500, a hang, a stack trace in the response body, or a dead process is a
 * bug. This found three real ones on first run — routes that returned 500 with
 * the internal error text when handed a body of the wrong shape.
 *
 * Known non-bug: the "2MB body" case reports a fetch failure. That is correct —
 * readBody() enforces MAX_BODY_BYTES and destroys the socket, which the client
 * sees as a dropped connection rather than an HTTP status.
 */

const BASE = "http://127.0.0.1:8787";
const ORIGIN = "http://tauri.localhost";

type Result = { name: string; status: number | string; note: string; bug: boolean };
const results: Result[] = [];

async function hit(
  name: string,
  path: string,
  init: RequestInit = {},
  opts: { expect?: number[]; origin?: string | null } = {},
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.Origin = origin;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal });
    const text = await res.text();
    const leaksStack = /at\s+\w+\s+\(|node:internal|\.ts:\d+:\d+/.test(text);
    const expected = opts.expect;
    const unexpected = expected ? !expected.includes(res.status) : res.status >= 500;
    results.push({
      name,
      status: res.status,
      note: leaksStack ? "LEAKS STACK TRACE" : text.slice(0, 90).replace(/\s+/g, " "),
      bug: res.status >= 500 || leaksStack || Boolean(unexpected),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, status: "ERR", note: msg.slice(0, 90), bug: true });
  } finally {
    clearTimeout(timer);
  }
}

const BIG = "A".repeat(2_000_000);
const HUGE_ARRAY = JSON.stringify({ attachments: Array.from({ length: 50_000 }, (_, i) => `f${i}.txt`) });

async function main(): Promise<void> {
  // --- baseline: these must work ---
  await hit("health", "/api/health", {}, { expect: [200] });
  await hit("folders", "/api/folders", {}, { expect: [200] });
  await hit("messages", "/api/messages?folder=INBOX", {}, { expect: [200] });
  await hit("threaded", "/api/messages?folder=INBOX&threaded=1", {}, { expect: [200] });

  // --- CORS: the security boundary ---
  await hit("hostile origin", "/api/messages", {}, { origin: "https://evil.example", expect: [403] });
  await hit("lookalike origin", "/api/folders", {}, { origin: "http://tauri.localhost.evil.example", expect: [403] });
  await hit("no origin (curl)", "/api/health", {}, { origin: null, expect: [200] });

  // --- path traversal on fileinfo ---
  await hit("traversal ../..", `/api/fileinfo?path=${encodeURIComponent("../../../../Windows/win.ini")}`);
  await hit("absolute win.ini", `/api/fileinfo?path=${encodeURIComponent("C:/Windows/win.ini")}`);
  await hit("null byte", `/api/fileinfo?path=${encodeURIComponent("C:/Windows/win.ini\u0000.txt")}`);
  await hit("fileinfo no arg", "/api/fileinfo", {}, { expect: [400] });

  // --- malformed bodies ---
  await hit("compose/reply garbage", "/api/compose/reply", { method: "POST", body: "not json at all" });
  await hit("compose/reply empty", "/api/compose/reply", { method: "POST", body: "{}", }, { expect: [404] });
  await hit("compose/reply wrong types", "/api/compose/reply", {
    method: "POST",
    body: JSON.stringify({ messageId: 12345, mode: ["array"] }),
  });
  await hit("signature wrong type", "/api/signature", {
    method: "POST",
    body: JSON.stringify({ signature: { nested: true } }),
  });
  await hit("signature huge", "/api/signature", {
    method: "POST",
    body: JSON.stringify({ signature: BIG.slice(0, 500_000) }),
  });
  await hit("calendar no invite", "/api/calendar/ics", { method: "POST", body: "{}" }, { expect: [400] });
  await hit("calendar junk invite", "/api/calendar/ics", {
    method: "POST",
    body: JSON.stringify({ invite: { summary: 42, start: "not-a-date", attendees: "notanarray" } }),
  });
  await hit("send huge attachment list", "/api/send", { method: "POST", body: HUGE_ARRAY });

  // --- query-string abuse ---
  await hit("contacts empty q", "/api/contacts?q=");
  await hit("contacts unicode", `/api/contacts?q=${encodeURIComponent("🔥💀 SELECT * FROM")}`);
  await hit("contacts huge q", `/api/contacts?q=${encodeURIComponent("a".repeat(100_000))}`);
  await hit("folder crlf", `/api/messages?folder=${encodeURIComponent("INBOX\r\nX-Inject: 1")}`);
  await hit("folder traversal", `/api/messages?folder=${encodeURIComponent("../../etc/passwd")}`);
  await hit("threaded on missing folder", "/api/messages?folder=DoesNotExist&threaded=1", {}, { expect: [200] });

  // --- outbox (safe: queue nothing, just read + bogus ids) ---
  await hit("outbox list", "/api/outbox", {}, { expect: [200] });
  await hit("cancel bogus id", "/api/outbox/does-not-exist/cancel", { method: "POST" }, { expect: [404] });
  await hit("cancel traversal id", `/api/outbox/${encodeURIComponent("../../etc")}/cancel`, { method: "POST" }, { expect: [404] });
  await hit("retry bogus id", "/api/outbox/nope/retry", { method: "POST" }, { expect: [404] });

  // --- oversized body: MAX_BODY_BYTES destroys the socket, so the client sees
  // a dropped connection rather than a status. That is the guard working. ---
  await hit("2MB body (expect drop)", "/api/signature", {
    method: "POST",
    body: JSON.stringify({ signature: BIG }),
  });
  // Reclassify: a connection drop here is correct behaviour, not a bug.
  const oversized = results[results.length - 1];
  if (oversized.status === "ERR") {
    oversized.bug = false;
    oversized.note = "connection dropped by MAX_BODY_BYTES guard (correct)";
  }

  // --- is it still alive? ---
  await hit("health after fuzzing", "/api/health", {}, { expect: [200] });

  const bugs = results.filter((r) => r.bug);
  for (const r of results) {
    const flag = r.bug ? "BUG " : "ok  ";
    console.log(`${flag} ${String(r.status).padStart(4)}  ${r.name.padEnd(28)} ${r.note}`);
  }
  console.log(`\n${results.length} requests, ${bugs.length} suspicious`);
  // Non-zero exit when something looks wrong, so CI can gate on it.
  if (bugs.length > 0) process.exitCode = 1;
}

void main();
