/**
 * Snooze.
 *
 * Hide a message until a chosen time, then put it back where it came from.
 *
 * This reuses the shape the Outbox already proved: a persisted list with a due
 * time, drained by a worker at startup and on a tick. Snoozing has to survive
 * closing the app — a message that only comes back if you happen to leave the
 * client running is worse than not snoozing it at all.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type SnoozePreset = "later" | "tomorrow" | "week" | "weekend";

export type SnoozedItem = {
  id: string;
  /** Folder to restore into when it wakes. */
  from: string;
  /** Epoch ms. */
  wakeAt: number;
};

/** Morning, for anything that wakes on a later day. */
const MORNING_HOUR = 8;

/**
 * Turn a preset into a concrete time.
 *
 * Takes `now` so the arithmetic is testable rather than depending on when the
 * suite happens to run.
 */
export function snoozeUntil(preset: SnoozePreset, now: Date = new Date()): Date {
  const when = new Date(now.getTime());
  switch (preset) {
    case "later":
      // Three hours out, which is "after this meeting" for most people.
      when.setHours(when.getHours() + 3);
      return when;
    case "tomorrow":
      when.setDate(when.getDate() + 1);
      when.setHours(MORNING_HOUR, 0, 0, 0);
      return when;
    case "week":
      when.setDate(when.getDate() + 7);
      when.setHours(MORNING_HOUR, 0, 0, 0);
      return when;
    case "weekend": {
      // The next Saturday. From a Saturday or Sunday this must roll forward to
      // the following weekend rather than returning a time in the past.
      const day = when.getDay();
      const ahead = day === 6 ? 7 : (6 - day + 7) % 7 || 7;
      when.setDate(when.getDate() + ahead);
      when.setHours(MORNING_HOUR, 0, 0, 0);
      return when;
    }
  }
}

export class SnoozeBook {
  private items = new Map<string, SnoozedItem>();
  private filePath: string | null = null;

  static openFile(filePath: string): SnoozeBook {
    const book = new SnoozeBook();
    book.filePath = filePath;
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf8")) as SnoozedItem[];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row && typeof row.id === "string") book.items.set(row.id, row);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return book;
  }

  /** Snooze a message. Re-snoozing replaces the previous time. */
  add(id: string, from: string, wakeAt: number): SnoozedItem {
    const item: SnoozedItem = { id, from, wakeAt };
    this.items.set(id, item);
    this.save();
    return item;
  }

  remove(id: string): boolean {
    const had = this.items.delete(id);
    if (had) this.save();
    return had;
  }

  isSnoozed(id: string): boolean {
    return this.items.has(id);
  }

  list(): SnoozedItem[] {
    return [...this.items.values()].sort((a, b) => a.wakeAt - b.wakeAt);
  }

  /** Everything whose time has come. */
  due(now: number): SnoozedItem[] {
    return this.list().filter((i) => i.wakeAt <= now);
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list()), "utf8");
  }
}
