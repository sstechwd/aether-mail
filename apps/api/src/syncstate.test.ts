import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncState, planFetch } from "./syncstate.js";

/**
 * Incremental sync.
 *
 * Today every sync refetches the newest 40 messages per folder WITH FULL
 * BODIES — up to 256KB each, every five minutes, forever. On a large mailbox
 * over a slow link that is the difference between a client you can use and one
 * you cannot.
 *
 * IMAP already answers this properly: remember the highest UID seen and ask
 * for everything above it.
 *
 * The trap is UIDVALIDITY. It is the server saying "my UIDs no longer mean
 * what they did" — after a mailbox is recreated, or on some providers after a
 * restore. A client that ignores it will happily ask for UID 900+ in a mailbox
 * whose UIDs restarted at 1 and silently never see mail again. That failure is
 * invisible: no error, just an inbox that stops updating.
 */

function freshState(): SyncState {
  return SyncState.openFile(join(mkdtempSync(join(tmpdir(), "aether-sync-")), "syncstate.json"));
}

describe("planFetch", () => {
  it("asks for a full window when nothing is known", () => {
    const plan = planFetch(undefined, 12345);
    expect(plan.mode).toBe("full");
    expect(plan.sinceUid).toBeUndefined();
  });

  it("asks only for what is new when a UID is known", () => {
    const plan = planFetch({ uidValidity: 12345, highestUid: 900 }, 12345);
    expect(plan.mode).toBe("incremental");
    expect(plan.sinceUid).toBe(900);
  });

  it("falls back to a full window when UIDVALIDITY changed", () => {
    // The server has renumbered. Asking for UID 901+ in a mailbox that now
    // starts at 1 returns nothing, forever, with no error.
    const plan = planFetch({ uidValidity: 12345, highestUid: 900 }, 99999);
    expect(plan.mode).toBe("full");
    expect(plan.sinceUid).toBeUndefined();
    expect(plan.reason).toContain("UIDVALIDITY");
  });

  it("falls back when the server reports no UIDVALIDITY at all", () => {
    const plan = planFetch({ uidValidity: 12345, highestUid: 900 }, 0);
    expect(plan.mode).toBe("full");
  });

  it("treats a zero highest UID as nothing known", () => {
    const plan = planFetch({ uidValidity: 12345, highestUid: 0 }, 12345);
    expect(plan.mode).toBe("full");
  });
});

describe("SyncState", () => {
  let state: SyncState;
  beforeEach(() => {
    state = freshState();
  });

  it("knows nothing about a folder it has never synced", () => {
    expect(state.get("acc-1", "INBOX")).toBeUndefined();
  });

  it("remembers the highest UID for a folder", () => {
    state.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 42 });
    expect(state.get("acc-1", "INBOX")?.highestUid).toBe(42);
  });

  it("keeps folders and accounts separate", () => {
    state.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 42 });
    state.record("acc-1", "Sent", { uidValidity: 1, highestUid: 7 });
    state.record("acc-2", "INBOX", { uidValidity: 1, highestUid: 99 });
    expect(state.get("acc-1", "INBOX")?.highestUid).toBe(42);
    expect(state.get("acc-1", "Sent")?.highestUid).toBe(7);
    expect(state.get("acc-2", "INBOX")?.highestUid).toBe(99);
  });

  it("never moves the highest UID backwards", () => {
    // An out-of-order or partial response must not rewind our position and
    // cause the same mail to be pulled again on every future sync.
    state.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 900 });
    state.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 800 });
    expect(state.get("acc-1", "INBOX")?.highestUid).toBe(900);
  });

  it("does move backwards when UIDVALIDITY changed", () => {
    // A renumbered mailbox is the one case where a lower UID is correct.
    state.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 900 });
    state.record("acc-1", "INBOX", { uidValidity: 2, highestUid: 5 });
    expect(state.get("acc-1", "INBOX")?.highestUid).toBe(5);
    expect(state.get("acc-1", "INBOX")?.uidValidity).toBe(2);
  });

  it("survives a reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aether-sync-")), "syncstate.json");
    const first = SyncState.openFile(path);
    first.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 42 });
    expect(SyncState.openFile(path).get("acc-1", "INBOX")?.highestUid).toBe(42);
  });

  it("starts clean rather than throwing on a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-sync-"));
    const path = join(dir, "syncstate.json");
    require("node:fs").writeFileSync(path, "{ not json", "utf8");
    expect(() => SyncState.openFile(path)).not.toThrow();
  });

  it("can be reset for one folder, to force a full resync", () => {
    state.record("acc-1", "INBOX", { uidValidity: 1, highestUid: 42 });
    state.reset("acc-1", "INBOX");
    expect(state.get("acc-1", "INBOX")).toBeUndefined();
  });
});
