/**
 * Cross-folder smoke sweep.
 *
 * The attachment bug survived for weeks because every test and every manual
 * check used INBOX — the one folder whose canonical and remote names match.
 * That is a bug SHAPE, not a one-off, so this exercises the same operations
 * against every folder and reports where they diverge.
 *
 * STRICTLY READ-ONLY. Every request here is a GET. Nothing moves, deletes,
 * sends, or contacts a third party — after unsubscribing the user from a real
 * newsletter by testing a refusal path against live data, the rule is that a
 * sweep like this may never have a side effect.
 */

const BASE = "http://127.0.0.1:8787";
const H = { Origin: "http://tauri.localhost" };

type Row = { folder: string; check: string; result: string; ok: boolean };
const rows: Row[] = [];

function note(folder: string, check: string, ok: boolean, result: string): void {
  rows.push({ folder, check, ok, result });
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: H });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const folders = await getJson<{ folders: Array<{ name: string; total: number }> }>(
    "/api/folders",
  );
  if (!folders) {
    console.log("API not reachable");
    process.exit(1);
  }

  for (const f of folders.folders) {
    const enc = encodeURIComponent(f.name);

    // 1. Listing
    const list = await getJson<{ messages?: Array<{ id: string }> }>(
      `/api/messages?folder=${enc}`,
    );
    const msgs = list?.messages ?? [];
    note(f.name, "list", msgs.length > 0 || f.total === 0, `${msgs.length} rows (store says ${f.total})`);
    if (!msgs.length) continue;

    const id = encodeURIComponent(msgs[0].id);

    // 2. Opening a message
    const opened = await getJson<{ message?: { subject?: string }; attachments?: unknown[] }>(
      `/api/messages/${id}`,
    );
    note(f.name, "open", !!opened?.message, opened?.message ? "ok" : "FAILED");

    // 3. Conversation
    const convo = await getJson<{ messages?: unknown[] }>(`/api/messages/${id}/conversation`);
    note(f.name, "conversation", Array.isArray(convo?.messages), `${convo?.messages?.length ?? 0} in thread`);

    // 4. Unsubscribe availability (GET only — never POST)
    const uns = await getJson<{ available?: boolean }>(`/api/messages/${id}/unsubscribe`);
    note(f.name, "unsubscribe(read)", uns !== null, uns?.available ? "offered" : "none");

    // 5. Threaded listing
    const threaded = await getJson<{ messages?: unknown[] }>(
      `/api/messages?folder=${enc}&threaded=1`,
    );
    note(f.name, "threaded", Array.isArray(threaded?.messages), `${threaded?.messages?.length ?? 0} threads`);

    // 6. Attachment fetch — the operation that was broken outside INBOX.
    //    NOTE: the list row's `attachments` is an ARRAY, not a count. Testing
    //    `> 0` on it is always false, which silently reported "none in folder"
    //    for every folder on the first run of this sweep.
    const withAttach = await getJson<{
      messages?: Array<{ id: string; attachments?: unknown[] }>;
    }>(`/api/messages?folder=${enc}`);
    const candidate = (withAttach?.messages ?? []).find(
      (m) => Array.isArray(m.attachments) && m.attachments.length > 0,
    );
    if (candidate) {
      const meta = await getJson<{ attachments?: Array<{ part: number; preview?: string }> }>(
        `/api/messages/${encodeURIComponent(candidate.id)}`,
      );
      const att = meta?.attachments?.[0];
      if (att) {
        try {
          const r = await fetch(
            `${BASE}/api/messages/${encodeURIComponent(candidate.id)}/parts/${att.part}`,
            { headers: H },
          );
          const bytes = (await r.arrayBuffer()).byteLength;
          note(f.name, "attachment", r.ok && bytes > 0, `HTTP ${r.status}, ${bytes} bytes`);
        } catch (e) {
          note(f.name, "attachment", false, `threw: ${e instanceof Error ? e.message : e}`);
        }
      }
    } else {
      note(f.name, "attachment", true, "none in folder");
    }
  }

  // Search is folder-wide; check it returns something for a common word.
  const search = await getJson<{ messages?: unknown[] }>("/api/search?q=the");
  note("(all)", "search", Array.isArray(search?.messages), `${search?.messages?.length ?? 0} hits`);

  console.log("\nfolder     check              result");
  console.log("-".repeat(62));
  for (const r of rows) {
    console.log(
      `${r.ok ? "  " : "!!"} ${r.folder.padEnd(9)} ${r.check.padEnd(18)} ${r.result}`,
    );
  }
  const bad = rows.filter((r) => !r.ok);
  console.log("-".repeat(62));
  console.log(bad.length === 0 ? "all checks passed" : `${bad.length} FAILING`);
}

void main();
