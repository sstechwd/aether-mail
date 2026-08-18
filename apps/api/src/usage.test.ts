import { describe, expect, it } from "vitest";
import { estimateTokens, recordUsage, usageSnapshot } from "./usage.js";

describe("usage", () => {
  it("estimates tokens as ~4 chars and records a completion cap", () => {
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
    const snap = recordUsage({ promptChars: 400, completion: 32, cap: 80 });
    expect(snap.promptTokens).toBe(100);
    expect(snap.lastCompletion).toBe(32);
    expect(snap.cap).toBe(80);
    expect(usageSnapshot().lastCompletion).toBe(32);
  });
});
