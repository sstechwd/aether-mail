import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuleBook, matchesRule, type Rule } from "./rules.js";

/**
 * Rules the user can read and edit.
 *
 * Spoken workflows already exist, but those are agent-compiled. A mail client
 * also needs the boring deterministic kind: "from X, move to Y", visible as a
 * list, editable, with no model involved. Set once, runs forever.
 *
 * Deliberately NOT included: any action that sends. A rule may file, flag or
 * mark read. It may never reply or forward, because a rule firing on incoming
 * mail is exactly the path an attacker would want into an auto-responder.
 */

const MSG = {
  from: "Priya Raman <priya@example.com>",
  to: "me@example.com",
  subject: "Q3 numbers are ready",
  folder: "INBOX",
};

function freshBook(): RuleBook {
  return RuleBook.openFile(join(mkdtempSync(join(tmpdir(), "aether-rules-")), "rules.json"));
}

describe("matchesRule", () => {
  it("matches on sender", () => {
    const rule: Rule = { id: "1", field: "from", contains: "priya@example.com", action: "move", folder: "Work", enabled: true };
    expect(matchesRule(rule, MSG)).toBe(true);
  });

  it("matches on subject", () => {
    const rule: Rule = { id: "1", field: "subject", contains: "Q3", action: "star", enabled: true };
    expect(matchesRule(rule, MSG)).toBe(true);
  });

  it("is case-insensitive, because nobody types the case right", () => {
    const rule: Rule = { id: "1", field: "from", contains: "PRIYA", action: "star", enabled: true };
    expect(matchesRule(rule, MSG)).toBe(true);
  });

  it("does not match a different sender", () => {
    const rule: Rule = { id: "1", field: "from", contains: "ana@example.com", action: "star", enabled: true };
    expect(matchesRule(rule, MSG)).toBe(false);
  });

  it("never matches when disabled — that is what the toggle is for", () => {
    const rule: Rule = { id: "1", field: "from", contains: "priya", action: "star", enabled: false };
    expect(matchesRule(rule, MSG)).toBe(false);
  });

  it("an empty pattern matches nothing, rather than everything", () => {
    // A rule with a blank field would otherwise silently file the whole inbox.
    const rule: Rule = { id: "1", field: "from", contains: "", action: "move", folder: "X", enabled: true };
    expect(matchesRule(rule, MSG)).toBe(false);
  });

  it("can match on the body", () => {
    const rule: Rule = {
      id: "1",
      field: "body",
      contains: "unsubscribe",
      action: "move",
      folder: "News",
      enabled: true,
    };
    expect(matchesRule(rule, { ...MSG, body: "click unsubscribe below" })).toBe(true);
    expect(matchesRule(rule, { ...MSG, body: "hello" })).toBe(false);
  });

  it("handles a message with missing fields", () => {
    const rule: Rule = { id: "1", field: "subject", contains: "q3", action: "star", enabled: true };
    expect(matchesRule(rule, { from: "", to: "", subject: "", folder: "INBOX" })).toBe(false);
  });
});

describe("RuleBook", () => {
  let book: RuleBook;
  beforeEach(() => {
    book = freshBook();
  });

  it("adds a rule and gives it an id", () => {
    const rule = book.add({ field: "from", contains: "priya@example.com", action: "move", folder: "Work", enabled: true });
    expect(rule.id).toBeTruthy();
    expect(book.list()).toHaveLength(1);
  });

  it("persists across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-rules-")), "rules.json");
    RuleBook.openFile(file).add({ field: "from", contains: "x@y.z", action: "star", enabled: true });
    expect(RuleBook.openFile(file).list()).toHaveLength(1);
  });

  it("removes a rule", () => {
    const rule = book.add({ field: "from", contains: "a@b.c", action: "star", enabled: true });
    expect(book.remove(rule.id)).toBe(true);
    expect(book.list()).toHaveLength(0);
  });

  it("toggles a rule without deleting it", () => {
    const rule = book.add({ field: "from", contains: "a@b.c", action: "star", enabled: true });
    book.setEnabled(rule.id, false);
    expect(book.list()[0].enabled).toBe(false);
  });

  it("refuses a move rule with no destination", () => {
    expect(() =>
      book.add({ field: "from", contains: "a@b.c", action: "move", enabled: true }),
    ).toThrow();
  });

  it("refuses an empty pattern rather than storing a rule that eats the inbox", () => {
    expect(() =>
      book.add({ field: "from", contains: "   ", action: "star", enabled: true }),
    ).toThrow();
  });

  describe("apply", () => {
    it("returns the first matching rule, so order is predictable", () => {
      book.add({ field: "from", contains: "priya", action: "star", enabled: true });
      book.add({ field: "subject", contains: "Q3", action: "move", folder: "Work", enabled: true });
      expect(book.apply(MSG)?.action).toBe("star");
    });

    it("returns null when nothing matches", () => {
      book.add({ field: "from", contains: "nobody@example.com", action: "star", enabled: true });
      expect(book.apply(MSG)).toBeNull();
    });

    it("skips disabled rules when looking for a match", () => {
      book.add({ field: "from", contains: "priya", action: "star", enabled: false });
      book.add({ field: "from", contains: "priya", action: "move", folder: "Work", enabled: true });
      expect(book.apply(MSG)?.action).toBe("move");
    });
  });
});
