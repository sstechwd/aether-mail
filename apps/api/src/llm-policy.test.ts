import { describe, expect, it } from "vitest";
import { assertLlmAllowed, buildOpenAiRequest, isLoopbackLlm } from "./llm-policy.js";

describe("llm policy", () => {
  it("treats localhost Ollama as local", () => {
    expect(isLoopbackLlm("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackLlm("https://api.openai.com/v1")).toBe(false);
  });

  it("refuses a cloud endpoint without allowCloud", () => {
    expect(() =>
      assertLlmAllowed({
        baseUrl: "https://api.openai.com/v1",
        allowCloud: false,
      }),
    ).toThrow(/allowCloud/);
  });

  it("builds a chat-completions request without putting the key in the body", () => {
    const req = buildOpenAiRequest({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-test-not-real",
      prompt: "Summarize this",
    });
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer sk-test-not-real");
    expect(JSON.stringify(req.body)).not.toContain("sk-test");
    expect(req.body.max_tokens).toBe(256);
  });

  it("asks Grok for medium reasoning so mail chat is not the ultra-slow default", () => {
    const req = buildOpenAiRequest({
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.6",
      apiKey: "xai-test-not-real",
      prompt: "Summarize this",
    });
    expect(req.body.reasoning_effort).toBe("medium");
    expect(req.body.max_tokens).toBeGreaterThan(80);
  });

  it("does not send reasoning_effort to OpenAI", () => {
    const req = buildOpenAiRequest({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-test-not-real",
      prompt: "Summarize this",
    });
    expect(req.body.reasoning_effort).toBeUndefined();
  });
});
