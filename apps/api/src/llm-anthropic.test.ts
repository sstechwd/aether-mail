import { describe, expect, it } from "vitest";
import { buildAnthropicRequest, parseAnthropicReply, providerFor } from "./llm-anthropic.js";

/**
 * Anthropic support.
 *
 * Claude is not OpenAI-compatible: different endpoint, a bespoke auth header,
 * a required version header, and the system prompt is a TOP-LEVEL FIELD rather
 * than a message with role "system". Sending it as a message is accepted and
 * silently ignored, which is the worst kind of wrong — it looks like it works.
 */

describe("buildAnthropicRequest", () => {
  const base = {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-ant-test",
    prompt: "Summarise this message.",
  };

  it("posts to the messages endpoint", () => {
    expect(buildAnthropicRequest(base).url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("does not double up the version segment", () => {
    const r = buildAnthropicRequest({ ...base, baseUrl: "https://api.anthropic.com/v1" });
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("uses x-api-key, NOT a bearer token", () => {
    const r = buildAnthropicRequest(base);
    expect(r.headers["x-api-key"]).toBe("sk-ant-test");
    expect(r.headers.Authorization).toBeUndefined();
  });

  it("sends the required anthropic-version header", () => {
    // Without it the API rejects the call outright.
    expect(buildAnthropicRequest(base).headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("puts the system prompt at the top level, not in messages", () => {
    const r = buildAnthropicRequest(base);
    expect(typeof r.body.system).toBe("string");
    // The message array carries only the user turn; the type system already
    // forbids a "system" role, so the risk is the prompt going missing.
    expect(r.body.messages).toHaveLength(1);
    expect(r.body.system.length).toBeGreaterThan(0);
  });

  it("tells the model it cannot send mail", () => {
    expect(buildAnthropicRequest(base).body.system.toLowerCase()).toContain("not send");
  });

  it("caps max_tokens so a runaway reply cannot bill the user", () => {
    const r = buildAnthropicRequest(base);
    expect(r.body.max_tokens).toBeGreaterThan(0);
    expect(r.body.max_tokens).toBeLessThanOrEqual(1024);
  });
});

describe("parseAnthropicReply", () => {
  it("reads text out of the content array", () => {
    const reply = JSON.stringify({ content: [{ type: "text", text: "Hello." }] });
    expect(parseAnthropicReply(reply)).toBe("Hello.");
  });

  it("joins several text blocks", () => {
    const reply = JSON.stringify({
      content: [
        { type: "text", text: "One." },
        { type: "text", text: "Two." },
      ],
    });
    expect(parseAnthropicReply(reply)).toBe("One.\nTwo.");
  });

  it("ignores non-text blocks rather than rendering them", () => {
    const reply = JSON.stringify({
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Answer." },
      ],
    });
    expect(parseAnthropicReply(reply)).toBe("Answer.");
  });

  it("surfaces an API error instead of returning empty text", () => {
    // A silent empty string looks like the model had nothing to say; the user
    // needs to know their key is wrong.
    const reply = JSON.stringify({ error: { message: "invalid x-api-key" } });
    expect(() => parseAnthropicReply(reply)).toThrow(/invalid x-api-key/);
  });

  it("throws on malformed JSON rather than returning it raw", () => {
    expect(() => parseAnthropicReply("not json")).toThrow();
  });

  it("returns empty string for an empty content array", () => {
    expect(parseAnthropicReply(JSON.stringify({ content: [] }))).toBe("");
  });
});

describe("providerFor", () => {
  it.each([
    ["https://api.anthropic.com", "anthropic"],
    ["https://api.anthropic.com/v1", "anthropic"],
    ["https://api.openai.com/v1", "openai-compatible"],
    ["http://127.0.0.1:11434", "ollama"],
    ["http://localhost:11434/", "ollama"],
  ])("detects %s as %s", (url, want) => {
    expect(providerFor(url)).toBe(want);
  });

  it("treats an unknown cloud host as OpenAI-compatible", () => {
    // Most third-party gateways implement that shape; it is the safe default.
    expect(providerFor("https://openrouter.ai/api/v1")).toBe("openai-compatible");
  });
});
