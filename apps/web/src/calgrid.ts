/**
 * Calendar grid maths.
 *
 * Kept apart from the component so the date logic is testable on its own —
 * month boundaries, leap years and week padding are exactly the places a
 * calendar quietly gets wrong.
 *
 * Everything works in LOCAL time. A calendar shows the user's days, not UTC's.
 */

export type CalView = "month" | "week" | "day";

export type DayCell = {
  date: Date;
  /** False for the leading/trailing days borrowed from the neighbouring month. */
  inMonth: boolean;
};

const DAY_MS = 86_400_000;

/** Midnight, local time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The Sunday on or before this date. */
export function startOfWeek(d: Date): Date {
  const start = startOfDay(d);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

/** Seven days, Sunday first, containing the given date. */
export function weekDays(d: Date): Date[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

/**
 * A rectangular month grid: whole weeks, padded with the neighbouring months'
 * days so there are no holes. Padding days carry real dates, so clicking one
 * navigates rather than doing nothing.
 */
export function monthGrid(d: Date): DayCell[] {
  const month = d.getMonth();
  const first = new Date(d.getFullYear(), month, 1);
  const gridStart = startOfWeek(first);

  const cells: DayCell[] = [];
  // Six weeks covers every possible month layout; trim any trailing week that
  // is entirely outside the month.
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart.getTime() + i * DAY_MS);
    cells.push({ date, inMonth: date.getMonth() === month });
  }
  while (cells.length > 35 && !cells.slice(-7).some((c) => c.inMonth)) {
    cells.length -= 7;
  }
  return cells;
}

/** The inclusive date range a view covers. */
export function rangeFor(view: CalView, anchor: Date): { from: Date; to: Date } {
  if (view === "day") {
    const day = startOfDay(anchor);
    return { from: day, to: day };
  }
  if (view === "week") {
    const days = weekDays(anchor);
    return { from: days[0], to: days[6] };
  }
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from, to };
}

/** Step an anchor date forward or back by one view's worth. */
export function shift(view: CalView, anchor: Date, direction: 1 | -1): Date {
  if (view === "day") return new Date(anchor.getTime() + direction * DAY_MS);
  if (view === "week") return new Date(anchor.getTime() + direction * 7 * DAY_MS);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Heading for whichever view is showing. */
export function viewLabel(view: CalView, anchor: Date): string {
  if (view === "day") return dayLabel(anchor);
  if (view === "week") {
    const days = weekDays(anchor);
    const from = days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const to = days[6].toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${from} – ${to}`;
  }
  return monthLabel(anchor);
}
