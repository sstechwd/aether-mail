import { describe, expect, it } from "vitest";
import { sanitizeComposedHtml, htmlToPlainText, hasFormatting } from "./compose-html.js";

/**
 * Rich-text compose.
 *
 * The user writes in a contenteditable, which means the browser hands us
 * whatever markup it feels like — plus anything they pasted from a web page.
 * That HTML goes out over SMTP to other people's mail clients, so it gets
 * sanitized on the way out, not on the way in.
 *
 * The threat here is different from reading mail: we are the SENDER. Shipping
 * a script tag or a tracking pixel because someone pasted it into a reply
 * would make this client a vector rather than a victim.
 */

describe("sanitizeComposedHtml", () => {
  it("keeps the formatting people actually use", () => {
    const out = sanitizeComposedHtml("<b>bold</b> <i>italic</i> <u>under</u> <ul><li>one</li></ul>");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).toContain("<li>one</li>");
  });

  it("strips script tags", () => {
    const out = sanitizeComposedHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("hi");
  });

  it("strips event handlers pasted from a web page", () => {
    const out = sanitizeComposedHtml('<p onclick="steal()">text</p>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("text");
  });

  it("strips javascript: links", () => {
    const out = sanitizeComposedHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps ordinary links", () => {
    const out = sanitizeComposedHtml('<a href="https://example.com">site</a>');
    expect(out).toContain("https://example.com");
  });

  it("removes remote images — we will not send a tracking pixel for someone", () => {
    // Pasting from a web page drags in <img src="https://tracker...">. Sending
    // that embeds a beacon in mail the recipient did not ask for.
    const out = sanitizeComposedHtml('<p>hi</p><img src="https://tracker.example/p.gif">');
    expect(out).not.toContain("tracker.example");
    expect(out).toContain("hi");
  });

  it("strips style attributes that could hide text", () => {
    const out = sanitizeComposedHtml('<p style="display:none">hidden</p>');
    expect(out).not.toMatch(/style=/i);
  });

  it("strips iframes, objects and forms", () => {
    const out = sanitizeComposedHtml("<iframe src=x></iframe><object></object><form></form><p>ok</p>");
    expect(out).not.toMatch(/<(iframe|object|form)/i);
    expect(out).toContain("ok");
  });

  it("leaves plain text alone", () => {
    expect(sanitizeComposedHtml("just words")).toBe("just words");
  });

  it("does not choke on empty input", () => {
    expect(sanitizeComposedHtml("")).toBe("");
  });
});

describe("htmlToPlainText", () => {
  it("produces a readable text/plain alternative", () => {
    expect(htmlToPlainText("<p>Hello</p><p>World</p>")).toBe("Hello\n\nWorld");
  });

  it("turns <br> into a newline", () => {
    expect(htmlToPlainText("one<br>two")).toBe("one\ntwo");
  });

  it("marks list items so a plain-text reader can follow them", () => {
    expect(htmlToPlainText("<ul><li>a</li><li>b</li></ul>")).toContain("- a");
  });

  it("keeps the link target, because a bare label is useless in plain text", () => {
    expect(htmlToPlainText('<a href="https://example.com">site</a>')).toContain("https://example.com");
  });

  it("decodes entities", () => {
    expect(htmlToPlainText("a &amp; b &lt;c&gt; &nbsp;d")).toBe("a & b <c>  d");
  });

  it("collapses the runaway blank lines contenteditable produces", () => {
    expect(htmlToPlainText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});

describe("hasFormatting", () => {
  it("is false for plain text, so we send text/plain only", () => {
    expect(hasFormatting("just words")).toBe(false);
  });

  it("is false for a bare div wrapper — contenteditable adds those by itself", () => {
    expect(hasFormatting("<div>just words</div>")).toBe(false);
  });

  it("is true once there is real formatting", () => {
    expect(hasFormatting("<b>bold</b>")).toBe(true);
    expect(hasFormatting('<a href="https://x.example">link</a>')).toBe(true);
  });
});
