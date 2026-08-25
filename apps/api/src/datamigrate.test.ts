import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDataDir } from "./datamigrate.js";

/**
 * Moving an existing mailbox to the new location.
 *
 * This runs once, on someone's real mail, unattended, at startup. The only
 * acceptable failure mode is "did nothing" — never "moved half of it".
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aether-migrate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedLegacy(files: Record<string, string>): string {
  const legacy = join(root, "legacy");
  mkdirSync(legacy, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(legacy, name), body);
  return legacy;
}

describe("migrateDataDir", () => {
  it("copies a legacy mailbox to the new location", () => {
    const legacy = seedLegacy({ "mail.db": "DBDATA", "rules.json": "[]" });
    const dest = join(root, "new");

    const result = migrateDataDir(legacy, dest);

    expect(result.migrated).toBe(true);
    expect(readFileSync(join(dest, "mail.db"), "utf8")).toBe("DBDATA");
    expect(readFileSync(join(dest, "rules.json"), "utf8")).toBe("[]");
  });

  it("LEAVES THE ORIGINAL IN PLACE", () => {
    // Copy, never move. If the copy is wrong the user still has their mail,
    // and a failed move at 2am is unrecoverable.
    const legacy = seedLegacy({ "mail.db": "DBDATA" });
    migrateDataDir(legacy, join(root, "new"));
    expect(existsSync(join(legacy, "mail.db"))).toBe(true);
  });

  it("never overwrites an existing mailbox", () => {
    // The destination already has mail: that mail wins, always.
    const legacy = seedLegacy({ "mail.db": "OLD" });
    const dest = join(root, "new");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "mail.db"), "CURRENT");

    const result = migrateDataDir(legacy, dest);

    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("destination_in_use");
    expect(readFileSync(join(dest, "mail.db"), "utf8")).toBe("CURRENT");
  });

  it("does nothing when there is no legacy directory", () => {
    const result = migrateDataDir(join(root, "nope"), join(root, "new"));
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("nothing_to_do");
  });

  it("skips SQLite sidecar files rather than copying a torn state", () => {
    // -wal and -shm belong to a live connection. Copying them alongside a db
    // can present SQLite with a mismatched pair; the db alone is consistent.
    const legacy = seedLegacy({
      "mail.db": "DBDATA",
      "mail.db-wal": "WAL",
      "mail.db-shm": "SHM",
    });
    const dest = join(root, "new");

    migrateDataDir(legacy, dest);

    expect(existsSync(join(dest, "mail.db"))).toBe(true);
    expect(existsSync(join(dest, "mail.db-wal"))).toBe(false);
    expect(existsSync(join(dest, "mail.db-shm"))).toBe(false);
  });

  it("copies every settings file, not just the database", () => {
    const legacy = seedLegacy({
      "mail.db": "DB",
      "accounts.json": "{}",
      "rules.json": "[]",
      "signatures.json": "{}",
      "calendar.json": "{}",
    });
    const dest = join(root, "new");

    const result = migrateDataDir(legacy, dest);

    expect(result.files).toBe(5);
    for (const f of ["accounts.json", "rules.json", "signatures.json", "calendar.json"]) {
      expect(existsSync(join(dest, f))).toBe(true);
    }
  });

  it("reports the file count it actually copied", () => {
    const legacy = seedLegacy({ "mail.db": "DB", "rules.json": "[]" });
    expect(migrateDataDir(legacy, join(root, "new")).files).toBe(2);
  });

  it("does not migrate a legacy directory with no database", () => {
    // Leftover config without mail is not a mailbox worth moving.
    const legacy = seedLegacy({ "images.json": "{}" });
    const result = migrateDataDir(legacy, join(root, "new"));
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("nothing_to_do");
  });
});
