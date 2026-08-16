import { describe, expect, it } from "vitest";
import { MailStore } from "./store.js";

describe("MailStore list is envelope-only", () => {
  it("does not include bodies in the folder listing", () => {
    const store = MailStore.openMemory();
    store.loadFixture([
      {
        id: "m1",
        accountId: "fixture",
        folder: "INBOX",
        from: "a@b.c",
        to: "you@localhost",
        subject: "hello",
        date: "2026-08-15T00:00:00.000Z",
        unread: true,
        body: "huge body that must not sit in the list payload",
      },
    ]);
    const listed = store.listMessages("fixture", "INBOX");
    expect(listed[0].body).toBe("");
    expect(store.getMessage("m1")?.body).toContain("huge body");
  });
});
