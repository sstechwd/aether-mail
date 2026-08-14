/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import { MailStore } from "./store.js";

describe("MailStore", () => {
  it("loads fixture folders and messages into a fresh db", () => {
    const store = MailStore.openMemory();
    store.loadFixture([
      {
        id: "m1",
        accountId: "fixture",
        folder: "INBOX",
        from: "Ada Lovelace <ada@example.com>",
        to: "you@localhost",
        subject: "Analytical Engine notes",
        date: "2026-08-12T10:00:00.000Z",
        unread: true,
        body: "Can you review the punch-card sequence before Friday?",
      },
    ]);

    const folders = store.listFolders("fixture");
    expect(folders.map((f) => f.name)).toContain("INBOX");
    expect(folders.find((f) => f.name === "INBOX")?.unread).toBe(1);

    const messages = store.listMessages("fixture", "INBOX");
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe("Analytical Engine notes");
    expect(store.getMessage("m1")?.body).toMatch(/punch-card/);
  });

  it("marks a message read without deleting the body", () => {
    const store = MailStore.openMemory();
    store.loadFixture([
      {
        id: "m2",
        accountId: "fixture",
        folder: "INBOX",
        from: "boss@example.com",
        to: "you@localhost",
        subject: "Status?",
        date: "2026-08-13T09:00:00.000Z",
        unread: true,
        body: "Need the report.",
      },
    ]);
    store.markRead("m2");
    expect(store.getMessage("m2")?.unread).toBe(false);
    expect(store.getMessage("m2")?.body).toBe("Need the report.");
  });
});
