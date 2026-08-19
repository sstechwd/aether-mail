import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { appRoot } from "./approot.js";

export type MemoryHit = { kind: string; name: string; body: unknown };

const FORBIDDEN = /password|secret|app.password|credential/i;

export class SibylMemory {
  constructor(private dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  async remember(kind: string, name: string, body: Record<string, unknown>): Promise<void> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (FORBIDDEN.test(k)) continue;
      const text = typeof v === "string" ? v.slice(0, 800) : v;
      if (typeof text === "string" && FORBIDDEN.test(text)) continue;
      clean[k] = text;
    }
    await this.run("remember", ["--kind", kind, "--name", name, "--body", JSON.stringify(clean)]);
  }

  async recall(query: string): Promise<string[]> {
    const terms = keywords(query);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const term of terms.slice(0, 4)) {
      const data = await this.run("recall", ["--query", term]);
      const hits = (data.hits as MemoryHit[] | undefined) ?? [];
      for (const h of hits) {
        const line = `${h.kind}/${h.name}: ${stringifyBody(h.body)}`;
        if (!line || seen.has(line)) continue;
        seen.add(line);
        lines.push(line);
      }
    }
    return lines;
  }

  async promptBlock(query: string): Promise<string> {
    const lines = await this.recall(query);
    if (!lines.length) return "";
    return `Sibyl memory (local, not uploaded):\n${lines.slice(0, 6).join("\n")}`.slice(0, 900);
  }

  async journal(acted: string): Promise<void> {
    await this.run("event", ["--acted", acted.slice(0, 400)]);
  }

  async list(): Promise<MemoryHit[]> {
    const data = await this.run("list", []);
    return (data.hits as MemoryHit[] | undefined) ?? [];
  }

  private run(action: string, extra: string[]): Promise<Record<string, unknown>> {
    const script = findScript();
    if (!script) return Promise.reject(new Error("sibyl_aether.py missing"));
    return new Promise((resolve, reject) => {
      const child = spawn("python", [script, "--db", this.dbPath, action, ...extra], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => {
        stdout += String(c);
      });
      child.stderr.on("data", (c) => {
        stderr += String(c);
      });
      child.on("error", (e) => reject(e));
      child.on("close", (code) => {
        try {
          const parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
          if (parsed.ok === false) reject(new Error(String(parsed.error ?? "sibyl failed")));
          else resolve(parsed);
        } catch {
          reject(new Error((stderr || stdout || `sibyl exit ${code}`).slice(0, 240)));
        }
      });
    });
  }
}

function keywords(query: string): string[] {
  const stop = new Set(["the", "and", "for", "that", "this", "with", "from", "want", "wants", "to"]);
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9@.+-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !stop.has(w));
  return words.length ? words : [query.trim()].filter(Boolean);
}

function stringifyBody(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body.slice(0, 240);
  try {
    return JSON.stringify(body).slice(0, 240);
  } catch {
    return "";
  }
}

function findScript(): string | null {
  // appRoot() is already the repo/install root — do not walk up from it.
  const candidate = path.join(appRoot(), "scripts", "sibyl_aether.py");
  return existsSync(candidate) ? candidate : null;
}
