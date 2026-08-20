import { describe, expect, it } from "vitest";
import { harvestContacts, suggestContacts } from "./contacts.js";

const MESSAGES = [
  { from: "Priya Raman <priya@example.com>", to: "me@example.com", folder: "INBOX", date: "2026-08-18T10:00:00Z" },
  { from: "me@example.com", to: "Ana Diaz <ana@example.com>", folder: "Sent", date: "2026-08-19T10:00:00Z" },
  { from: "Priya Raman <priya@example.com>", to: "me@example.com", folder: "INBOX", date: "2026-08-19T12:00:00Z" },
  { from: "noreply@newsletter.example", to: "me@example.com", folder: "INBOX", date: "2026-08-17T10:00:00Z" },
];

describe("harvestContacts", () => {
  it("collects addresses from mail already in the store", () => {
    const found = harvestContacts(MESSAGES, "me@example.com");
    const addrs = found.map((c) => c.address);
    expect(addrs).toContain("priya@example.com");
    expect(addrs).toContain("ana@example.com");
  });

  it("keeps the display name when the header had one", () => {
    const priya = harvestContacts(MESSAGES, "me@example.com").find((c) => c.address === "priya@example.com");
    expect(priya?.name).toBe("Priya Raman");
  });

  it("never suggests you to yourself", () => {
    const addrs = harvestContacts(MESSAGES, "me@example.com").map((c) => c.address);
    expect(addrs).not.toContain("me@example.com");
  });

  it("ranks people you actually correspond with above bulk senders", () => {
    const found = harvestContacts(MESSAGES, "me@example.com");
    const priya = found.findIndex((c) => c.address === "priya@example.com");
    const noreply = found.findIndex((c) => c.address === "noreply@newsletter.example");
    // Priya wrote twice; a no-reply address should never outrank a human.
    expect(priya).toBeLessThan(noreply === -1 ? Number.MAX_SAFE_INTEGER : noreply);
  });

  it("counts someone you emailed as a strong contact", () => {
    const ana = harvestContacts(MESSAGES, "me@example.com").find((c) => c.address === "ana@example.com");
    expect(ana).toBeTruthy();
    // Addressed in Sent — that is a deliberate act, worth more than receiving.
    expect(ana!.score).toBeGreaterThan(1);
  });

  it("strips quotes real senders wrap display names in", () => {
    // Live mailbox produced: '"Amazon.com" <store-news@amazon.com>' and
    // '"GOG.com Team" <...>' — a naive strip leaves a trailing quote.
    const rows = [
      { from: '"Amazon.com" <store-news@amazon.com>', to: "me@example.com", folder: "INBOX", date: "" },
      { from: '"GOG.com Team" <team@gog.example>', to: "me@example.com", folder: "INBOX", date: "" },
    ];
    const found = harvestContacts(rows, "me@example.com");
    expect(found.find((c) => c.address === "store-news@amazon.com")?.name).toBe("Amazon.com");
    expect(found.find((c) => c.address === "team@gog.example")?.name).toBe("GOG.com Team");
  });

  it("keeps a bulk sender below a real person no matter how much it mails you", () => {
    // Real case from the live mailbox: Humble Bundle sent 34 newsletters and
    // outranked every actual human. A one-time penalty cannot survive +1 per
    // message, so automated senders must not accumulate score at all.
    const rows = [
      ...Array.from({ length: 34 }, () => ({
        from: "Humble Bundle <contact@mailer.humblebundle.com>",
        to: "me@example.com",
        folder: "INBOX",
        date: "2026-08-18T10:00:00Z",
      })),
      { from: "Ana Diaz <ana@example.com>", to: "me@example.com", folder: "INBOX", date: "2026-08-19T10:00:00Z" },
    ];
    const found = harvestContacts(rows, "me@example.com");
    const ana = found.findIndex((c) => c.address === "ana@example.com");
    const bulk = found.findIndex((c) => c.address === "contact@mailer.humblebundle.com");
    expect(ana).toBeLessThan(bulk);
  });

  it("hides addresses the user removed", () => {
    const found = harvestContacts(MESSAGES, "me@example.com", ["priya@example.com"]);
    expect(found.map((c) => c.address)).not.toContain("priya@example.com");
  });

  it("does not crash on malformed headers", () => {
    expect(() => harvestContacts([{ from: "", to: "", folder: "INBOX", date: "" }], "me@example.com")).not.toThrow();
  });
});

describe("suggestContacts", () => {
  const book = harvestContacts(MESSAGES, "me@example.com");

  it("matches on the address", () => {
    expect(suggestContacts(book, "pri").map((c) => c.address)).toContain("priya@example.com");
  });

  it("matches on the display name too, since people think in names", () => {
    expect(suggestContacts(book, "raman").map((c) => c.address)).toContain("priya@example.com");
  });

  it("is case-insensitive", () => {
    expect(suggestContacts(book, "PRIYA").length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty query rather than the whole address book", () => {
    expect(suggestContacts(book, "")).toHaveLength(0);
    expect(suggestContacts(book, " ")).toHaveLength(0);
  });

  it("caps the list so the dropdown stays usable", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      from: `person${i}@example.com`,
      to: "me@example.com",
      folder: "INBOX",
      date: "2026-08-18T10:00:00Z",
    }));
    const big = harvestContacts(many, "me@example.com");
    expect(suggestContacts(big, "person").length).toBeLessThanOrEqual(6);
  });
});
