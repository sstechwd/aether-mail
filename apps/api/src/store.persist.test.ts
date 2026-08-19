import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailStore } from "./store.js";

describe("MailStore persist", () => {
  it("reloads messages from a json file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-store-"));
    const file = join(dir, "mail.json");
    const first = MailStore.openFile(file);
    first.loadFixture([
      {
        id: "p1",
        accountId: "fixture",
        folder: "INBOX",
        from: "a@b.c",
        to: "you@localhost",
        subject: "persisted",
        date: "2026-08-13T00:00:00.000Z",
        unread: true,
        body: "hello",
      },
    ]);
    // saveNow(): save() is debounced, so tests and shutdown force the flush.
    first.saveNow();

    const second = MailStore.openFile(file);
    expect(second.getMessage("p1")?.subject).toBe("persisted");
    second.markRead("p1");
    second.saveNow();
    const third = MailStore.openFile(file);
    expect(third.getMessage("p1")?.unread).toBe(false);
  });
});
