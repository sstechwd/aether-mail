import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarStore } from "./calendar.js";

function freshStore(): CalendarStore {
  return CalendarStore.openFile(join(mkdtempSync(join(tmpdir(), "aether-cal-")), "calendar.json"));
}

const EVENT = {
  summary: "Design review",
  start: "2026-08-25T21:00:00.000Z",
  end: "2026-08-25T22:00:00.000Z",
  allDay: false,
  location: "Room 4",
};

describe("CalendarStore", () => {
  let cal: CalendarStore;
  beforeEach(() => {
    cal = freshStore();
  });

  it("adds an event and gives it an id", () => {
    const ev = cal.add(EVENT);
    expect(ev.id).toBeTruthy();
    expect(cal.list()).toHaveLength(1);
  });

  it("persists across a restart, because a calendar you lose is worthless", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-cal-")), "calendar.json");
    CalendarStore.openFile(file).add(EVENT);
    expect(CalendarStore.openFile(file).list()).toHaveLength(1);
  });

  it("sorts by start time so the agenda reads in order", () => {
    cal.add({ ...EVENT, summary: "Later", start: "2026-08-26T10:00:00.000Z" });
    cal.add({ ...EVENT, summary: "Sooner", start: "2026-08-25T10:00:00.000Z" });
    expect(cal.list().map((e) => e.summary)).toEqual(["Sooner", "Later"]);
  });

  it("removes an event", () => {
    const ev = cal.add(EVENT);
    expect(cal.remove(ev.id)).toBe(true);
    expect(cal.list()).toHaveLength(0);
  });

  it("returns false when removing something that is not there", () => {
    expect(cal.remove("nope")).toBe(false);
  });

  it("does not add the same mail invite twice", () => {
    // Opening the same invite twice must not duplicate it. Real invites carry
    // a UID; that is what makes this checkable.
    cal.add({ ...EVENT, uid: "abc@google.com" });
    cal.add({ ...EVENT, uid: "abc@google.com" });
    expect(cal.list()).toHaveLength(1);
  });

  it("keeps distinct invites apart", () => {
    cal.add({ ...EVENT, uid: "a@x" });
    cal.add({ ...EVENT, uid: "b@x" });
    expect(cal.list()).toHaveLength(2);
  });

  describe("upcoming", () => {
    it("hides events that already finished", () => {
      const now = Date.parse("2026-08-25T23:00:00.000Z");
      cal.add(EVENT); // ended at 22:00
      expect(cal.upcoming(now)).toHaveLength(0);
    });

    it("still shows an event that is happening right now", () => {
      const now = Date.parse("2026-08-25T21:30:00.000Z");
      cal.add(EVENT);
      expect(cal.upcoming(now)).toHaveLength(1);
    });

    it("shows future events", () => {
      const now = Date.parse("2026-08-01T00:00:00.000Z");
      cal.add(EVENT);
      expect(cal.upcoming(now)).toHaveLength(1);
    });

    it("treats an event with no end as lasting an hour", () => {
      cal.add({ ...EVENT, end: null });
      // 30 minutes in: still current.
      expect(cal.upcoming(Date.parse("2026-08-25T21:30:00.000Z"))).toHaveLength(1);
      // Two hours later: over.
      expect(cal.upcoming(Date.parse("2026-08-25T23:00:00.000Z"))).toHaveLength(0);
    });
  });

  it("rejects an event with no usable start rather than storing junk", () => {
    expect(() => cal.add({ ...EVENT, start: "" })).toThrow();
    expect(() => cal.add({ ...EVENT, start: "not-a-date" })).toThrow();
  });

  it("caps the title so a hostile invite cannot bloat the file", () => {
    const ev = cal.add({ ...EVENT, summary: "x".repeat(5000) });
    expect(ev.summary.length).toBeLessThanOrEqual(500);
  });
});
