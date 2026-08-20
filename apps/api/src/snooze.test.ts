import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnoozeBook, snoozeUntil } from "./snooze.js";

/**
 * Snooze: hide a message until a chosen time, then put it back in the inbox.
 *
 * The Outbox already proved the pattern — a persisted queue with a due time,
 * drained by a worker at startup and on a tick — so snooze reuses the shape
 * rather than inventing a second scheduler.
 */

function fresh(): SnoozeBook {
  return SnoozeBook.openFile(join(mkdtempSync(join(tmpdir(), "aether-snooze-")), "snooze.json"));
}

describe("snoozeUntil", () => {
  // A fixed Wednesday 14:00 local, so the arithmetic is checkable by hand.
  const now = new Date(2026, 7, 19, 14, 0, 0);

  it("later today is a few hours out, same day", () => {
    const when = snoozeUntil("later", now);
    expect(when.getDate()).toBe(19);
    expect(when.getHours()).toBeGreaterThan(14);
  });

  it("tomorrow is the next morning, not 24 hours later", () => {
    const when = snoozeUntil("tomorrow", now);
    expect(when.getDate()).toBe(20);
    expect(when.getHours()).toBe(8);
  });

  it("next week is seven days out in the morning", () => {
    const when = snoozeUntil("week", now);
    expect(when.getDate()).toBe(26);
    expect(when.getHours()).toBe(8);
  });

  it("weekend lands on Saturday", () => {
    expect(snoozeUntil("weekend", now).getDay()).toBe(6);
  });

  it("weekend from a Sunday goes to the NEXT Saturday, not today", () => {
    const sunday = new Date(2026, 7, 23, 10, 0, 0);
    const when = snoozeUntil("weekend", sunday);
    expect(when.getDay()).toBe(6);
    expect(when.getTime()).toBeGreaterThan(sunday.getTime());
  });

  it("always returns a future time", () => {
    for (const key of ["later", "tomorrow", "week", "weekend"] as const) {
      expect(snoozeUntil(key, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("SnoozeBook", () => {
  let book: SnoozeBook;
  beforeEach(() => {
    book = fresh();
  });

  it("remembers where a message came from so it can go back", () => {
    book.add("msg-1", "INBOX", Date.now() + 60_000);
    expect(book.list()).toHaveLength(1);
    expect(book.list()[0].from).toBe("INBOX");
  });

  it("reports nothing due before the time arrives", () => {
    book.add("msg-1", "INBOX", Date.now() + 60_000);
    expect(book.due(Date.now())).toHaveLength(0);
  });

  it("reports a message due once its time passes", () => {
    book.add("msg-1", "INBOX", Date.now() - 1);
    expect(book.due(Date.now())).toHaveLength(1);
  });

  it("clearing a woken message stops it waking twice", () => {
    book.add("msg-1", "INBOX", Date.now() - 1);
    book.remove("msg-1");
    expect(book.due(Date.now())).toHaveLength(0);
  });

  it("persists across a restart — a snooze must survive closing the app", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-snooze-")), "snooze.json");
    SnoozeBook.openFile(file).add("msg-1", "INBOX", Date.now() + 60_000);
    expect(SnoozeBook.openFile(file).list()).toHaveLength(1);
  });

  it("re-snoozing the same message replaces the old time", () => {
    book.add("msg-1", "INBOX", Date.now() + 60_000);
    book.add("msg-1", "INBOX", Date.now() + 120_000);
    expect(book.list()).toHaveLength(1);
  });

  it("knows whether a specific message is snoozed", () => {
    book.add("msg-1", "INBOX", Date.now() + 60_000);
    expect(book.isSnoozed("msg-1")).toBe(true);
    expect(book.isSnoozed("msg-2")).toBe(false);
  });
});
