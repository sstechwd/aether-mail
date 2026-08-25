/**
 * Move an existing mailbox to the new data directory.
 *
 * This runs ONCE, unattended, at startup, on someone's real mail. The only
 * acceptable failure mode is "did nothing" — never "moved half of it".
 *
 * Three rules follow from that:
 *
 *  - COPY, never move. If the copy is wrong the user still has their mail. A
 *    half-completed move has no recovery.
 *  - The destination always wins. If there is already a mailbox there, stop:
 *    overwriting live mail with an older copy is the worst outcome available.
 *  - Skip SQLite's -wal and -shm sidecars. They belong to a live connection,
 *    and copying a mismatched pair can present SQLite with a torn state. The
 *    .db alone is consistent, because the old process checkpoints on exit.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type MigrationResult = {
  migrated: boolean;
  files: number;
  reason?: "nothing_to_do" | "destination_in_use" | "failed";
  error?: string;
};

/** Sidecars of a live SQLite connection: never copied. */
const SKIP = /\.(db-wal|db-shm)$/i;

export function migrateDataDir(legacyDir: string, destDir: string): MigrationResult {
  // No database in the old place means there is no mailbox to move. Leftover
  // config on its own is not worth migrating.
  if (!existsSync(path.join(legacyDir, "mail.db"))) {
    return { migrated: false, files: 0, reason: "nothing_to_do" };
  }

  // Live mail at the destination always wins.
  if (existsSync(path.join(destDir, "mail.db"))) {
    return { migrated: false, files: 0, reason: "destination_in_use" };
  }

  try {
    mkdirSync(destDir, { recursive: true });

    let files = 0;
    for (const name of readdirSync(legacyDir)) {
      if (SKIP.test(name)) continue;
      const from = path.join(legacyDir, name);
      // Top-level files only: the data directory is flat by design, and
      // recursing would be a surprise on a directory we did not create.
      if (!statSync(from).isFile()) continue;
      copyFileSync(from, path.join(destDir, name));
      files += 1;
    }

    return { migrated: true, files };
  } catch (e) {
    // A failed migration must not stop the app from starting: the old
    // directory is untouched, so the user's mail is still there.
    return {
      migrated: false,
      files: 0,
      reason: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
