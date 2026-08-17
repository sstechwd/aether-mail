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
  body: { model: string; messages: Array<{ role: string; content: string }>; max_tokens: number };
};

export function buildOpenAiRequest(opts: {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
}): OpenAiChatRequest {
  const root = opts.baseUrl.replace(/\/$/, "");
  const url = root.endsWith("/v1") ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
  return {
    url,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model: opts.model,
      messages: [
        { role: "system", content: "You are Aether, a local mail assistant. Do not send mail." },
        { role: "user", content: opts.prompt },
      ],
      max_tokens: 256,
    },
  };
}
