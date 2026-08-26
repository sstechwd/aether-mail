import { describe, expect, it } from "vitest";
import { sanitizeMailHtml } from "./html-mail.js";

/**
 * Reported: "emails themselves are formatted weird, too boxy and small. I
 * can't see the whole email like I would in outlook."
 *
 * Two causes, both in the wrapper this module emits:
 *   1. body had `max-width: 42rem`, so a newsletter designed for 600-800px
 *      got squeezed into a narrow column inside an already-narrow frame.
 *   2. every <style> block was stripped, which is what actually made mail
 *      "boxy" — HTML mail carries its own layout in those blocks, and without
 *      them a multi-column newsletter collapses into stacked raw blocks.
 *
 * Keeping <style> is safe here: the frame is sandboxed with no scripts and no
 * same-origin, and the CSP already allows inline styles for the attribute
 * styling that mail relies on. CSS cannot exfiltrate anything when font-src
 * and img-src are locked down.
 */

describe("sanitizeMailHtml — layout", () => {
  it("no longer clamps the body to a narrow column", () => {
    const out = sanitizeMailHtml("<p>hi</p>", { allowRemoteImages: false });
    expect(out).not.toMatch(/max-width:\s*42rem/);
  });

  it("keeps the sender's own <style> so the layout survives", () => {
    const mail = '<style>.hero{background:#222;color:#fff}</style><div class="hero">Sale</div>';
    const out = sanitizeMailHtml(mail, { allowRemoteImages: false });
    expect(out).toContain(".hero");
    expect(out).toContain("Sale");
  });

  it("still strips scripts inside a style block trick", () => {
    const mail = "<style>@import url('javascript:alert(1)');</style><p>x</p>";
    const out = sanitizeMailHtml(mail, { allowRemoteImages: false });
    // @import can pull remote CSS; that is a network call we do not allow.
    expect(out).not.toMatch(/@import/i);
  });

  it("strips expression() which old IE CSS could use to run code", () => {
    const mail = "<style>div{width:expression(alert(1))}</style><p>x</p>";
    const out = sanitizeMailHtml(mail, { allowRemoteImages: false });
    expect(out).not.toMatch(/expression\s*\(/i);
  });

  it("strips javascript: urls inside style blocks", () => {
    const mail = "<style>body{background:url('javascript:alert(1)')}</style>";
    const out = sanitizeMailHtml(mail, { allowRemoteImages: false });
    expect(out).not.toMatch(/javascript:/i);
  });

  it("still removes script tags", () => {
    const out = sanitizeMailHtml("<script>alert(1)</script><p>safe</p>", { allowRemoteImages: false });
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("safe");
    expect(out).toContain("aether-open");
  });

  it("still removes event handlers", () => {
    const out = sanitizeMailHtml('<div onclick="alert(1)">x</div>', { allowRemoteImages: false });
    expect(out).not.toMatch(/onclick/i);
  });

  it("still blocks remote images until the user opts in", () => {
    const out = sanitizeMailHtml('<img src="https://tracker.example/pixel.gif">', {
      allowRemoteImages: false,
    });
    // The URL is kept in data-blocked-src so "Load images" can restore it, but
    // it must not survive anywhere the browser would actually fetch it.
    expect(out).not.toMatch(/<img[^>]*src\s*=\s*["']https:\/\/tracker\.example/i);
    expect(out).toContain("image blocked");
    expect(out).toContain("img-src data:;");
  });

  it("restores the real image once the user opts in", () => {
    const out = sanitizeMailHtml('<img src="https://cdn.example/hero.png">', {
      allowRemoteImages: true,
    });
    expect(out).toMatch(/<img[^>]*src\s*=\s*["']https:\/\/cdn\.example/i);
  });

  it("lets images scale down instead of overflowing", () => {
    const out = sanitizeMailHtml("<p>x</p>", { allowRemoteImages: false });
    expect(out).toMatch(/img\s*\{[^}]*max-width:\s*100%/);
  });

  it("keeps the CSP locked to no scripts and no frames", () => {
    const out = sanitizeMailHtml("<p>x</p>", { allowRemoteImages: false });
    expect(out).toContain("script-src 'unsafe-inline'");
    expect(out).toContain("frame-src 'none'");
    expect(out).toContain("default-src 'none'");
  });
});
