import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type LlmPublic = {
  provider: "ollama" | "openai-compatible";
  baseUrl: string;
  model: string;
  hasKey: boolean;
};

type LlmFile = Omit<LlmPublic, "hasKey">;

const keys = new Map<string, string>();

const DEFAULTS: LlmFile = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "mistral",
};

export class LlmSettings {
  constructor(private filePath: string) {}

  private read(): LlmFile {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<LlmFile>;
      return {
        provider: raw.provider === "openai-compatible" ? "openai-compatible" : "ollama",
        baseUrl: raw.baseUrl || DEFAULTS.baseUrl,
        model: raw.model || DEFAULTS.model,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { ...DEFAULTS };
      throw err;
    }
  }

  publicView(): LlmPublic {
    const cfg = this.read();
    return { ...cfg, hasKey: keys.has("llm") };
  }

  save(input: { provider?: string; baseUrl?: string; model?: string; apiKey?: string }): LlmPublic {
    const current = this.read();
    const next: LlmFile = {
      provider: input.provider === "openai-compatible" ? "openai-compatible" : "ollama",
      baseUrl: (input.baseUrl ?? current.baseUrl).trim() || DEFAULTS.baseUrl,
      model: (input.model ?? current.model).trim() || DEFAULTS.model,
    };
    if (new URL(next.baseUrl).protocol !== "http:" && new URL(next.baseUrl).protocol !== "https:") {
      throw new Error("LLM base URL must be http(s)");
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf8");
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      if (key) keys.set("llm", key);
      else keys.delete("llm");
    }
    return this.publicView();
  }

  resolve(): { baseUrl: string; model: string; apiKey?: string; provider: LlmFile["provider"] } {
    const cfg = this.read();
    return { ...cfg, apiKey: keys.get("llm") };
  }
}
