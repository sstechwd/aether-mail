/** Decode IMAP fetch into something a human (and the agent) can read. */

/**
 * RFC 2047 encoded words: `=?utf-8?B?...?=` / `=?UTF-8?Q?...?=`.
 *
 * aether-cli decodes these at fetch time now, but mail fetched by earlier builds
 * is already on disk with raw encoded words in the subject, so the read path
 * decodes defensively too. Malformed input is returned untouched, never thrown.
 */
export function decodeEncodedWords(raw: string): string {
  if (!raw || !raw.includes("=?")) return raw;
  // Adjacent encoded words are separated by whitespace that must be dropped.
  const joined = raw.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(
    /=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, enc: string, text: string) => {
      try {
        const label = charset.toLowerCase();
        if (enc.toUpperCase() === "B") {
          const buf = Buffer.from(text, "base64");
          if (buf.length === 0 && text.length > 0) return whole;
          return new TextDecoder(label).decode(buf);
        }
        const bytes: number[] = [];
        for (let i = 0; i < text.length; i += 1) {
          const ch = text[i];
          if (ch === "_") {
            bytes.push(0x20);
          } else if (ch === "=" && i + 2 < text.length) {
            const hex = text.slice(i + 1, i + 3);
            if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return whole;
            bytes.push(parseInt(hex, 16));
            i += 2;
          } else {
            bytes.push(ch.charCodeAt(0));
          }
        }
        return new TextDecoder(label).decode(Uint8Array.from(bytes));
      } catch {
        return whole;
      }
    },
  );
}

export function toIsoDate(raw: string): string {
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

export function compareMailDate(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  const na = Number.isNaN(ta) ? 0 : ta;
  const nb = Number.isNaN(tb) ? 0 : tb;
  return na - nb;
}

export function countHiddenMedia(raw: string): number {
  const imgs = raw.match(/<img\b/gi)?.length ?? 0;
  const cids = raw.match(/cid:/gi)?.length ?? 0;
  return imgs + cids;
}

export function readableBody(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");
  if (!/<[a-z][\s\S]*>/i.test(text)) return text.trim();
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
