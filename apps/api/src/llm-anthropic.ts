/**
 * Anthropic (Claude) support.
 *
 * Claude is NOT OpenAI-compatible, and the differences are the kind that fail
 * quietly rather than loudly:
 *
 *  - auth is `x-api-key`, not `Authorization: Bearer`
 *  - `anthropic-version` is required; without it the call is rejected
 *  - the system prompt is a TOP-LEVEL field. Passing it as a message with
 *    role "system" is accepted and ignored, so the model silently loses its
 *    instructions — including "you cannot send mail"
 *  - the reply is a content ARRAY of typed blocks, not `choices[0].message`
 *
 * Kept as pure functions so every one of those is testable without a key.
 */

export type AnthropicRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
};

/**
 * What the model is told it is.
 *
 * The agent cannot send mail no matter what it replies — that is enforced by
 * the proposal allow-list, not by this string. Saying it anyway keeps a cloud
 * model from confidently offering to do something the app will refuse.
 */
const SYSTEM =
  "You are Aether, a local-first mail assistant. You can read the message shown to you and " +
  "suggest actions, but you can not send, forward, or delete mail — a human does that. " +
  "Be brief and concrete.";

/** A reply long enough to be useful, short enough not to surprise a bill. */
const MAX_TOKENS = 1024;

export function buildAnthropicRequest(opts: {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
}): AnthropicRequest {
  const root = opts.baseUrl.replace(/\/$/, "");
  const url = root.endsWith("/v1") ? `${root}/messages` : `${root}/v1/messages`;

  return {
    url,
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: {
      model: opts.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: "user", content: opts.prompt }],
    },
  };
}

/**
 * Pull the text out of a Claude response.
 *
 * Throws on an API error rather than returning "": an empty string reads as
 * "the model had nothing to say", when the real cause is usually a bad key.
 */
export function parseAnthropicReply(raw: string): string {
  const parsed = JSON.parse(raw) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };

  if (parsed.error) {
    throw new Error(parsed.error.message ?? "Anthropic returned an error");
  }

  return (parsed.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

/**
 * Which wire format a base URL speaks.
 *
 * Detected rather than asked: a user pasting an Anthropic URL into a provider
 * dropdown set to "OpenAI" gets a confusing 404, and they have no reason to
 * know the formats differ.
 */
export function providerFor(baseUrl: string): "ollama" | "anthropic" | "openai-compatible" {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "openai-compatible";
  }

  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return "ollama";
  if (host.endsWith("anthropic.com")) return "anthropic";
  return "openai-compatible";
}
