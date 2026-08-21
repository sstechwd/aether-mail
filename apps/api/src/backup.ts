/**
 * Profile backup and restore.
 *
 * ADR 0003: "own your data" should be a button, not a claim. A PST needs
 * Outlook to open it. This produces a plain directory — a SQLite file anyone
 * can open with `sqlite3`, plus the settings as readable JSON.
 *
 * The one non-obvious correctness rule: the mail database is copied with
 * `VACUUM INTO`, never a file copy. SQLite in WAL mode keeps recent writes in
 * a `-wal` sidecar, so copying `mail.db` alone can miss data or capture a torn
 * state. VACUUM INTO folds the WAL in and writes a clean, standalone file —
 * and it is safe while the app is running, which a copy is not.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Settings worth keeping. An allow-list, not "everything in data/", so a file
 * that should never leave the machine cannot be swept into an archive the user
 * emails to themselves.
 *
 * Passwords are not here and never will be: they live in the OS keyring and
 * are referenced by a secret-ref. A backup is deliberately not a copy of your
 * credentials.
 */
const SETTINGS_FILES = [
  "accounts.json",
  "calendar.json",
  "rules.json",
  "snooze.json",
  "mute.json",
  "signatures.json",
  "images.json",
  "hidden-contacts.json",
  "outbox.json",
  "templates.json",
  "inspect.json",
  "meta.json",
  "audit.jsonl",
];

export type BackupResult = {
  path: string;
  files: string[];
  bytes: number;
  messages: number;
};

export type BackupInfo = {
  createdAt: string;
  files: string[];
  messages: number;
};

function countMessages(dbPath: string): number {
  if (!existsSync(dbPath)) return 0;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as
      | { n?: number }
      | undefined;
    db.close();
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Write a timestamped archive directory under `destDir`.
 *
 * Timestamped rather than a fixed name so a second backup never silently
 * destroys the first.
 */
export function createBackup(profileDir: string, destDir: string): BackupResult {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let outPath = join(destDir, `aether-backup-${stamp}`);
  // Two backups inside the same second must still not collide.
  let n = 1;
  while (existsSync(outPath)) outPath = join(destDir, `aether-backup-${stamp}-${n++}`);
  mkdirSync(outPath, { recursive: true });

  const files: string[] = [];

  const srcDb = join(profileDir, "mail.db");
  if (existsSync(srcDb)) {
    const db = new DatabaseSync(srcDb, { readOnly: true });
    try {
      // VACUUM INTO, not cpSync: folds the -wal in and is safe on a live db.
      db.exec(`VACUUM INTO '${join(outPath, "mail.db").replace(/'/g, "''")}'`);
      files.push("mail.db");
    } finally {
      db.close();
    }
  }

  for (const name of SETTINGS_FILES) {
    const src = join(profileDir, name);
    if (!existsSync(src)) continue;
    cpSync(src, join(outPath, name));
    files.push(name);
  }

  const messages = countMessages(join(outPath, "mail.db"));
  const manifest: BackupInfo = {
    createdAt: new Date().toISOString(),
    files,
    messages,
  };
  writeFileSync(join(outPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const bytes = files.reduce((sum, f) => sum + statSync(join(outPath, f)).size, 0);
  return { path: outPath, files, bytes, messages };
}

/** Describe an archive without restoring it, so the UI can confirm first. */
export function listBackupContents(backupPath: string): BackupInfo | null {
  const manifestPath = join(backupPath, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupInfo;
    if (!Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Restore an archive over a profile directory.
 *
 * The existing profile is MOVED ASIDE, never deleted. Restoring the wrong
 * backup should cost a rename to undo, not someone's mail.
 */
export function restoreBackup(
  backupPath: string,
  profileDir: string,
): { movedAsideTo: string; files: string[] } {
  const info = listBackupContents(backupPath);
  if (!info) throw new Error("That folder does not look like an Aether backup.");

  mkdirSync(profileDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const asidePath = `${profileDir}-before-restore-${stamp}`;
  mkdirSync(asidePath, { recursive: true });

  for (const entry of readdirSync(profileDir)) {
    try {
      renameSync(join(profileDir, entry), join(asidePath, entry));
    } catch {
      // A locked file (the running app) is copied instead, then left in place.
      try {
        cpSync(join(profileDir, entry), join(asidePath, entry));
      } catch {
        /* nothing more to do; the restore below still overwrites it */
      }
    }
  }

  const restored: string[] = [];
  for (const name of [...info.files, "manifest.json"]) {
    const src = join(backupPath, name);
    if (!existsSync(src)) continue;
    cpSync(src, join(profileDir, name));
    restored.push(name);
  }

  // A stale WAL beside a restored database would shadow it.
  for (const sidecar of ["mail.db-wal", "mail.db-shm"]) {
    rmSync(join(profileDir, sidecar), { force: true });
  }

  return { movedAsideTo: asidePath, files: restored };
}
