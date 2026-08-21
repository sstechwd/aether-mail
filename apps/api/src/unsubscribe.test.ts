import { describe, expect, it } from "vitest";
import { parseUnsubscribe } from "./unsubscribe.js";

/**
 * One-click unsubscribe (RFC 2369 List-Unsubscribe, RFC 8058 One-Click).
 *
 * Filing a newsletter hides it; unsubscribing stops it. On the live inbox 93
 * of 180 messages carry the header and 90 of those support One-Click, so this
 * is the difference between managing symptoms and fixing the cause.
 *
 * THE HEADER IS ATTACKER-CONTROLLED INPUT. It arrives in mail from strangers,
 * so every value here is hostile until parsed. Three separate dangers:
 *
 *  1. `mailto:` unsubscribe means SENDING AN EMAIL. The agent must never do
 *     that — it is exactly the capability the whole design withholds.
 *  2. A non-https scheme (javascript:, file:, data:) is a straightforward
 *     attack on whatever opens it.
 *  3. Even a valid https unsubscribe CONFIRMS THE ADDRESS IS LIVE, which is
 *     the classic reason not to click unsubscribe in spam. That is a judgement
 *     call, so it belongs to the human, not the model.
 */

function header(value: string): string {
  return `From: a@b.example\r\nList-Unsubscribe: ${value}\r\nSubject: hi`;
}

describe("parseUnsubscribe", () => {
  it("finds nothing when the header is absent", () => {
    expect(parseUnsubscribe("From: a@b.example\r\nSubject: hi")).toBeUndefined();
  });

  it("extracts a plain https link", () => {
    const got = parseUnsubscribe(header("<https://shop.example/u/abc>"));
    expect(got?.url).toBe("https://shop.example/u/abc");
    expect(got?.oneClick).toBe(false);
  });

  it("prefers https when the header offers both https and mailto", () => {
    // mailto means sending mail. Given a choice, never take it.
    const got = parseUnsubscribe(
      header("<mailto:stop@shop.example>, <https://shop.example/u/abc>"),
    );
    expect(got?.url).toBe("https://shop.example/u/abc");
    expect(got?.method).toBe("web");
  });

  it("reports a mailto-only unsubscribe as requiring a human to send", () => {
    const got = parseUnsubscribe(header("<mailto:unsubscribe@shop.example>"));
    expect(got?.method).toBe("email");
    // Never presented as something the app can just do.
    expect(got?.url).toBeUndefined();
    expect(got?.mailto).toBe("unsubscribe@shop.example");
  });

  it("detects RFC 8058 One-Click", () => {
    const raw =
      "List-Unsubscribe: <https://shop.example/u/abc>\r\n" +
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click";
    expect(parseUnsubscribe(raw)?.oneClick).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "file:///c:/windows/system32",
    "data:text/html,<script>alert(1)</script>",
    "http://insecure.example/u",
    "ftp://shop.example/u",
    "vbscript:msgbox",
  ])("refuses the dangerous scheme %j", (bad) => {
    const got = parseUnsubscribe(header(`<${bad}>`));
    expect(got?.url).toBeUndefined();
  });

  it("refuses a link with credentials embedded in it", () => {
    // https://user:pass@evil.example/ renders as evil.example but reads as
    // trustworthy at a glance.
    expect(parseUnsubscribe(header("<https://shop.example@evil.example/u>"))?.url).toBeUndefined();
  });

  it("survives a malformed header rather than throwing", () => {
    for (const junk of ["", "<", "<>", "<<>>", "not a url", "<https://", "\u0000"]) {
      expect(() => parseUnsubscribe(header(junk))).not.toThrow();
    }
  });

  it("ignores an absurdly long header instead of processing it", () => {
    // A megabyte of angle brackets is not a real unsubscribe link.
    const got = parseUnsubscribe(header("<https://a.example/" + "x".repeat(5000) + ">"));
    expect(got?.url).toBeUndefined();
  });

  it("is case-insensitive about the header name", () => {
    expect(parseUnsubscribe("list-unsubscribe: <https://a.example/u>")?.url).toBe(
      "https://a.example/u",
    );
  });

  it("handles a folded header across lines", () => {
    // RFC 5322 allows continuation lines; real senders use them.
    const raw = "List-Unsubscribe: <https://shop.example/u/\r\n abcdef>";
    expect(parseUnsubscribe(raw)?.url).toBe("https://shop.example/u/abcdef");
  });

  it("keeps the sender domain so the UI can name who it is unsubscribing from", () => {
    const raw = "From: Shop <news@mailer.shop.example>\r\nList-Unsubscribe: <https://x.example/u>";
    expect(parseUnsubscribe(raw)?.fromDomain).toBe("mailer.shop.example");
  });
});
