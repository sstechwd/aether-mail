import { describe, expect, it } from "vitest";
import { LLM_PRESETS, applyLlmPreset, publicLlmPresets } from "./llm-presets.js";

/**
 * Hermes-style add: pick Claude / OpenAI / Grok / local, paste a key, done.
 *
 * The user should never have to know a base URL, a model id, or that
 * Anthropic is not OpenAI-compatible. A missing key on a cloud preset
 * must fail before we write a half-configured llm.json.
 */

describe("LLM presets", () => {
  it("ships Claude, OpenAI, Grok and local Ollama", () => {
    expect(LLM_PRESETS.map((p) => p.id).sort()).toEqual(["claude", "grok", "ollama", "openai"]);
  });

  it("does not expose anything that looks like a secret", () => {
    const raw = JSON.stringify(publicLlmPresets());
    expect(raw).not.toMatch(/sk-|xai-|sk-ant/i);
  });

  it("applies Claude without the user typing a URL", () => {
    const next = applyLlmPreset("claude", "sk-ant-test-not-real");
    expect(next.baseUrl).toBe("https://api.anthropic.com");
    expect(next.model).toMatch(/^claude-/);
    expect(next.allowCloud).toBe(true);
    expect(next.apiKey).toBe("sk-ant-test-not-real");
  });

  it("applies OpenAI and Grok as OpenAI-compatible cloud endpoints", () => {
    const openai = applyLlmPreset("openai", "sk-test-not-real");
    expect(openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(openai.allowCloud).toBe(true);

    const grok = applyLlmPreset("grok", "xai-test-not-real");
    expect(grok.baseUrl).toBe("https://api.x.ai/v1");
    expect(grok.model).toMatch(/^grok-/);
    expect(grok.allowCloud).toBe(true);
  });

  it("applies local Ollama with no key and no cloud flag", () => {
    const next = applyLlmPreset("ollama");
    expect(next.baseUrl).toBe("http://127.0.0.1:11434");
    expect(next.allowCloud).toBe(false);
    expect(next.apiKey).toBeUndefined();
  });

  it("refuses a cloud preset with no API key", () => {
    expect(() => applyLlmPreset("claude")).toThrow(/API key/i);
    expect(() => applyLlmPreset("openai", "   ")).toThrow(/API key/i);
    expect(() => applyLlmPreset("grok", "")).toThrow(/API key/i);
  });

  it("lets the user re-select a cloud preset when that key is already stored", () => {
    const next = applyLlmPreset("claude", undefined, { haveStoredKey: true });
    expect(next.baseUrl).toBe("https://api.anthropic.com");
    expect(next.apiKey).toBeUndefined();
  });

  it("refuses an unknown preset", () => {
    expect(() => applyLlmPreset("chatgpt-plus")).toThrow(/unknown/i);
  });
});
