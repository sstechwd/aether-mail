import { describe, expect, it } from "vitest";
import { looksLikeHtml, remoteImageCount, sanitizeMailHtml } from "./html-mail.js";

const RAW = `<html><body>
<script>alert(1)</script>
<p>Hello <b>Priya</b></p>
<img src="https://evil.example/pixel.gif" onerror="alert(2)">
<a href="javascript:alert(3)">click</a>
<iframe src="https://evil.example"></iframe>
</body></html>`;

describe("sanitizeMailHtml", () => {
  it("keeps text layout and drops script, iframe, javascript urls", () => {
    expect(looksLikeHtml(RAW)).toBe(true);
    expect(remoteImageCount(RAW)).toBe(1);
    const blocked = sanitizeMailHtml(RAW, { allowRemoteImages: false });
    expect(blocked).toContain("Hello");
    expect(blocked).toContain("<b>Priya</b>");
    expect(blocked.toLowerCase()).not.toContain("<script");
    expect(blocked.toLowerCase()).not.toContain("<iframe");
    expect(blocked).not.toContain("javascript:");
    expect(blocked).not.toContain("onerror");
    expect(blocked).not.toMatch(/<img[^>]+https:\/\/evil\.example\/pixel\.gif/i);
    expect(blocked).toContain("data-blocked-src");
    const open = sanitizeMailHtml(RAW, { allowRemoteImages: true });
    expect(open).toContain("https://evil.example/pixel.gif");
    expect(open.toLowerCase()).not.toContain("<script");
  });
});
