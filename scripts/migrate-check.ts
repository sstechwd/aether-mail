/**
 * Migrate the live mailbox into SQLite and measure the difference.
 *
 * Reads data/mail.json, writes a scratch database, reports what changed, then
 * deletes the scratch db. Non-destructive: the JSON file is never touched.
 */
import { statSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlStore } from "../apps/api/src/sqlstore.js";

const jsonPath = "data/mail.json";
if (!existsSync(jsonPath)) {
  console.log("no data/mail.json — nothing to migrate");
  process.exit(0);
}

const dbPath = join(tmpdir(), `aether-migrate-${Date.now()}.db`);
const jsonBytes = statSync(jsonPath).size;

const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as Array<{
  id?: string;
  accountId?: string;
  folder?: string;
  body?: string;
}>;

const accountList: string[] = [];
for (const m of raw) {
  const id = m.accountId ?? "";
  if (!accountList.includes(id)) accountList.push(id);
}

const t0 = Date.now();
const store = SqlStore.openFile(dbPath, jsonPath);
const migrateMs = Date.now() - t0;

console.log("=== migration ===");
console.log(`  json messages : ${raw.length}`);
console.log(`  json size     : ${(jsonBytes / 1048576).toFixed(2)} MB`);
console.log(`  migrate time  : ${migrateMs} ms`);

let dbTotal = 0;
for (const acct of accountList) {
  const summary = store.listFolders(acct);
  for (const f of summary) dbTotal += f.total;
  console.log(`  folders for ${acct.slice(0, 14)}…`);
  for (const f of summary) {
    console.log(`      ${f.name.padEnd(10)} ${String(f.total).padStart(4)}  (${f.unread} unread)`);
  }
}

const dbBytes = statSync(dbPath).size;
console.log(`  db messages   : ${dbTotal}`);
console.log(`  db size       : ${(dbBytes / 1048576).toFixed(2)} MB`);
console.log(`  nothing lost  : ${dbTotal === raw.length}`);

// Search timing on the real corpus. Use the account with the most mail —
// the store also holds a small demo fixture account, and searching that one
// makes a working index look broken.
let acct = accountList[0] ?? "";
let best = -1;
for (const candidate of accountList) {
  const size = store.listFolders(candidate).reduce((n, f) => n + f.total, 0);
  if (size > best) {
    best = size;
    acct = candidate;
  }
}
console.log(`  searching account ${acct.slice(0, 14)}… (${best} messages)`);
for (const term of ["invoice", "the", "meeting"]) {
  const s = Date.now();
  const hits = store.search(acct, term);
  console.log(`  search "${term}": ${hits.length} hits in ${Date.now() - s} ms`);
}

// A body must survive the round trip, not just the envelope.
const withBody = raw.find((m) => m.body && m.id);
if (withBody?.id) {
  const got = store.getMessage(withBody.id);
  const ok = (got?.body ?? "").slice(0, 60) === (withBody.body ?? "").slice(0, 60);
  console.log(`  body intact   : ${ok}`);
}

store.close();
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
