import { describe, expect, it } from "vitest";
import { parseIcs, isCalendarPart, formatInviteWhen } from "./ics.js";

/**
 * A real Google Calendar invite, trimmed. Note the folded line (RFC 5545 says a
 * long line continues on the next line starting with a space) and the escaped
 * comma in DESCRIPTION — both are extremely common and both break naive parsers.
 */
const GOOGLE_INVITE = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "DTSTART:20260825T210000Z",
  "DTEND:20260825T220000Z",
  "DTSTAMP:20260819T120000Z",
  "ORGANIZER;CN=Priya Raman:mailto:priya@example.com",
  "UID:abc123@google.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;CN=You:mailto:you@example.com",
  "SUMMARY:Design review and a very long title that keeps going on past the ",
  " 75 character limit",
  "DESCRIPTION:Bring the mockups\\, the budget\\, and coffee",
  "LOCATION:Meeting Room 4",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("pulls the essentials out of a real invite", () => {
    const ev = parseIcs(GOOGLE_INVITE);
    expect(ev).not.toBeNull();
    expect(ev?.summary).toContain("Design review");
    expect(ev?.location).toBe("Meeting Room 4");
    expect(ev?.organizer).toBe("priya@example.com");
    expect(ev?.method).toBe("REQUEST");
  });

  it("unfolds continuation lines instead of truncating the title", () => {
    const ev = parseIcs(GOOGLE_INVITE);
    expect(ev?.summary).toBe(
      "Design review and a very long title that keeps going on past the 75 character limit",
    );
  });

  it("unescapes commas and semicolons the spec requires be escaped", () => {
    const ev = parseIcs(GOOGLE_INVITE);
    expect(ev?.description).toBe("Bring the mockups, the budget, and coffee");
  });

  it("reads UTC timestamps into a real date", () => {
    const ev = parseIcs(GOOGLE_INVITE);
    expect(ev?.start).toBe("2026-08-25T21:00:00.000Z");
    expect(ev?.end).toBe("2026-08-25T22:00:00.000Z");
  });

  it("handles an all-day event, which uses a date with no time", () => {
    const allDay = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260901",
      "DTEND;VALUE=DATE:20260902",
      "SUMMARY:Company holiday",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcs(allDay);
    expect(ev?.allDay).toBe(true);
    expect(ev?.summary).toBe("Company holiday");
  });

  it("collects attendees", () => {
    const ev = parseIcs(GOOGLE_INVITE);
    expect(ev?.attendees).toContain("you@example.com");
  });

  it("returns null for something that is not a calendar", () => {
    expect(parseIcs("just some text")).toBeNull();
    expect(parseIcs("")).toBeNull();
  });

  it("survives a calendar with no VEVENT rather than throwing", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR")).toBeNull();
  });

  it("reads a cancellation so the UI can say the meeting is off", () => {
    const cancelled = GOOGLE_INVITE.replace("METHOD:REQUEST", "METHOD:CANCEL");
    expect(parseIcs(cancelled)?.method).toBe("CANCEL");
  });
});

describe("isCalendarPart", () => {
  it("matches by mime type", () => {
    expect(isCalendarPart({ mimeType: "text/calendar", filename: "x" })).toBe(true);
    expect(isCalendarPart({ mimeType: "application/ics", filename: "x" })).toBe(true);
  });

  it("matches an .ics attachment even when the mime type is generic", () => {
    // Outlook frequently sends invite.ics as application/octet-stream.
    expect(isCalendarPart({ mimeType: "application/octet-stream", filename: "invite.ics" })).toBe(true);
    expect(isCalendarPart({ mimeType: "application/octet-stream", filename: "INVITE.ICS" })).toBe(true);
  });

  it("does not match ordinary attachments", () => {
    expect(isCalendarPart({ mimeType: "application/pdf", filename: "report.pdf" })).toBe(false);
    expect(isCalendarPart({ mimeType: "image/png", filename: "logo.png" })).toBe(false);
  });
});

describe("formatInviteWhen", () => {
  it("renders a readable single-day range", () => {
    const out = formatInviteWhen({
      start: "2026-08-25T21:00:00.000Z",
      end: "2026-08-25T22:00:00.000Z",
      allDay: false,
    });
    expect(out).toMatch(/2026/);
    expect(out.length).toBeGreaterThan(8);
  });

  it("says All day rather than showing midnight", () => {
    const out = formatInviteWhen({
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-09-02T00:00:00.000Z",
      allDay: true,
    });
    expect(out).toMatch(/all day/i);
  });

  it("does not crash on a missing end", () => {
    expect(formatInviteWhen({ start: "2026-08-25T21:00:00.000Z", end: null, allDay: false })).toBeTruthy();
  });
});
