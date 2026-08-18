import { describe, expect, it } from "vitest";
import { MailStore } from "./store.js";

function row(partial: Partial<Parameters<MailStore["loadFixture"]>[0][number]> & { id: string; accountId: string; date: string }) {
  return {
    folder: "INBOX",
    from: "a@b.c",
    to: "you@localhost",
    subject: partial.id,
    unread: true,
    body: "secret",
    ...partial,
  };
}

describe("MailStore isolation and sort", () => {
  it("never lists the other account and sorts by real time newest-first", () => {
    const store = MailStore.openMemory();
    store.loadFixture([
      row({ id: "old-rfc", accountId: "gmail", date: "Mon, 01 Jan 2024 12:00:00 +0000", subject: "old" }),
      row({ id: "new-iso", accountId: "gmail", date: "2026-08-18T15:00:00.000Z", subject: "new" }),
      row({ id: "fix", accountId: "fixture", date: "2026-08-18T20:00:00.000Z", subject: "fixture only" }),
    ]);
    const gmail = store.listMessages("gmail", "INBOX");
    expect(gmail.map((m) => m.subject)).toEqual(["new", "old"]);
    expect(gmail.every((m) => m.accountId === "gmail")).toBe(true);
    const local = store.listMessages("fixture", "INBOX");
    expect(local).toHaveLength(1);
    expect(local[0].subject).toBe("fixture only");
  });
});
