import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImagePolicy } from "./imagepolicy.js";

function fresh(): ImagePolicy {
  return ImagePolicy.openFile(join(mkdtempSync(join(tmpdir(), "aether-img-")), "images.json"));
}

/**
 * Reported: "images are still not loading correctly."
 *
 * The cause was not rendering — it was that blocking had no memory. Remote
 * images were blocked per message with a Load button, and the choice was
 * forgotten the moment you opened anything else. The live mailbox has 118
 * messages with remote images, so the honest description of the old behaviour
 * is "click Load images 118 times".
 *
 * Privacy still matters, so the default stays "ask". What changes is that a
 * decision can be remembered — globally, or for a sender you trust.
 */

describe("ImagePolicy", () => {
  let policy: ImagePolicy;
  beforeEach(() => {
    policy = fresh();
  });

  it("blocks by default — trackers stay dark until asked otherwise", () => {
    expect(policy.mode()).toBe("ask");
    expect(policy.allows("anyone@example.com")).toBe(false);
  });

  it("can be switched to always load", () => {
    policy.setMode("always");
    expect(policy.allows("anyone@example.com")).toBe(true);
  });

  it("can trust one sender without trusting everyone", () => {
    policy.trust("priya@example.com");
    expect(policy.allows("priya@example.com")).toBe(true);
    expect(policy.allows("tracker@spam.example")).toBe(false);
  });

  it("matches the sender case-insensitively and ignores display names", () => {
    policy.trust("priya@example.com");
    expect(policy.allows("Priya Raman <PRIYA@example.com>")).toBe(true);
  });

  it("can untrust a sender", () => {
    policy.trust("priya@example.com");
    policy.untrust("priya@example.com");
    expect(policy.allows("priya@example.com")).toBe(false);
  });

  it("persists across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-img-")), "images.json");
    const first = ImagePolicy.openFile(file);
    first.setMode("ask");
    first.trust("priya@example.com");
    const second = ImagePolicy.openFile(file);
    expect(second.allows("priya@example.com")).toBe(true);
  });

  it("never allows when the mode is explicitly never, even for a trusted sender", () => {
    policy.trust("priya@example.com");
    policy.setMode("never");
    expect(policy.allows("priya@example.com")).toBe(false);
  });

  it("survives a malformed sender rather than throwing", () => {
    expect(() => policy.allows("")).not.toThrow();
    expect(policy.allows("")).toBe(false);
    expect(policy.allows("not-an-address")).toBe(false);
  });

  it("lists trusted senders so the user can see and undo what they allowed", () => {
    policy.trust("a@example.com");
    policy.trust("b@example.com");
    expect(policy.trusted()).toHaveLength(2);
  });

  it("does not add the same sender twice", () => {
    policy.trust("a@example.com");
    policy.trust("A@EXAMPLE.COM");
    expect(policy.trusted()).toHaveLength(1);
  });
});
