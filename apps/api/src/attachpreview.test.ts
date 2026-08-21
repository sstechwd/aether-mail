import { describe, expect, it } from "vitest";
import { previewKind } from "./attachpreview.js";
import { safeFilename } from "./attachments.js";

/**
 * Attachment previews.
 *
 * Downloading works; viewing in-app does not, so checking a one-page PDF means
 * writing it to disk and opening whatever the OS associates with it. On the
 * live mailbox 15 of 31 attachments are images and 6 are PDFs — two thirds are
 * previewable without leaving the app.
 *
 * AN ATTACHMENT IS A FILE FROM A STRANGER. The MIME type on it is a claim by
 * the sender, not a fact, so the decision of what to render must come from an
 * allow-list of types we can display safely — never from "it isn't dangerous".
 *
 * text/html is the interesting exclusion: we CAN render it, and it is exactly
 * the thing an attacker would attach. Mail bodies get sandboxed, sanitized and
 * image-blocked; an attachment preview would be a second, weaker path to the
 * same capability. Not worth it for a file type nobody previews on purpose.
 */

describe("previewKind", () => {
  it("previews the image types a mail client actually receives", () => {
    for (const t of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      expect(previewKind(t, "x")).toBe("image");
    }
  });

  it("previews PDF", () => {
    expect(previewKind("application/pdf", "invoice.pdf")).toBe("pdf");
  });

  it("previews plain text", () => {
    expect(previewKind("text/plain", "notes.txt")).toBe("text");
  });

  it.each([
    ["text/html", "page.html"],
    ["image/svg+xml", "logo.svg"],
    ["application/xhtml+xml", "page.xhtml"],
  ])("refuses %s — it can carry script", (mime, name) => {
    // SVG is an image to a user and a script host to a browser.
    expect(previewKind(mime, name)).toBe("none");
  });

  it.each([
    ["application/zip", "archive.zip"],
    ["application/x-msdownload", "setup.exe"],
    ["application/octet-stream", "thing.bin"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "cv.docx"],
    ["message/delivery-status", "status"],
  ])("does not pretend it can preview %s", (mime, name) => {
    expect(previewKind(mime, name)).toBe("none");
  });

  it("trusts the extension over a lying MIME type for executables", () => {
    // A sender can label anything image/png. If the NAME says .exe, refuse —
    // disagreement between the two claims is itself the signal.
    expect(previewKind("image/png", "totally-safe.exe")).toBe("none");
    expect(previewKind("image/jpeg", "invoice.pdf.scr")).toBe("none");
    expect(previewKind("text/plain", "run.bat")).toBe("none");
  });

  it("is case-insensitive about both type and extension", () => {
    expect(previewKind("IMAGE/PNG", "Photo.PNG")).toBe("image");
    expect(previewKind("Application/PDF", "Doc.PDF")).toBe("pdf");
    expect(previewKind("image/png", "BAD.EXE")).toBe("none");
  });

  it("handles a MIME type with parameters", () => {
    expect(previewKind("text/plain; charset=utf-8", "a.txt")).toBe("text");
  });

  it("refuses a missing or malformed type instead of guessing", () => {
    for (const t of ["", "   ", "notamimetype", "/", "image/"]) {
      expect(previewKind(t, "x.png")).toBe("none");
    }
  });
});

describe("safeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(safeFilename("invoice.pdf")).toBe("invoice.pdf");
  });

  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32\\config", "config"],
    ["/absolute/path.txt", "path.txt"],
    ["C:\\Users\\x\\thing.txt", "thing.txt"],
  ])("strips path traversal from %j", (bad, want) => {
    expect(safeFilename(bad)).toBe(want);
  });

  it("replaces characters that break a filesystem", () => {
    expect(safeFilename('a:b*c?d"e<f>g|h.txt')).not.toMatch(/[:*?"<>|]/);
  });

  it("never returns an empty name", () => {
    for (const junk of ["", "   ", "..", "/", "\\", "\u0000"]) {
      expect(safeFilename(junk).length).toBeGreaterThan(0);
    }
  });

  it("truncates an absurdly long name", () => {
    expect(safeFilename("x".repeat(500) + ".pdf").length).toBeLessThanOrEqual(120);
  });

  it("keeps the extension when truncating, so the file still opens", () => {
    expect(safeFilename("y".repeat(500) + ".pdf").endsWith(".pdf")).toBe(true);
  });
});
