/**
 * Remote image policy.
 *
 * Blocking remote images protects against tracking pixels — opening a message
 * would otherwise tell the sender you read it, when, and roughly where from.
 * That is worth defending.
 *
 * What was wrong was not the blocking but the amnesia: the choice was per
 * message and forgotten immediately, and the live mailbox has 118 messages
 * with remote images. "Click Load images 118 times" is not a privacy feature,
 * it is a broken one, and it trains people to stop reading the warning.
 *
 * So: default to asking, but let the answer stick — globally, or per sender.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * ask    — block, show the Load button (default; safest useful setting)
 * always — load remote images everywhere
 * never  — block everywhere, no per-sender exceptions
 */
export type ImageMode = "ask" | "always" | "never";

type Stored = { mode: ImageMode; trusted: string[] };

/** `Priya <PRIYA@example.com>` -> `priya@example.com` */
function addressOf(sender: string): string {
  const value = (sender ?? "").trim();
  const angled = /<([^>]+)>/.exec(value);
  const raw = (angled ? angled[1] : value).trim().toLowerCase();
  return raw.includes("@") ? raw : "";
}

export class ImagePolicy {
  private data: Stored = { mode: "ask", trusted: [] };
  private filePath: string | null = null;

  static openFile(filePath: string): ImagePolicy {
    const policy = new ImagePolicy();
    policy.filePath = filePath;
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf8")) as Partial<Stored>;
      policy.data = {
        mode: rows.mode === "always" || rows.mode === "never" ? rows.mode : "ask",
        trusted: Array.isArray(rows.trusted)
          ? rows.trusted.filter((t): t is string => typeof t === "string")
          : [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return policy;
  }

  mode(): ImageMode {
    return this.data.mode;
  }

  setMode(mode: ImageMode): void {
    this.data.mode = mode;
    this.save();
  }

  trusted(): string[] {
    return [...this.data.trusted];
  }

  trust(sender: string): void {
    const address = addressOf(sender);
    if (!address || this.data.trusted.includes(address)) return;
    this.data.trusted.push(address);
    this.save();
  }

  untrust(sender: string): void {
    const address = addressOf(sender);
    this.data.trusted = this.data.trusted.filter((t) => t !== address);
    this.save();
  }

  /** Should remote images load for a message from this sender? */
  allows(sender: string): boolean {
    if (this.data.mode === "never") return false;
    if (this.data.mode === "always") return true;
    const address = addressOf(sender);
    return address ? this.data.trusted.includes(address) : false;
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data), "utf8");
  }
}
