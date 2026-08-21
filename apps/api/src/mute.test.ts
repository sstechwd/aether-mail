import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MuteBook } from "./mute.js";
import { normalizeSubject } from "./threading.js";

/**
 * Mute a noisy thread.
 *
 * "Reply-all storm on a thread you were CC'd into" is the case this exists
 * for. Muting keeps new replies out of the inbox without unsubscribing you or
 * deleting anything — they land filed and read, and the thread is still there
 * when you want it.
 *
 * Keyed on the normalized subject rather than message ids, because the whole
 * point is to catch messages that have not arrived yet.
 */

function fresh(): MuteBook {
  return MuteBook.openFile(join(mkdtempSync(join(tmpdir(), "aether-mute-")), "mute.json"));
}

describe("MuteBook", () => {
  let book: MuteBook;
  beforeEach(() => {
    book = fresh();
  });

  it("nothing is muted to start with", () => {
    expect(book.isMuted("Lunch plans")).toBe(false);
    expect(book.list()).toHaveLength(0);
  });

  it("mutes a thread by subject", () => {
    book.mute("Lunch plans");
    expect(book.isMuted("Lunch plans")).toBe(true);
  });

  it("catches later replies — Re: and Fwd: prefixes are the same thread", () => {
    book.mute("Lunch plans");
    expect(book.isMuted("Re: Lunch plans")).toBe(true);
    expect(book.isMuted("RE: RE: Lunch plans")).toBe(true);
    expect(book.isMuted("Fwd: Lunch plans")).toBe(true);
  });

  it("is case-insensitive", () => {
    book.mute("Lunch Plans");
    expect(book.isMuted("lunch plans")).toBe(true);
  });

  it("does not mute a different thread", () => {
    book.mute("Lunch plans");
    expect(book.isMuted("Quarterly numbers")).toBe(false);
  });

  it("unmutes", () => {
    book.mute("Lunch plans");
    book.unmute("Lunch plans");
    expect(book.isMuted("Lunch plans")).toBe(false);
  });

  it("unmuting from a Re: still finds the thread", () => {
    book.mute("Lunch plans");
    book.unmute("Re: Lunch plans");
    expect(book.isMuted("Lunch plans")).toBe(false);
  });

  it("refuses to mute an empty subject — that would mute every blank thread", () => {
    book.mute("");
    book.mute("   ");
    expect(book.list()).toHaveLength(0);
  });

  it("does not store the same thread twice", () => {
    book.mute("Lunch plans");
    book.mute("Re: Lunch plans");
    expect(book.list()).toHaveLength(1);
  });

  it("persists across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-mute-")), "mute.json");
    MuteBook.openFile(file).mute("Lunch plans");
    expect(MuteBook.openFile(file).isMuted("Re: Lunch plans")).toBe(true);
  });

  it("uses the same subject normalization as threading", () => {
    // If these ever diverge, muting silently stops catching replies.
    book.mute("Lunch plans");
    expect(book.isMuted(`Re: ${normalizeSubject("Lunch plans")}`)).toBe(true);
  });
});
