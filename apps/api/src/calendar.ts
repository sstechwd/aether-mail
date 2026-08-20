/**
 * A real calendar, not just invite detection.
 *
 * The first version parsed invites in mail and offered "Add to calendar",
 * which handed an .ics to the OS. That is useless if you have no invites in
 * your mailbox — there was nothing to see and no way in. This stores events
 * locally so the calendar is a place you can open, add to, and read.
 *
 * Still local-first: no CalDAV, no account, no sync. A JSON file next to the
 * mail store.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  organizer?: string;
  attendees?: string[];
  /** ISO string. Always present and always parseable. */
  start: string;
  end: string | null;
  allDay: boolean;
  /** The invite's own UID when it came from mail, so it is added only once. */
  uid?: string;
  /** Message this came from, so the UI can jump back to it. */
  messageId?: string;
  createdAt: number;
};

export type NewEvent = Omit<CalendarEvent, "id" | "createdAt">;

/** An event with no end is treated as lasting this long. */
const DEFAULT_DURATION_MS = 60 * 60_000;

const MAX_TITLE = 500;
const MAX_TEXT = 5000;

function time(iso: string | null): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

export class CalendarStore {
  private events = new Map<string, CalendarEvent>();
  private filePath: string | null = null;

  static openFile(filePath: string): CalendarStore {
    const store = new CalendarStore();
    store.filePath = filePath;
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf8")) as CalendarEvent[];
      for (const row of rows) store.events.set(row.id, row);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return store;
  }

  /**
   * Add an event. When it carries a UID from a mail invite, adding it twice is
   * a no-op — opening the same invite again must not duplicate it.
   */
  add(input: NewEvent): CalendarEvent {
    const startMs = time(input.start);
    if (!input.start || Number.isNaN(startMs)) {
      throw new Error("An event needs a valid start time.");
    }

    if (input.uid) {
      const existing = [...this.events.values()].find((e) => e.uid === input.uid);
      if (existing) return existing;
    }

    const event: CalendarEvent = {
      id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      summary: (input.summary || "(no title)").slice(0, MAX_TITLE),
      description: input.description?.slice(0, MAX_TEXT),
      location: input.location?.slice(0, MAX_TITLE),
      organizer: input.organizer?.slice(0, 320),
      attendees: (input.attendees ?? []).slice(0, 200),
      start: new Date(startMs).toISOString(),
      end: input.end && !Number.isNaN(time(input.end)) ? new Date(time(input.end)).toISOString() : null,
      allDay: input.allDay === true,
      uid: input.uid,
      messageId: input.messageId,
      createdAt: Date.now(),
    };
    this.events.set(event.id, event);
    this.save();
    return event;
  }

  /** Every event, soonest first. */
  list(): CalendarEvent[] {
    return [...this.events.values()].sort((a, b) => time(a.start) - time(b.start));
  }

  /** Events that have not finished yet — what an agenda should show. */
  upcoming(now = Date.now()): CalendarEvent[] {
    return this.list().filter((e) => {
      const ends = e.end ? time(e.end) : time(e.start) + DEFAULT_DURATION_MS;
      return ends >= now;
    });
  }

  remove(id: string): boolean {
    const existed = this.events.delete(id);
    if (existed) this.save();
    return existed;
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list()), "utf8");
  }
}
