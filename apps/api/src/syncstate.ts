/**
 * Incremental sync state.
 *
 * Every sync used to refetch the newest 40 messages per folder with full
 * bodies — up to 256KB each, every five minutes, forever. IMAP answers this
 * properly: remember the highest UID seen and ask only for what is above it.
 *
 * The trap is UIDVALIDITY. It is the server saying "my UIDs no longer mean
 * what they did" — after a mailbox is recreated, or on some providers after a
 * restore. A client that ignores it asks for UID 901+ in a mailbox whose UIDs
 * restarted at 1, gets nothing back, and silently never sees mail again. No
 * error, just an inbox that stopped updating, which is the worst kind of bug
 * because the user reports it as "your app is broken" months later.
 *
 * So the rule is: trust the remembered UID only while UIDVALIDITY matches, and
 * fall back to a full window the moment it does not.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type FolderSync = {
  /** The server's UIDVALIDITY for this mailbox when we last synced it. */
  uidValidity: number;
  /** Highest UID we have actually stored. */
  highestUid: number;
};

export type FetchPlan = {
  mode: "full" | "incremental";
  /** Fetch UIDs above this. Undefined for a full window. */
  sinceUid?: number;
  reason: string;
};

/**
 * Decide what to ask the server for.
 *
 * Kept as a pure function so the branching — the part that actually goes
 * wrong — is testable without a mailbox.
 */
export function planFetch(known: FolderSync | undefined, serverUidValidity: number): FetchPlan {
  if (!known || !known.highestUid) {
    return { mode: "full", reason: "no previous sync for this folder" };
  }
  if (!serverUidValidity) {
    // A server that will not tell us cannot be trusted with an incremental
    // request; the cost of being wrong here is silently missing mail.
    return { mode: "full", reason: "server reported no UIDVALIDITY" };
  }
  if (serverUidValidity !== known.uidValidity) {
    return {
      mode: "full",
      reason: `UIDVALIDITY changed (${known.uidValidity} -> ${serverUidValidity}); UIDs renumbered`,
    };
  }
  return {
    mode: "incremental",
    sinceUid: known.highestUid,
    reason: `everything above UID ${known.highestUid}`,
  };
}

type StateFile = Record<string, FolderSync>;

export class SyncState {
  private path: string;
  private data: StateFile;

  private constructor(path: string, data: StateFile) {
    this.path = path;
    this.data = data;
  }

  static openFile(path: string): SyncState {
    let data: StateFile = {};
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          data = parsed as StateFile;
        }
      }
    } catch {
      // A corrupt state file costs one full resync, not a broken app.
      data = {};
    }
    return new SyncState(path, data);
  }

  private key(accountId: string, folder: string): string {
    return `${accountId}::${folder}`;
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
  }

  get(accountId: string, folder: string): FolderSync | undefined {
    return this.data[this.key(accountId, folder)];
  }

  /**
   * Record where we got to.
   *
   * The highest UID never moves backwards while UIDVALIDITY is unchanged: an
   * out-of-order or partial response must not rewind our position and cause
   * the same mail to be pulled again on every future sync. A renumbered
   * mailbox is the one case where a lower UID is correct.
   */
  record(accountId: string, folder: string, next: FolderSync): void {
    const key = this.key(accountId, folder);
    const prev = this.data[key];
    if (prev && prev.uidValidity === next.uidValidity && next.highestUid < prev.highestUid) {
      return;
    }
    this.data[key] = { uidValidity: next.uidValidity, highestUid: next.highestUid };
    this.save();
  }

  /** Forget a folder, forcing a full resync next time. */
  reset(accountId: string, folder: string): void {
    delete this.data[this.key(accountId, folder)];
    this.save();
  }
}
