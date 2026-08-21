import { describe, expect, it } from "vitest";
import { mergeAccounts, type UnifiedRow } from "./unified.js";

/**
 * Unified inbox.
 *
 * With one account this is identical to the inbox, so the UI only offers it
 * when there are two or more. The merge itself still has to be right: rows
 * from different accounts interleave by date, and each row has to say which
 * account it came from or replying gets confusing fast.
 */

const A = [
  { id: "a1", from: "x@example.com", subject: "newest", date: "2026-08-20T12:00:00Z", unread: true },
  { id: "a2", from: "x@example.com", subject: "older", date: "2026-08-18T09:00:00Z", unread: false },
];

const B = [
  { id: "b1", from: "y@example.com", subject: "middle", date: "2026-08-19T15:00:00Z", unread: true },
];

describe("mergeAccounts", () => {
  it("interleaves by date, newest first", () => {
    const rows = mergeAccounts([
      { accountId: "acc-a", email: "me@a.example", messages: A },
      { accountId: "acc-b", email: "me@b.example", messages: B },
    ]);
    expect(rows.map((r) => r.subject)).toEqual(["newest", "middle", "older"]);
  });

  it("tags every row with the account it came from", () => {
    const rows = mergeAccounts([
      { accountId: "acc-a", email: "me@a.example", messages: A },
      { accountId: "acc-b", email: "me@b.example", messages: B },
    ]);
    const middle = rows.find((r) => r.subject === "middle") as UnifiedRow;
    expect(middle.accountId).toBe("acc-b");
    expect(middle.accountEmail).toBe("me@b.example");
  });

  it("returns an empty list when there are no accounts", () => {
    expect(mergeAccounts([])).toEqual([]);
  });

  it("handles an account with no mail", () => {
    const rows = mergeAccounts([
      { accountId: "acc-a", email: "me@a.example", messages: A },
      { accountId: "acc-b", email: "me@b.example", messages: [] },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("does not lose messages that have an unparseable date", () => {
    // Real mail carries broken Date headers. Dropping those rows would hide
    // mail from the user, which is worse than showing it in the wrong order.
    const rows = mergeAccounts([
      {
        accountId: "acc-a",
        email: "me@a.example",
        messages: [{ id: "bad", from: "z@example.com", subject: "no date", date: "", unread: false }],
      },
    ]);
    expect(rows).toHaveLength(1);
  });

  it("caps the result so a huge mailbox cannot stall the list", () => {
    const many = Array.from({ length: 900 }, (_, i) => ({
      id: `m${i}`,
      from: "x@example.com",
      subject: `s${i}`,
      date: new Date(2026, 0, 1, 0, i).toISOString(),
      unread: false,
    }));
    const rows = mergeAccounts([{ accountId: "acc-a", email: "me@a.example", messages: many }], 200);
    expect(rows).toHaveLength(200);
    // Still the newest ones, not an arbitrary slice.
    expect(rows[0].subject).toBe("s899");
  });

  it("keeps ids unique across accounts", () => {
    // Two accounts can hold the same provider uid; the row id must stay unique
    // or React reuses the wrong row and the reading pane opens the wrong mail.
    const dup = [{ id: "same", from: "x@example.com", subject: "dup", date: "2026-08-20T10:00:00Z", unread: false }];
    const rows = mergeAccounts([
      { accountId: "acc-a", email: "me@a.example", messages: dup },
      { accountId: "acc-b", email: "me@b.example", messages: dup },
    ]);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
  });
});
