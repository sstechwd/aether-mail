import { describe, expect, it } from "vitest";
import { MailStore } from "./store.js";

describe("mark folder read", () => {
  it("clears unread in one folder only", () => {
    const store = MailStore.openMemory();
    store.loadFixture([
      {
        id: "a",
        accountId: "fixture",
        folder: "INBOX",
        from: "a@b.c",
        to: "you@localhost",
        subject: "one",
        date: "2026-08-17T00:00:00.000Z",
        unread: true,
        body: "x",
      },
      {
        id: "b",
        accountId: "fixture",
        folder: "INBOX",
        from: "a@b.c",
        to: "you@localhost",
        subject: "two",
        date: "2026-08-17T00:01:00.000Z",
        unread: true,
        body: "y",
      },
    ]);
    store.markFolderRead("fixture", "INBOX");
    expect(store.listFolders("fixture")[0].unread).toBe(0);
  });
});
