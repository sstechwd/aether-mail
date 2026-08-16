import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LlmSettings } from "./llm.js";

describe("LlmSettings", () => {
  it("defaults to local ollama and never writes the api key", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-llm-")), "llm.json");
    const llm = new LlmSettings(file);
    const saved = llm.save({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "mistral",
      apiKey: "sk-test-not-real",
    });
    expect(saved.hasKey).toBe(true);
    expect(saved.provider).toBe("openai-compatible");
    const raw = JSON.stringify(llm.publicView());
    expect(raw).not.toContain("sk-test");
    const disk = require("node:fs").readFileSync(file, "utf8") as string;
    expect(disk).not.toContain("sk-test");
  });
});
