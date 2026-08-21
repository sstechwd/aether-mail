/**
 * Attachment previews: deciding what is safe to render in-app.
 *
 * Downloading already works; viewing does not, so checking a one-page PDF
 * means writing it to disk and handing it to whatever the OS associates with
 * that extension. On the live mailbox 15 of 31 attachments are images and 6
 * are PDFs, so two thirds are previewable without leaving the app.
 *
 * AN ATTACHMENT IS A FILE FROM A STRANGER, and the MIME type on it is a claim
 * by the sender rather than a fact. So this is an ALLOW-LIST of things we can
 * display safely, never a deny-list of things that look dangerous: a
 * deny-list has to anticipate every hostile type, an allow-list only has to
 * know the safe ones.
 *
 * Two exclusions worth stating because they look arbitrary:
 *
 *  - `text/html` is renderable and is exactly what an attacker would attach.
 *    Mail bodies already go through a sandboxed, sanitized, image-blocked
 *    path; an attachment preview would be a second and weaker route to the
 *    same capability. Nobody previews an HTML attachment on purpose.
 *  - `image/svg+xml` is an image to a person and a script host to a browser.
 *    It belongs with HTML, not with PNG.
 */

export type PreviewKind = "image" | "pdf" | "text" | "none";

/** Types we are willing to render, and how. */
const ALLOWED: Record<string, PreviewKind> = {
  "image/jpeg": "image",
  "image/pjpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/bmp": "image",
  "application/pdf": "pdf",
  "text/plain": "text",
};

/**
 * Extensions that must never be previewed whatever the MIME type says.
 *
 * A sender can label an executable `image/png`. When the declared type and
 * the filename disagree, the disagreement is itself the signal — refuse.
 */
const DANGEROUS_EXT =
  /\.(exe|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|jar|msi|msp|hta|cpl|dll|lnk|reg|sh|app|dmg|pkg|deb|rpm|apk|iso|img|html?|htm|xhtml|svg)$/i;

/** MIME type without its parameters, lowercased. */
function baseType(mime: string): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * How, if at all, this attachment can be shown in-app.
 *
 * Returns "none" for anything not explicitly allowed, so a new or unknown
 * type is never previewed by default.
 */
export function previewKind(mime: string, filename: string): PreviewKind {
  const type = baseType(mime);
  if (!type || !type.includes("/") || type.endsWith("/")) return "none";

  // The filename gets a veto: a mislabelled executable is not an image.
  if (DANGEROUS_EXT.test((filename ?? "").trim())) return "none";

  return ALLOWED[type] ?? "none";
}
