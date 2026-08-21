import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqlStore } from "./sqlstore.js";
import { createBackup, listBackupContents, restoreBackup } from "./backup.js";

/**
 * Back up and restore a profile.
 *
 * ADR 0003: "own your data" should be a button, not a claim. A PST needs
 * Outlook to open it; this produces a directory anyone can read with sqlite3
 * and a text editor.
 *
 * The important correctness detail is that the mail database must be copied
 * with VACUUM INTO rather than a file copy. SQLite in WAL mode keeps recent
 * writes in a -wal sidecar, so copying mail.db alone can miss data or capture
 * a torn state.
 */

function profile(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), "aether-profile-"));
  const db = join(dir, "mail.db");
  const store = SqlStore.openFile(db);
  store.loadFixture([
    {
      id: "m1",
      accountId: "acc-1",
      folder: "INBOX",
      from: "priya@example.com",
      to: "me@example.com",
      subject: "Quarterly numbers",
      date: "2026-08-20T10:00:00Z",
      unread: true,
      body: "The Q3 figures are attached.",
    },
  ]);
  store.close();

  writeFileSync(join(dir, "rules.json"), JSON.stringify([{ id: "r1" }]), "utf8");
  writeFileSync(join(dir, "calendar.json"), JSON.stringify([]), "utf8");
  writeFileSync(join(dir, "audit.jsonl"), '{"action":"test"}\n', "utf8");
  return { dir, db };
}

describe("createBackup", () => {
  let src: { dir: string; db: string };
  beforeEach(() => {
    src = profile();
  });

  it("writes an archive directory that exists", () => {
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    expect(existsSync(out.path)).toBe(true);
  });

  it("includes the mail database", () => {
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    expect(existsSync(join(out.path, "mail.db"))).toBe(true);
  });

  it("the copied database is readable on its own", () => {
    // The whole point: a backup you cannot open is not a backup.
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    const restored = SqlStore.openFile(join(out.path, "mail.db"));
    expect(restored.getMessage("m1")?.subject).toBe("Quarterly numbers");
    expect(restored.getMessage("m1")?.body).toContain("Q3 figures");
  });

  it("carries the JSON settings across", () => {
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    expect(existsSync(join(out.path, "rules.json"))).toBe(true);
    expect(existsSync(join(out.path, "calendar.json"))).toBe(true);
  });

  it("never copies a keyring or credential file", () => {
    // Passwords live in the OS keyring. If a file like this ever appears in
    // data/, it must not travel in a backup the user might email to themselves.
    writeFileSync(join(src.dir, "secrets.json"), '{"password":"hunter2"}', "utf8");
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    expect(existsSync(join(out.path, "secrets.json"))).toBe(false);
  });

  it("does not copy the -wal sidecar as a loose file", () => {
    // VACUUM INTO folds the WAL into the copy; shipping a stale -wal alongside
    // it would be worse than useless.
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    expect(existsSync(join(out.path, "mail.db-wal"))).toBe(false);
  });

  it("writes a manifest saying what is inside and when", () => {
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    const manifest = JSON.parse(readFileSync(join(out.path, "manifest.json"), "utf8")) as {
      createdAt: string;
      files: string[];
      messages: number;
    };
    expect(manifest.files).toContain("mail.db");
    expect(manifest.messages).toBe(1);
    expect(Date.parse(manifest.createdAt)).toBeGreaterThan(0);
  });

  it("names the archive with a timestamp so backups do not overwrite", () => {
    const dest = mkdtempSync(join(tmpdir(), "aether-bk-"));
    const a = createBackup(src.dir, dest);
    const b = createBackup(src.dir, dest);
    expect(a.path).not.toBe(b.path);
  });

  it("reports the size so the UI can show it", () => {
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.bytes).toBe(
      out.files.reduce((n, f) => n + statSync(join(out.path, f)).size, 0),
    );
  });
});

describe("listBackupContents", () => {
  it("describes an archive without restoring it", () => {
    const src = profile();
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    const info = listBackupContents(out.path);
    expect(info?.messages).toBe(1);
    expect(info?.files).toContain("mail.db");
  });

  it("returns null for a directory that is not a backup", () => {
    expect(listBackupContents(mkdtempSync(join(tmpdir(), "not-a-backup-")))).toBeNull();
  });
});

describe("restoreBackup", () => {
  it("puts the mail back", () => {
    const src = profile();
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));
    const target = mkdtempSync(join(tmpdir(), "aether-restore-"));

    restoreBackup(out.path, target);
    const store = SqlStore.openFile(join(target, "mail.db"));
    expect(store.getMessage("m1")?.subject).toBe("Quarterly numbers");
  });

  it("moves the existing profile aside rather than destroying it", () => {
    // Restoring over a live profile must be undoable. Silently overwriting
    // someone's mail because they clicked the wrong button is unforgivable.
    const src = profile();
    const out = createBackup(src.dir, mkdtempSync(join(tmpdir(), "aether-bk-")));

    const target = mkdtempSync(join(tmpdir(), "aether-restore-"));
    writeFileSync(join(target, "rules.json"), '["existing"]', "utf8");

    const result = restoreBackup(out.path, target);
    expect(result.movedAsideTo).toBeTruthy();
    expect(existsSync(join(result.movedAsideTo, "rules.json"))).toBe(true);
  });

  it("refuses a directory that is not a backup", () => {
    const notBackup = mkdtempSync(join(tmpdir(), "junk-"));
    const target = mkdtempSync(join(tmpdir(), "aether-restore-"));
    expect(() => restoreBackup(notBackup, target)).toThrow();
  });
});
