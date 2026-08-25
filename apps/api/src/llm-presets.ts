/**
 * Named LLM presets so adding Claude / OpenAI / Grok is a click + a key,
 * the same shape as Hermes adding a provider.
 *
 * The user never has to know a base URL or this month's model id. Getting
 * either wrong fails as an opaque 404 / "bad key".
 *
 * A chat subscription (claude.ai, ChatGPT Plus, SuperGrok) is NOT an API
 * key. Say that in the UI; it is not fixable in the client.
 */

export type LlmPresetId = "ollama" | "claude" | "openai" | "grok";

export type LlmPreset = {
  id: LlmPresetId;
  label: string;
  kind: "local" | "cloud";
  baseUrl: string;
  model: string;
  allowCloud: boolean;
  needsKey: boolean;
  /** Host the user visits to mint a key. Shown next to the paste box. */
  keyHost: string;
  keyUrl: string;
  /** One line: subscription ≠ API key. Empty for local. */
  billingNote: string;
};

export const LLM_PRESETS: readonly LlmPreset[] = [
  {
    id: "ollama",
    label: "Ollama",
    kind: "local",
    baseUrl: "http://127.0.0.1:11434",
    model: "mistral",
    allowCloud: false,
    needsKey: false,
    keyHost: "",
    keyUrl: "",
    billingNote: "",
  },
  {
    id: "claude",
    label: "Claude",
    kind: "cloud",
    baseUrl: "https://api.anthropic.com",
    // Dated snapshot kept as a fallback id in older docs; the alias is
    // what Anthropic documents for the current Sonnet lane.
    model: "claude-sonnet-4-6",
    allowCloud: true,
    needsKey: true,
    keyHost: "console.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    billingNote:
      "A claude.ai subscription will not work. You need an API key from console.anthropic.com — mail use is usually cents a month, not a second $20.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    allowCloud: true,
    needsKey: true,
    keyHost: "platform.openai.com",
    keyUrl: "https://platform.openai.com/api-keys",
    billingNote:
      "ChatGPT Plus will not work. You need an API key from platform.openai.com — a draft or summary is a few thousand tokens, billed in cents.",
  },
  {
    id: "grok",
    label: "Grok",
    kind: "cloud",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.6",
    allowCloud: true,
    needsKey: true,
    keyHost: "console.x.ai",
    keyUrl: "https://console.x.ai/",
    billingNote:
      "SuperGrok will not work. You need an API key from console.x.ai — billed per token, not as a second subscription.",
  },
];

export function publicLlmPresets(): LlmPreset[] {
  return LLM_PRESETS.map((p) => ({ ...p }));
}

export function presetById(id: string): LlmPreset | undefined {
  return LLM_PRESETS.find((p) => p.id === id);
}

/** Which preset matches a stored base URL, if any. */
export function matchPreset(baseUrl: string): LlmPreset | undefined {
  const needle = baseUrl.replace(/\/$/, "");
  return LLM_PRESETS.find((p) => p.baseUrl.replace(/\/$/, "") === needle);
}

export function applyLlmPreset(
  id: string,
  apiKey?: string,
  opts?: { haveStoredKey?: boolean },
): { baseUrl: string; model: string; allowCloud: boolean; apiKey?: string } {
  const preset = presetById(id);
  if (!preset) throw new Error("unknown LLM preset");
  const key = (apiKey ?? "").trim();
  if (preset.needsKey && !key && !opts?.haveStoredKey) {
    throw new Error(`${preset.label} needs an API key from ${preset.keyHost}`);
  }
  return {
    baseUrl: preset.baseUrl,
    model: preset.model,
    allowCloud: preset.allowCloud,
    apiKey: key || undefined,
  };
}
