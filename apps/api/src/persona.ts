import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Persona = { samples: string[]; updatedAt: string };

const MAX_SAMPLES = 8;
const MAX_CHARS = 1200;

export class PersonaBook {
  constructor(private filePath: string) {}

  read(): Persona {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Persona;
      return { samples: raw.samples ?? [], updatedAt: raw.updatedAt ?? "" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { samples: [], updatedAt: "" };
      throw err;
    }
  }

  add(sample: string): Persona {
    const text = sample.trim().slice(0, MAX_CHARS);
    if (text.length < 20) throw new Error("Need a longer sample of how you write (20+ characters).");
    const cur = this.read();
    const samples = [...cur.samples, text].slice(-MAX_SAMPLES);
    const next = { samples, updatedAt: new Date().toISOString() };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  promptBlock(): string {
    const { samples } = this.read();
    if (!samples.length) return "";
    return `Write like the user. Samples of their sent mail:\n${samples.map((s, i) => `(${i + 1}) ${s}`).join("\n")}`;
  }
}
