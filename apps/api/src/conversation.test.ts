import { describe, expect, it } from "vitest";
import { buildConversation } from "./conversation.js";

/**
 * Conversation view.
 *
 * The list already groups threads, but opening one shows a single message —
 * so a reply is read with its own question missing. On the live inbox 86 of
 * 180 messages sit in multi-message threads, so this is most of the mailbox.
 *
 * The ordering choice matters more than it looks. A conversation is read
 * OLDEST FIRST — that is the order it happened in, and the order that makes a
 * reply comprehensible. The message LIST is newest first, because there you
 * are scanning for what is new. Getting these the same way round is a common
 * and confusing mistake.
 */

type Row = {
  id: string;
  subject: string;
  from: string;
  date: string;
  unread?: boolean;
  body?: string;
};

function m(id: string, subject: string, date: string, extra: Partial<Row> = {}): Row {
  return { id, subject, from: "a@b.example", date, ...extra };
}

describe("buildConversation", () => {
  it("returns just the message when nothing else matches", () => {
    const rows = [m("1", "Standalone", "2026-01-01T10:00:00Z")];
    const convo = buildConversation(rows, "1");
    expect(convo.messages).toHaveLength(1);
    expect(convo.messages[0].id).toBe("1");
  });

  it("gathers every message in the thread", () => {
    const rows = [
      m("1", "Lunch?", "2026-01-01T10:00:00Z"),
      m("2", "Re: Lunch?", "2026-01-01T11:00:00Z"),
      m("3", "Re: Lunch?", "2026-01-01T12:00:00Z"),
      m("9", "Unrelated", "2026-01-01T13:00:00Z"),
    ];
    expect(buildConversation(rows, "2").messages.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("reads oldest first, the order it happened in", () => {
    const rows = [
      m("3", "Re: Lunch?", "2026-01-03T10:00:00Z"),
      m("1", "Lunch?", "2026-01-01T10:00:00Z"),
      m("2", "Re: Lunch?", "2026-01-02T10:00:00Z"),
    ];
    expect(buildConversation(rows, "1").messages.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("marks which message was asked for, so the UI can scroll to it", () => {
    const rows = [
      m("1", "Lunch?", "2026-01-01T10:00:00Z"),
      m("2", "Re: Lunch?", "2026-01-02T10:00:00Z"),
    ];
    const convo = buildConversation(rows, "2");
    expect(convo.focusId).toBe("2");
  });

  it("matches Fwd: and Fw: as well as Re:", () => {
    const rows = [
      m("1", "Budget", "2026-01-01T10:00:00Z"),
      m("2", "Fwd: Budget", "2026-01-02T10:00:00Z"),
      m("3", "FW: Budget", "2026-01-03T10:00:00Z"),
    ];
    expect(buildConversation(rows, "1").messages).toHaveLength(3);
  });

  it("counts unread within the conversation", () => {
    const rows = [
      m("1", "Lunch?", "2026-01-01T10:00:00Z", { unread: true }),
      m("2", "Re: Lunch?", "2026-01-02T10:00:00Z"),
      m("3", "Re: Lunch?", "2026-01-03T10:00:00Z", { unread: true }),
    ];
    expect(buildConversation(rows, "1").unread).toBe(2);
  });

  it("keeps a message with an unparseable date rather than dropping it", () => {
    // Real mail carries malformed dates. Hiding a message is worse than
    // showing it out of order.
    const rows = [
      m("1", "Lunch?", "not a date"),
      m("2", "Re: Lunch?", "2026-01-02T10:00:00Z"),
    ];
    expect(buildConversation(rows, "2").messages).toHaveLength(2);
  });

  it("returns an empty conversation when the id is unknown", () => {
    expect(buildConversation([m("1", "x", "2026-01-01T10:00:00Z")], "nope").messages).toEqual([]);
  });

  it("does not merge two different threads that share a word", () => {
    const rows = [
      m("1", "Invoice", "2026-01-01T10:00:00Z"),
      m("2", "Invoice for March", "2026-01-02T10:00:00Z"),
    ];
    expect(buildConversation(rows, "1").messages).toHaveLength(1);
  });

  it("caps a runaway thread so one conversation cannot pull the whole folder", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      m(String(i), "Re: Newsletter", `2026-01-01T10:${String(i % 60).padStart(2, "0")}:00Z`),
    );
    const convo = buildConversation(rows, "5");
    expect(convo.messages.length).toBeLessThanOrEqual(100);
    // The asked-for message must survive the cap, or the pane opens blank.
    expect(convo.messages.some((x) => x.id === "5")).toBe(true);
    expect(convo.truncated).toBe(true);
  });
});
