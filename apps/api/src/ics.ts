/**
 * Calendar invites in mail.
 *
 * The realistic first slice of "calendar support" is not building a calendar
 * app: it is noticing that a message carries an invite, showing when it is, and
 * letting the user hand it to the calendar they already use. That is what this
 * does.
 *
 * RFC 5545 has two details that break naive parsers, and both are extremely
 * common in real mail:
 *   - line folding: a long value continues on the next line, which begins with
 *     a space or tab. Split on newlines without unfolding and every long title
 *     gets truncated.
 *   - escaping: commas, semicolons and newlines inside a value are backslash
 *     escaped. Show them raw and descriptions come out full of "\,".
 */

export type Invite = {
  summary: string;
  description?: string;
  location?: string;
  organizer?: string;
  attendees: string[];
  /** ISO string, or null when the invite had no usable start. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  /** REQUEST for a new invite, CANCEL when the meeting is called off. */
  method?: string;
  uid?: string;
};

/** Is this attachment a calendar invite? */
export function isCalendarPart(part: { mimeType?: string; filename?: string }): boolean {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (mime.startsWith("text/calendar") || mime === "application/ics") return true;
  // Outlook often ships invite.ics as application/octet-stream, so the
  // extension is the only reliable signal.
  return (part.filename ?? "").toLowerCase().endsWith(".ics");
}

/** Undo RFC 5545 line folding: a continuation line starts with space or tab. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Undo the backslash escaping the spec requires inside values. */
function unescape(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * ICS timestamps come in three shapes:
 *   20260825T210000Z   UTC
 *   20260825T210000    local/floating
 *   20260901           date only (all day)
 */
function parseIcsDate(value: string): { iso: string | null; allDay: boolean } {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { iso: new Date(Date.UTC(+y, +m - 1, +d)).toISOString(), allDay: true };
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (stamp) {
    const [, y, m, d, hh, mm, ss] = stamp;
    // Treat a floating time as UTC: better than guessing a timezone wrong.
    return { iso: new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)).toISOString(), allDay: false };
  }
  return { iso: null, allDay: false };
}

/** `ORGANIZER;CN=Priya:mailto:priya@example.com` -> `priya@example.com` */
function mailtoAddress(value: string): string | undefined {
  const match = /mailto:([^\s;,]+)/i.exec(value);
  return match ? match[1].trim().toLowerCase() : undefined;
}

export function parseIcs(raw: string): Invite | null {
  if (!raw || !raw.toUpperCase().includes("BEGIN:VEVENT")) return null;

  const lines = unfold(raw);
  const invite: Invite = { summary: "", attendees: [], start: null, end: null, allDay: false };
  let inEvent = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      continue;
    }
    if (upper.startsWith("END:VEVENT")) break;

    // METHOD lives on the calendar, outside the event.
    if (!inEvent && upper.startsWith("METHOD:")) {
      invite.method = line.slice(7).trim().toUpperCase();
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const rawName = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = rawName.split(";")[0].toUpperCase();

    switch (name) {
      case "SUMMARY":
        invite.summary = unescape(value).trim();
        break;
      case "DESCRIPTION":
        invite.description = unescape(value).trim();
        break;
      case "LOCATION":
        invite.location = unescape(value).trim();
        break;
      case "UID":
        invite.uid = value.trim();
        break;
      case "ORGANIZER":
        invite.organizer = mailtoAddress(line);
        break;
      case "ATTENDEE": {
        const addr = mailtoAddress(line);
        if (addr && !invite.attendees.includes(addr)) invite.attendees.push(addr);
        break;
      }
      case "DTSTART": {
        const parsed = parseIcsDate(value);
        invite.start = parsed.iso;
        invite.allDay = parsed.allDay;
        break;
      }
      case "DTEND": {
        invite.end = parseIcsDate(value).iso;
        break;
      }
      default:
        break;
    }
  }

  if (!invite.summary && !invite.start) return null;
  return invite;
}

/** A human sentence for when the meeting is. */
export function formatInviteWhen(ev: { start: string | null; end: string | null; allDay: boolean }): string {
  if (!ev.start) return "Time not specified";
  const start = new Date(ev.start);
  if (Number.isNaN(start.getTime())) return "Time not specified";

  if (ev.allDay) {
    return `${start.toLocaleDateString(undefined, { dateStyle: "full" })} · all day`;
  }

  const date = start.toLocaleDateString(undefined, { dateStyle: "full" });
  const from = start.toLocaleTimeString(undefined, { timeStyle: "short" });
  if (!ev.end) return `${date} at ${from}`;

  const end = new Date(ev.end);
  if (Number.isNaN(end.getTime())) return `${date} at ${from}`;
  const to = end.toLocaleTimeString(undefined, { timeStyle: "short" });
  return `${date} · ${from} – ${to}`;
}

/**
 * Build a minimal .ics the OS can open, so "Add to calendar" hands the event
 * to whatever calendar the user already has. We deliberately do not try to
 * write into a calendar ourselves.
 */
export function toIcsFile(ev: Invite): string {
  const stamp = (iso: string | null): string =>
    iso ? iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "") : "";
  const escape = (v: string): string => v.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aether Mail//EN",
    "BEGIN:VEVENT",
    `UID:${ev.uid ?? `aether-${Date.now()}`}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    ev.start ? `DTSTART:${stamp(ev.start)}` : "",
    ev.end ? `DTEND:${stamp(ev.end)}` : "",
    `SUMMARY:${escape(ev.summary || "(no title)")}`,
    ev.location ? `LOCATION:${escape(ev.location)}` : "",
    ev.description ? `DESCRIPTION:${escape(ev.description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
