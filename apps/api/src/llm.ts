import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertLlmAllowed } from "./llm-policy.js";
import { providerFor } from "./llm-anthropic.js";

export type LlmPublic = {
  provider: "ollama" | "openai-compatible" | "anthropic";
  baseUrl: string;
  model: string;
  hasKey: boolean;
  allowCloud: boolean;
};

type LlmFile = Omit<LlmPublic, "hasKey">;

const keys = new Map<string, string>();

const DEFAULTS: LlmFile = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "mistral",
  allowCloud: false,
};

export class LlmSettings {
  /**
   * Set by the settings route once a key has been written to the keyring.
   *
   * The durable copy lives in the OS keyring, which this class cannot read
   * (that needs aether-cli). This flag exists so the UI can say "key set"
   * without the settings screen having to shell out on every render.
   */
  keyKnown = false;

  constructor(private filePath: string) {}

  private read(): LlmFile {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<LlmFile>;
      return {
        // Derive from the URL, not the stored label: a file written by an
        // older build has provider "openai-compatible" for an Anthropic URL,
        // and honouring that would send the wrong protocol forever.
        provider: providerFor(raw.baseUrl || DEFAULTS.baseUrl),
        baseUrl: raw.baseUrl || DEFAULTS.baseUrl,
        model: raw.model || DEFAULTS.model,
        allowCloud: Boolean(raw.allowCloud),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { ...DEFAULTS };
      throw err;
    }
  }

  publicView(): LlmPublic {
    const cfg = this.read();
    // hasKey is advisory: the durable copy is in the OS keyring, and the
    // route sets this flag when it stores one.
    return { ...cfg, hasKey: keys.has("llm") || this.keyKnown };
  }

  save(input: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    allowCloud?: boolean;
  }): LlmPublic {
    const current = this.read();
    const baseUrl = (input.baseUrl ?? current.baseUrl).trim() || DEFAULTS.baseUrl;
    const next: LlmFile = {
      /*
       * Derive the wire format from the URL rather than trusting the caller.
       *
       * The UI used to sniff for port 11434 and label everything else
       * "openai-compatible", which sent OpenAI-shaped requests to Claude. That
       * fails as an opaque error the user reads as "my key is wrong".
       */
      provider: providerFor(baseUrl),
      baseUrl,
      model: (input.model ?? current.model).trim() || DEFAULTS.model,
      allowCloud: input.allowCloud ?? current.allowCloud,
    };
    if (new URL(next.baseUrl).protocol !== "http:" && new URL(next.baseUrl).protocol !== "https:") {
      throw new Error("LLM base URL must be http(s)");
    }
    assertLlmAllowed(next);
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf8");
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      if (key) keys.set("llm", key);
      else keys.delete("llm");
    }
    return this.publicView();
  }

  resolve(): {
    baseUrl: string;
    model: string;
    apiKey?: string;
    provider: LlmFile["provider"];
    allowCloud: boolean;
  } {
    const cfg = this.read();
    assertLlmAllowed(cfg);
    return { ...cfg, apiKey: keys.get("llm") };
  }
}
