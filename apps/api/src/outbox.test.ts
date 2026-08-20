import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Outbox } from "./outbox.js";

function freshOutbox(): Outbox {
  const dir = mkdtempSync(join(tmpdir(), "aether-outbox-"));
  return Outbox.openFile(join(dir, "outbox.json"));
}

const MAIL = {
  accountId: "acc-1",
  to: "someone@example.com",
  subject: "Quarterly report",
  body: "Numbers attached.",
  attachments: [] as string[],
};

describe("Outbox queueing", () => {
  let box: Outbox;
  beforeEach(() => {
    box = freshOutbox();
  });

  it("queues a message for immediate send and reports it as due", () => {
    const item = box.enqueue({ ...MAIL, sendAt: null });
    expect(item.id).toBeTruthy();
    expect(item.status).toBe("queued");
    expect(box.due(Date.now())).toHaveLength(1);
  });

  it("holds a scheduled message until its time arrives", () => {
    const future = Date.now() + 60 * 60 * 1000;
    box.enqueue({ ...MAIL, sendAt: future });
    expect(box.due(Date.now())).toHaveLength(0);
    expect(box.due(future + 1000)).toHaveLength(1);
  });

  it("lists queued mail so the user can see what is waiting", () => {
    box.enqueue({ ...MAIL, sendAt: null });
    box.enqueue({ ...MAIL, subject: "Second", sendAt: Date.now() + 5000 });
    const listed = box.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((i) => i.subject)).toContain("Second");
  });

  it("lets the user cancel before it goes out — this is the point of an outbox", () => {
    const item = box.enqueue({ ...MAIL, sendAt: Date.now() + 60_000 });
    expect(box.cancel(item.id)).toBe(true);
    expect(box.list()).toHaveLength(0);
    expect(box.cancel("nope")).toBe(false);
  });

  it("survives a restart — a queued message must not vanish when the app closes", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-outbox-"));
    const file = join(dir, "outbox.json");
    const first = Outbox.openFile(file);
    first.enqueue({ ...MAIL, subject: "Persisted", sendAt: Date.now() + 30_000 });

    const second = Outbox.openFile(file);
    expect(second.list().map((i) => i.subject)).toContain("Persisted");
  });
});

describe("Outbox send lifecycle", () => {
  let box: Outbox;
  beforeEach(() => {
    box = freshOutbox();
  });

  it("marks an item sent and removes it from the queue", () => {
    const item = box.enqueue({ ...MAIL, sendAt: null });
    box.markSent(item.id);
    expect(box.list()).toHaveLength(0);
  });

  it("records a failure with the reason and keeps it for retry", () => {
    const item = box.enqueue({ ...MAIL, sendAt: null });
    box.markFailed(item.id, "SMTP said 535 auth failed");
    const [row] = box.list();
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/535/);
    expect(row.attempts).toBe(1);
  });

  it("stops retrying after repeated failures instead of looping forever", () => {
    const item = box.enqueue({ ...MAIL, sendAt: null });
    box.markFailed(item.id, "temporary");
    box.markFailed(item.id, "temporary");
    box.markFailed(item.id, "temporary");
    const [row] = box.list();
    expect(row.attempts).toBe(3);
    // Exhausted items must not come back as due work.
    expect(box.due(Date.now() + 10 * 60_000)).toHaveLength(0);
  });

  it("a failed item is not silently dropped — the user can still see it", () => {
    const item = box.enqueue({ ...MAIL, sendAt: null });
    box.markFailed(item.id, "no network");
    expect(box.list()).toHaveLength(1);
  });

  it("never returns an item that is already sending, so it cannot double-send", () => {
    const item = box.enqueue({ ...MAIL, sendAt: null });
    const first = box.claimDue(Date.now());
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe(item.id);
    // A second poll while the first is in flight must return nothing.
    expect(box.claimDue(Date.now())).toHaveLength(0);
  });
});
