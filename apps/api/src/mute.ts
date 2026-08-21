/**
 * Muted threads.
 *
 * The case this exists for is a reply-all storm on a thread you were CC'd
 * into. Muting keeps new replies out of the inbox without unsubscribing you or
 * deleting anything — they arrive filed and marked read, and the thread is
 * still there when you want it.
 *
 * Keyed on the NORMALIZED SUBJECT, deliberately reusing threading.ts, because
 * the whole point is to catch messages that have not arrived yet — so message
 * ids are useless here. If the two normalizations ever diverge, muting quietly
 * stops catching replies, which is why there is a test pinning them together.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeSubject } from "./threading.js";

export class MuteBook {
  private keys = new Set<string>();
  private filePath: string | null = null;

  static openFile(filePath: string): MuteBook {
    const book = new MuteBook();
    book.filePath = filePath;
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (Array.isArray(rows)) {
        for (const row of rows) if (typeof row === "string") book.keys.add(row);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return book;
  }

  private key(subject: string): string {
    return normalizeSubject(subject ?? "").trim().toLowerCase();
  }

  mute(subject: string): void {
    const key = this.key(subject);
    // An empty key would match every blank-subject message in the mailbox.
    if (!key) return;
    this.keys.add(key);
    this.save();
  }

  unmute(subject: string): void {
    const key = this.key(subject);
    if (this.keys.delete(key)) this.save();
  }

  isMuted(subject: string): boolean {
    const key = this.key(subject);
    return key ? this.keys.has(key) : false;
  }

  list(): string[] {
    return [...this.keys];
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list()), "utf8");
  }
}
