export function isLoopbackLlm(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function assertLlmAllowed(cfg: { baseUrl: string; allowCloud?: boolean }): void {
  if (!isLoopbackLlm(cfg.baseUrl) && !cfg.allowCloud) {
    throw new Error("Cloud models require allowCloud in Settings. Mail stays local until you opt in.");
  }
}

export type OpenAiChatRequest = {
  url: string;
  headers: { Authorization: string; "Content-Type": string };
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens: number;
    reasoning_effort?: "low" | "medium" | "high";
  };
};

export function buildOpenAiRequest(opts: {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  reasoningEffort?: "low" | "medium" | "high";
  maxTokens?: number;
}): OpenAiChatRequest {
  const root = opts.baseUrl.replace(/\/$/, "");
  const url = root.endsWith("/v1") ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
  let host = "";
  try {
    host = new URL(opts.baseUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const xai = host === "api.x.ai" || host.endsWith(".x.ai");
  const body: OpenAiChatRequest["body"] = {
    model: opts.model,
    messages: [
      { role: "system", content: "You are Aether, a local mail assistant. Do not send mail." },
      { role: "user", content: opts.prompt },
    ],
    max_tokens: opts.maxTokens ?? 256,
  };
  /*
   * grok-4.6 defaults to high reasoning if we say nothing. That is the
   * "ultra" wait. Mail wants a sonnet-like medium reply.
   */
  if (xai) body.reasoning_effort = opts.reasoningEffort ?? "medium";
  return {
    url,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  };
}
