import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AccountBook } from "./accounts.js";

describe("AccountBook", () => {
  it("stores metadata without writing the password", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-acc-")), "accounts.json");
    const book = new AccountBook(file);
    const row = book.add({
      provider: "gmail",
      email: "you@gmail.com",
      password: "not-a-real-secret",
    });
    expect(row.imap_host).toBe("imap.gmail.com");
    expect(row.secret_ref.startsWith("keyring:")).toBe(true);
    expect(JSON.stringify(book.list())).not.toContain("not-a-real-secret");
  });

  it("rejects tutanota", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-acc-")), "accounts.json");
    const book = new AccountBook(file);
    expect(() =>
      book.add({ provider: "tutanota", email: "a@tuta.com", password: "x" }),
    ).toThrow(/IMAP/);
  });
});
