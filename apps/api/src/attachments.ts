/**
 * Attachments and inline cid: images.
 *
 * Security posture: the mail HTML is hostile input. We only ever swap a `cid:`
 * reference for a data: URL when the part is an *image*, so a text/html or
 * script part can never be smuggled into the sandboxed frame via <img src>.
 * Bytes are fetched on demand by aether-cli, never carried in the message list.
 */

export type MailAttachment = {
  part: number;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
};

export type LoadedPart = { mimeType: string; data: string };

export type StripEntry = {
  part: number;
  filename: string;
  mimeType: string;
  size: number;
  human: string;
};

/** Only these render as inline images. Anything else stays an unresolved cid:. */
const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp|bmp|avif)$/i;

export function inlineCidImages(
  html: string,
  parts: MailAttachment[],
  loaded: Record<string, LoadedPart>,
): string {
  if (!html) return html;
  return html.replace(/\bsrc\s*=\s*(["'])cid:([^"']+)\1/gi, (whole, quote: string, rawCid: string) => {
    const cid = rawCid.trim().replace(/^<|>$/g, "");
    const part = loaded[cid];
    if (!part) return whole;
    if (!IMAGE_TYPES.test(part.mimeType)) return whole;
    if (!/^[A-Za-z0-9+/=\s]*$/.test(part.data)) return whole;
    const known = parts.find((p) => p.contentId === cid);
    if (known && !known.inline) return whole;
    return `src=${quote}data:${part.mimeType};base64,${part.data.replace(/\s+/g, "")}${quote}`;
  });
}

/** Bytes → what a person reads on a button. */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** A filename is attacker-controlled: never let it carry a path. */
export function safeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").replace(/^\.+/, "").trim();
  return cleaned || "attachment";
}

/** The strip under the message header: real attachments only, inline images excluded. */
export function attachmentStrip(parts: MailAttachment[]): StripEntry[] {
  return parts
    .filter((p) => !p.inline)
    .map((p) => ({
      part: p.part,
      filename: safeFilename(p.filename),
      mimeType: p.mimeType,
      size: p.size,
      human: humanSize(p.size),
    }));
}
