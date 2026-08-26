import { describe, expect, it } from "vitest";
import { stampChanged, type InboxStamp } from "./watch.js";

describe("stampChanged", () => {
  const a: InboxStamp = { lastFetchAt: "2026-08-25T12:00:00.000Z", unread: 3, inboxTotal: 10 };

  it("is a change the first time we have no previous stamp", () => {
    expect(stampChanged(null, a)).toBe(true);
  });

  it("is quiet when nothing moved", () => {
    expect(stampChanged(a, { ...a })).toBe(false);
  });

  it("notices a new fetch, unread count, or inbox size", () => {
    expect(stampChanged(a, { ...a, lastFetchAt: "2026-08-25T12:01:00.000Z" })).toBe(true);
    expect(stampChanged(a, { ...a, unread: 4 })).toBe(true);
    expect(stampChanged(a, { ...a, inboxTotal: 11 })).toBe(true);
  });
});
