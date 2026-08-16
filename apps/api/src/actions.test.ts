import { describe, expect, it } from "vitest";
import { MailStore } from "./store.js";

function seed() {
  const store = MailStore.openMemory();
  store.loadFixture([
    {
      id: "m1",
      accountId: "fixture",
      folder: "INBOX",
      from: "a@b.c",
      to: "you@localhost",
      subject: "hello",
      date: "2026-08-14T10:00:00.000Z",
      unread: true,
      starred: false,
      body: "pay invoice Friday",
    },
  ]);
  return store;
}

describe("MailStore actions", () => {
  it("stars a message", () => {
    const store = seed();
    store.setStarred("m1", true);
    expect(store.getMessage("m1")?.starred).toBe(true);
  });

  it("archives from inbox", () => {
    const store = seed();
    store.move("m1", "Archive");
    expect(store.getMessage("m1")?.folder).toBe("Archive");
    expect(store.listMessages("fixture", "INBOX")).toHaveLength(0);
    expect(store.listFolders("fixture").map((f) => f.name)).toContain("Archive");
  });

  it("trashes a message", () => {
    const store = seed();
    store.move("m1", "Trash");
    expect(store.getMessage("m1")?.folder).toBe("Trash");
  });

  it("marks unread again", () => {
    const store = seed();
    store.markRead("m1");
    store.markUnread("m1");
    expect(store.getMessage("m1")?.unread).toBe(true);
  });

  it("composes a draft in Drafts", () => {
    const store = seed();
    const draft = store.compose({
      accountId: "fixture",
      to: "priya@example.com",
      subject: "Friday",
      body: "9:30 works.",
    });
    expect(draft.folder).toBe("Drafts");
    expect(draft.from).toBe("you@localhost");
    expect(store.listMessages("fixture", "Drafts")).toHaveLength(1);
  });
});
