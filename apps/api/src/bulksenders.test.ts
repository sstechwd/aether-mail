import { describe, expect, it } from "vitest";
import { findBulkSenders, type Candidate } from "./bulksenders.js";

/**
 * Folder-level automation proposals.
 *
 * The agent can already suggest a rule for the ONE message you have open.
 * That is the wrong unit: the useful observation is "these 33 messages share a
 * sender, one rule files them all". On the live inbox, 5 domains account for
 * 42% of 179 messages.
 *
 * This is deliberately NOT an LLM job. Counting senders is arithmetic, and
 * arithmetic that a 7B model on a CPU would do slower and occasionally wrong.
 * The model's turn comes later, to phrase the suggestion — the candidates
 * themselves are computed exactly.
 */

function msg(from: string, extra: Partial<Candidate> = {}): { from: string; subject: string; unread: boolean } {
  return { from, subject: "hello", unread: false, ...extra } as never;
}

describe("findBulkSenders", () => {
  it("finds nothing in an empty folder", () => {
    expect(findBulkSenders([])).toEqual([]);
  });

  it("ignores a sender with only a couple of messages", () => {
    // Two mails from your friend is not a filing rule.
    const rows = [msg("a@example.com"), msg("a@example.com")];
    expect(findBulkSenders(rows)).toEqual([]);
  });

  it("finds a sender above the threshold", () => {
    const rows = Array.from({ length: 8 }, () => msg("news@shop.example"));
    const found = findBulkSenders(rows);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(8);
    expect(found[0].match).toBe("shop.example");
  });

  it("groups by domain, so per-campaign local parts still collapse", () => {
    // Real bulk mail varies the local part: deal-1@, deal-2@, promo@…
    const rows = [
      msg("deal-1@shop.example"),
      msg("deal-2@shop.example"),
      msg("promo@shop.example"),
      msg("news@shop.example"),
      msg("alerts@shop.example"),
    ];
    const found = findBulkSenders(rows);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(5);
  });

  it("ranks the biggest sender first", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => msg("a@big.example")),
      ...Array.from({ length: 6 }, () => msg("b@small.example")),
    ];
    const found = findBulkSenders(rows);
    expect(found[0].match).toBe("big.example");
    expect(found[1].match).toBe("small.example");
  });

  it("never proposes filing a domain you actually correspond with", () => {
    // The key safety property. A person who mails you a lot is not a
    // newsletter, and silently archiving a colleague is unforgivable.
    const rows = [
      ...Array.from({ length: 10 }, () => msg("colleague@work.example")),
    ];
    expect(findBulkSenders(rows, { corresponded: new Set(["work.example"]) })).toEqual([]);
  });

  it("does not propose a sender that is already covered by a rule", () => {
    const rows = Array.from({ length: 9 }, () => msg("news@shop.example"));
    expect(findBulkSenders(rows, { alreadyRuled: ["shop.example"] })).toEqual([]);
  });

  it("matches an existing rule case-insensitively", () => {
    const rows = Array.from({ length: 9 }, () => msg("news@Shop.Example"));
    expect(findBulkSenders(rows, { alreadyRuled: ["shop.example"] })).toEqual([]);
  });

  it("survives malformed From headers rather than throwing", () => {
    const rows = [
      msg(""),
      msg("not an address"),
      msg("<>"),
      msg("@"),
      ...Array.from({ length: 7 }, () => msg("news@shop.example")),
    ];
    const found = findBulkSenders(rows);
    expect(found).toHaveLength(1);
    expect(found[0].match).toBe("shop.example");
  });

  it("reports how many are unread, so the UI can say what it frees up", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => msg("news@shop.example", { unread: true } as never)),
      ...Array.from({ length: 3 }, () => msg("news@shop.example")),
    ];
    expect(findBulkSenders(rows)[0].unread).toBe(5);
  });

  it("caps how many candidates it returns", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      Array.from({ length: 6 }, () => msg(`x@d${i}.example`)),
    ).flat();
    expect(findBulkSenders(rows).length).toBeLessThanOrEqual(5);
  });

  it("keeps a display name for the suggestion text", () => {
    const rows = Array.from({ length: 7 }, () => msg("Humble Bundle <news@shop.example>"));
    expect(findBulkSenders(rows)[0].label).toContain("Humble Bundle");
  });
});
