/**
 * Per-account signatures.
 *
 * Small feature, disproportionately missed — it is the first thing anyone
 * notices when they send a professional email from a new client.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The conventional separator. Mail clients use it to fold signatures away. */
const SEPARATOR = "-- ";

export class SignatureBook {
  private sigs = new Map<string, string>();
  private filePath: string | null = null;

  static openFile(filePath: string): SignatureBook {
    const book = new SignatureBook();
    book.filePath = filePath;
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
      for (const [id, text] of Object.entries(rows)) book.sigs.set(id, text);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return book;
  }

  get(accountId: string): string {
    return this.sigs.get(accountId) ?? "";
  }

  set(accountId: string, text: string): void {
    if (text.trim()) {
      this.sigs.set(accountId, text);
    } else {
      this.sigs.delete(accountId);
    }
    this.save();
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.sigs)), "utf8");
  }
}

/**
 * Put the signature under what the user wrote.
 *
 * In a reply the body already contains the quoted original, and the signature
 * belongs with your text — not stranded below someone else's message. So it is
 * inserted before the quote when one is present.
 */
export function applySignature(body: string, signature: string): string {
  const sig = (signature ?? "").trim();
  if (!sig) return body;
  // Already signed — do not stack signatures on every edit.
  if (body.includes(sig)) return body;

  const block = `${SEPARATOR}\n${sig}`;
  const quoteAt = body.search(/^(On .*wrote:|-{5,} ?Forwarded message)/m);
  if (quoteAt > 0) {
    const head = body.slice(0, quoteAt).replace(/\s+$/, "");
    const tail = body.slice(quoteAt);
    return `${head}\n\n${block}\n\n${tail}`;
  }
  return `${body}\n\n${block}`;
}
