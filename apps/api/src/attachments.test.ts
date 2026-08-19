import { describe, expect, it } from "vitest";
import { inlineCidImages, attachmentStrip, type MailAttachment } from "./attachments.js";

const PARTS: MailAttachment[] = [
  { part: 2, filename: "logo.gif", mimeType: "image/gif", size: 43, contentId: "logo123", inline: true },
  { part: 3, filename: "receipt.pdf", mimeType: "application/pdf", size: 900, contentId: null, inline: false },
];

describe("inlineCidImages", () => {
  it("swaps a cid: reference for local data the iframe can render", () => {
    const html = '<p>hi</p><img src="cid:logo123" alt="logo">';
    const out = inlineCidImages(html, PARTS, {
      "logo123": { mimeType: "image/gif", data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" },
    });
    expect(out).toContain("src=\"data:image/gif;base64,R0lGOD");
    expect(out).not.toContain("cid:logo123");
  });

  it("leaves a cid: reference alone when the part was not loaded", () => {
    const html = '<img src="cid:missing">';
    const out = inlineCidImages(html, PARTS, {});
    expect(out).toContain("cid:missing");
  });

  it("never emits a data: URL for a non-image part (no script smuggling)", () => {
    const html = '<img src="cid:evil">';
    const out = inlineCidImages(html, PARTS, {
      evil: { mimeType: "text/html", data: "PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" },
    });
    expect(out).not.toContain("data:text/html");
    expect(out).toContain("cid:evil");
  });

  it("does not rewrite remote or data urls already present", () => {
    const html = '<img src="https://x.test/a.png"><img src="data:image/png;base64,AAA">';
    const out = inlineCidImages(html, PARTS, {});
    expect(out).toContain("https://x.test/a.png");
    expect(out).toContain("data:image/png;base64,AAA");
  });
});

describe("attachmentStrip", () => {
  it("lists real attachments and hides inline images", () => {
    const strip = attachmentStrip(PARTS);
    expect(strip).toHaveLength(1);
    expect(strip[0].filename).toBe("receipt.pdf");
    expect(strip[0].human).toBe("900 B");
  });

  it("formats sizes a human reads", () => {
    const strip = attachmentStrip([
      { part: 1, filename: "a.zip", mimeType: "application/zip", size: 2_400_000, contentId: null, inline: false },
    ]);
    expect(strip[0].human).toBe("2.3 MB");
  });

  it("strips path separators from a hostile filename", () => {
    const strip = attachmentStrip([
      { part: 1, filename: "../../etc/passwd", mimeType: "text/plain", size: 10, contentId: null, inline: false },
    ]);
    expect(strip[0].filename).toBe("passwd");
    expect(strip[0].filename).not.toContain("..");
  });
});
