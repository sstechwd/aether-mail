import { describe, expect, it } from "vitest";
import { threadKey, groupIntoThreads, normalizeSubject } from "./threading.js";

/**
 * Threading is what makes a mailbox readable. Mail clients group by
 * References/In-Reply-To when present, and fall back to a normalized subject
 * when a sender strips those headers (many mailing lists and phones do).
 */

describe("normalizeSubject", () => {
  it("strips a reply prefix", () => {
    expect(normalizeSubject("Re: Q3 numbers")).toBe("q3 numbers");
    expect(normalizeSubject("RE: Q3 numbers")).toBe("q3 numbers");
  });

  it("strips a forward prefix", () => {
    expect(normalizeSubject("Fwd: Q3 numbers")).toBe("q3 numbers");
    expect(normalizeSubject("FW: Q3 numbers")).toBe("q3 numbers");
  });

  it("strips stacked prefixes, which real threads accumulate", () => {
    expect(normalizeSubject("Re: Fwd: Re: Q3 numbers")).toBe("q3 numbers");
  });

  it("strips a mailing-list tag", () => {
    expect(normalizeSubject("[rust-users] Re: lifetimes")).toBe("lifetimes");
  });

  it("leaves an ordinary subject alone apart from case", () => {
    expect(normalizeSubject("Design review")).toBe("design review");
  });

  it("does not turn an empty subject into a match-everything key", () => {
    expect(normalizeSubject("")).toBe("");
    expect(normalizeSubject("Re:")).toBe("");
  });
});

describe("threadKey", () => {
  it("prefers References, because that is what the spec is for", () => {
    const key = threadKey({
      subject: "Re: anything",
      headers: "References: <root@example.com> <second@example.com>",
    });
    expect(key).toBe("<root@example.com>");
  });

  it("uses In-Reply-To when there is no References chain", () => {
    const key = threadKey({
      subject: "Re: anything",
      headers: "In-Reply-To: <root@example.com>",
    });
    expect(key).toBe("<root@example.com>");
  });

  it("falls back to the normalized subject when headers are missing", () => {
    expect(threadKey({ subject: "Re: Q3 numbers", headers: "" })).toBe("subj:q3 numbers");
  });

  it("gives an unthreadable message its own key rather than pooling them", () => {
    const a = threadKey({ subject: "", headers: "", id: "a" });
    const b = threadKey({ subject: "", headers: "", id: "b" });
    expect(a).not.toBe(b);
  });
});

describe("groupIntoThreads", () => {
  const MESSAGES = [
    { id: "1", subject: "Q3 numbers", from: "priya@example.com", date: "2026-08-18T10:00:00Z", headers: "Message-ID: <root@example.com>", unread: false },
    { id: "2", subject: "Re: Q3 numbers", from: "me@example.com", date: "2026-08-18T11:00:00Z", headers: "References: <root@example.com>", unread: false },
    { id: "3", subject: "Re: Q3 numbers", from: "priya@example.com", date: "2026-08-18T12:00:00Z", headers: "References: <root@example.com>", unread: true },
    { id: "4", subject: "Lunch?", from: "ana@example.com", date: "2026-08-19T09:00:00Z", headers: "", unread: false },
  ];

  it("collapses a conversation into one row", () => {
    const threads = groupIntoThreads(MESSAGES);
    expect(threads).toHaveLength(2);
  });

  it("shows the newest message as the thread summary", () => {
    const [newest] = groupIntoThreads(MESSAGES);
    expect(newest.latest.id).toBe("4");
  });

  it("counts the messages in a thread", () => {
    const q3 = groupIntoThreads(MESSAGES).find((t) => t.latest.subject.includes("Q3"));
    expect(q3?.count).toBe(3);
  });

  it("marks a thread unread when any message in it is unread", () => {
    const q3 = groupIntoThreads(MESSAGES).find((t) => t.latest.subject.includes("Q3"));
    expect(q3?.unread).toBe(true);
  });

  it("sorts threads by their newest message, not by when they started", () => {
    const threads = groupIntoThreads(MESSAGES);
    expect(threads[0].latest.id).toBe("4");
    expect(threads[1].latest.id).toBe("3");
  });

  it("lists every participant once so the row can say who is involved", () => {
    const q3 = groupIntoThreads(MESSAGES).find((t) => t.latest.subject.includes("Q3"));
    expect(q3?.participants).toContain("priya@example.com");
    expect(q3?.participants).toContain("me@example.com");
    expect(q3?.participants).toHaveLength(2);
  });

  it("keeps every message id so opening a thread can show the whole exchange", () => {
    const q3 = groupIntoThreads(MESSAGES).find((t) => t.latest.subject.includes("Q3"));
    expect(q3?.ids).toEqual(expect.arrayContaining(["1", "2", "3"]));
  });

  it("handles an empty mailbox without throwing", () => {
    expect(groupIntoThreads([])).toEqual([]);
  });

  it("does not merge unrelated mail that happens to have no subject", () => {
    const blanks = [
      { id: "x", subject: "", from: "a@example.com", date: "2026-08-18T10:00:00Z", headers: "", unread: false },
      { id: "y", subject: "", from: "b@example.com", date: "2026-08-18T11:00:00Z", headers: "", unread: false },
    ];
    expect(groupIntoThreads(blanks)).toHaveLength(2);
  });
});
