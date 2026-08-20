/**
 * Outbox — queued and scheduled outgoing mail.
 *
 * The user asked for Outlook-style "send later". The safety rule is unchanged:
 * a human queues the message with two clicks. The agent can draft into compose
 * but has no path to enqueue, and nothing here sends without a prior human
 * confirm having produced the item.
 *
 * Persistence matters: a scheduled message must survive the app closing. The
 * queue is a small JSON file, flushed on every mutation — losing a user's
 * outgoing mail is worse than a few extra writes.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type OutboxStatus = "queued" | "sending" | "failed";

export type OutboxItem = {
  id: string;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  attachments: string[];
  /** Epoch ms to send at, or null for "as soon as possible". */
  sendAt: number | null;
  status: OutboxStatus;
  attempts: number;
  error?: string;
  queuedAt: number;
};

/** Give up after this many tries so a bad message cannot loop forever. */
const MAX_ATTEMPTS = 3;

export class Outbox {
  private items = new Map<string, OutboxItem>();
  private filePath: string | null = null;

  static openMemory(): Outbox {
    return new Outbox();
  }

  static openFile(filePath: string): Outbox {
    const box = new Outbox();
    box.filePath = filePath;
    box.load();
    return box;
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      const rows = JSON.parse(readFileSync(this.filePath, "utf8")) as OutboxItem[];
      this.items.clear();
      for (const row of rows) {
        // A message left mid-flight by a crash should be retried, not stranded.
        this.items.set(row.id, row.status === "sending" ? { ...row, status: "queued" } : row);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify([...this.items.values()]), "utf8");
  }

  enqueue(input: {
    accountId: string;
    to: string;
    subject: string;
    body: string;
    attachments?: string[];
    sendAt: number | null;
  }): OutboxItem {
    const item: OutboxItem = {
      id: `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      accountId: input.accountId,
      to: input.to,
      subject: input.subject,
      body: input.body,
      attachments: input.attachments ?? [],
      sendAt: input.sendAt,
      status: "queued",
      attempts: 0,
      queuedAt: Date.now(),
    };
    this.items.set(item.id, item);
    this.save();
    return item;
  }

  /** Everything the user should see waiting, newest first. */
  list(): OutboxItem[] {
    return [...this.items.values()].sort((a, b) => b.queuedAt - a.queuedAt);
  }

  /** Items whose time has come and which still have retries left. */
  due(now: number): OutboxItem[] {
    return [...this.items.values()].filter(
      (i) =>
        i.status !== "sending" &&
        i.attempts < MAX_ATTEMPTS &&
        (i.sendAt === null || i.sendAt <= now),
    );
  }

  /**
   * Atomically take the due items and mark them in flight, so two overlapping
   * ticks cannot send the same message twice.
   */
  claimDue(now: number): OutboxItem[] {
    const claimed = this.due(now);
    for (const item of claimed) {
      this.items.set(item.id, { ...item, status: "sending" });
    }
    if (claimed.length) this.save();
    return claimed;
  }

  markSent(id: string): void {
    if (this.items.delete(id)) this.save();
  }

  markFailed(id: string, reason: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.items.set(id, {
      ...item,
      status: "failed",
      attempts: item.attempts + 1,
      error: reason.slice(0, 300),
    });
    this.save();
  }

  /** User cancelled before it went out — the whole point of an outbox. */
  cancel(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.save();
    return existed;
  }

  /** Put a failed item back in the queue for another try. */
  retry(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.set(id, { ...item, status: "queued", attempts: 0, error: undefined });
    this.save();
    return true;
  }
}
