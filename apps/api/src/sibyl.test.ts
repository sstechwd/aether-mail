import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SibylMemory } from "./sibyl.js";

describe("SibylMemory", () => {
  it("remembers a person and recalls them by name without storing a mail body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-sibyl-"));
    const mem = new SibylMemory(join(dir, "memory.db"));
    await mem.remember("person", "priya", {
      email: "priya@example.com",
      note: "prefers Friday 9:30 Pacific",
    });
    const hits = await mem.recall("priya Friday");
    expect(hits.some((h) => /priya/i.test(h))).toBe(true);
    expect(hits.join("\n")).not.toMatch(/password|app.password/i);
    const block = await mem.promptBlock("Priya wants to reschedule");
    expect(block).toMatch(/priya/i);
  });
});
