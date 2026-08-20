import { describe, expect, it } from "vitest";
import { monthGrid, weekDays, rangeFor, sameDay, monthLabel } from "./calgrid.js";

/**
 * Reported: "I can't see by month or day, week, etc doesn't show dates
 * properly."
 *
 * The calendar was a flat list of events. A calendar needs a grid you can look
 * at and find a date in.
 */

describe("monthGrid", () => {
  it("returns whole weeks, so the grid is always rectangular", () => {
    const cells = monthGrid(new Date("2026-08-15T12:00:00Z"));
    expect(cells.length % 7).toBe(0);
  });

  it("covers every day of the month", () => {
    const cells = monthGrid(new Date("2026-08-15T12:00:00Z"));
    const august = cells.filter((c) => c.inMonth);
    expect(august).toHaveLength(31);
  });

  it("pads with days from the neighbouring months rather than blanks", () => {
    const cells = monthGrid(new Date("2026-08-15T12:00:00Z"));
    expect(cells.some((c) => !c.inMonth)).toBe(true);
    // Padding cells still carry a real date so clicking one works.
    expect(cells.every((c) => c.date instanceof Date)).toBe(true);
  });

  it("starts the grid on a Sunday", () => {
    const cells = monthGrid(new Date("2026-08-15T12:00:00Z"));
    expect(cells[0].date.getDay()).toBe(0);
  });

  it("handles February in a leap year", () => {
    const cells = monthGrid(new Date("2028-02-10T12:00:00Z"));
    expect(cells.filter((c) => c.inMonth)).toHaveLength(29);
  });

  it("handles a month that starts on a Sunday without a blank leading week", () => {
    // 2026-11-01 is a Sunday.
    const cells = monthGrid(new Date("2026-11-15T12:00:00Z"));
    expect(cells[0].date.getDate()).toBe(1);
  });
});

describe("weekDays", () => {
  it("returns seven days starting Sunday", () => {
    const days = weekDays(new Date("2026-08-19T12:00:00Z")); // a Wednesday
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
    expect(days[6].getDay()).toBe(6);
  });

  it("includes the day asked for", () => {
    const target = new Date("2026-08-19T12:00:00Z");
    const days = weekDays(target);
    expect(days.some((d) => sameDay(d, target))).toBe(true);
  });
});

describe("rangeFor", () => {
  it("month covers the first to the last day", () => {
    const { from, to } = rangeFor("month", new Date("2026-08-15T12:00:00Z"));
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(from.getMonth());
    expect(to.getDate()).toBe(31);
  });

  it("day is a single day", () => {
    const { from, to } = rangeFor("day", new Date("2026-08-15T12:00:00Z"));
    expect(sameDay(from, to)).toBe(true);
  });

  it("week spans seven days", () => {
    const { from, to } = rangeFor("week", new Date("2026-08-19T12:00:00Z"));
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(days).toBe(6);
  });
});

describe("sameDay", () => {
  it("ignores the time", () => {
    expect(sameDay(new Date("2026-08-15T01:00:00"), new Date("2026-08-15T23:00:00"))).toBe(true);
  });

  it("is false across midnight", () => {
    expect(sameDay(new Date("2026-08-15T23:59:00"), new Date("2026-08-16T00:01:00"))).toBe(false);
  });
});

describe("monthLabel", () => {
  it("names the month and year", () => {
    expect(monthLabel(new Date("2026-08-15T12:00:00Z"))).toMatch(/2026/);
  });
});
