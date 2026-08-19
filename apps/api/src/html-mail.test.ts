import { describe, expect, it } from "vitest";
import { looksLikeHtml, remoteImageCount, sanitizeMailHtml } from "./html-mail.js";

describe("sanitizeMailHtml inline images", () => {
  it("keeps a resolved inline data: image, since those bytes came from the mail itself", () => {
    const raw = '<p>hi</p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="logo">';
    const out = sanitizeMailHtml(raw, { allowRemoteImages: false });
    expect(out).toContain("data:image/gif;base64,R0lGOD");
    expect(out).toContain("img-src");
  });

  it("refuses a data: URL that is not an image", () => {
    const raw = '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">';
    const out = sanitizeMailHtml(raw, { allowRemoteImages: false });
    expect(out).not.toContain("data:text/html");
  });

  it("still blocks remote images while inline data images are allowed", () => {
    const raw = '<img src="https://tracker.test/pixel.gif"><img src="data:image/png;base64,AAAA">';
    const out = sanitizeMailHtml(raw, { allowRemoteImages: false });
    expect(out).toContain("[image blocked]");
    expect(out).toContain("data:image/png;base64,AAAA");
  });
});


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
