import { describe, expect, it } from "vitest";
import { findBulkSenders } from "./bulksenders.js";

/**
 * A filing rule is domain-wide and blunt.
 *
 * Found by reading the real suggestions rather than trusting them: the live
 * inbox offered "google.com — 5 messages", and filing that domain would also
 * have archived two "Security alert" messages, two account-change notices, and
 * five "Delivery Status Notification (Failure)" bounces.
 *
 * Burying a security alert or a bounce notice is a genuine harm — worse than
 * the untidy inbox the rule was meant to fix. A domain that mixes marketing
 * with security or transactional mail must not be offered at all, because the
 * rule cannot tell them apart.
 */

function m(from: string, subject: string) {
  return { from, subject, unread: false };
}

describe("findBulkSenders — mail you must never bury", () => {
  it("does not propose a domain that also sends security alerts", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => m("promo@big.example", "March savings on our phone")),
      m("no-reply@big.example", "Security alert"),
    ];
    expect(findBulkSenders(rows)).toEqual([]);
  });

  it("does not propose a domain that sends delivery failure notices", () => {
    // A bounce tells you mail YOU sent did not arrive. Archiving that
    // silently is how someone misses that a message never landed.
    const rows = [
      ...Array.from({ length: 8 }, () => m("news@big.example", "Weekly digest")),
      m("mailer-daemon@big.example", "Delivery Status Notification (Failure)"),
    ];
    expect(findBulkSenders(rows)).toEqual([]);
  });

  it.each([
    "Security alert",
    "Your verification code is 123456",
    "Verify your email address",
    "Password changed",
    "New sign-in to your account",
    "Suspicious activity detected",
    "Your one-time passcode",
    "Undeliverable: Meeting notes",
    "Payment failed",
    "Your receipt from Acme",
    "Invoice #4421 is due",
    "Your new family group member",
    "Two-factor authentication is on",
  ])("treats %j as mail that must not be auto-filed", (subject) => {
    const rows = [
      ...Array.from({ length: 8 }, () => m("bulk@big.example", "Buy our stuff")),
      m("system@big.example", subject),
    ];
    expect(findBulkSenders(rows)).toEqual([]);
  });

  it("still proposes a purely promotional sender", () => {
    // The guard must not swallow the feature it protects.
    const rows = Array.from({ length: 9 }, (_, i) =>
      m("deals@shop.example", `Deal of the day ${i}`),
    );
    const found = findBulkSenders(rows);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(9);
  });

  it("does not trip on a marketing subject that merely mentions a safe word", () => {
    // "secure" in a marketing subject is not a security alert. Being too eager
    // here quietly disables the feature for ordinary newsletters.
    const rows = Array.from({ length: 9 }, () =>
      m("deals@shop.example", "Secure your seat at our summer sale"),
    );
    expect(findBulkSenders(rows)).toHaveLength(1);
  });

  it("is case- and punctuation-insensitive", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => m("news@big.example", "Digest")),
      m("sys@big.example", "SECURITY ALERT!"),
    ];
    expect(findBulkSenders(rows)).toEqual([]);
  });

  it("reports why a domain was withheld, for the UI to explain", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => m("news@big.example", "Digest")),
      m("sys@big.example", "Security alert"),
    ];
    const withheld = findBulkSenders(rows, { includeWithheld: true });
    expect(withheld).toHaveLength(1);
    expect(withheld[0].withheld).toBe(true);
    expect(withheld[0].reason).toContain("security");
  });
});
