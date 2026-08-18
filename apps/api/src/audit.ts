import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type AuditEvent = {
  at: string;
  actor: "user" | "agent" | "workflow";
  action: string;
  detail: string;
};

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export class AuditLog {
  constructor(private filePath: string) {}

  append(event: Omit<AuditEvent, "at">): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const row: AuditEvent = { at: new Date().toISOString(), ...event };
    appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, "utf8");
  }

  list(): AuditEvent[] {
    if (!existsSync(this.filePath)) return [];
    const cutoff = Date.now() - RETAIN_MS;
    const rows: AuditEvent[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as AuditEvent;
        if (Date.parse(ev.at) >= cutoff) rows.push(ev);
      } catch {
        /* skip bad line */
      }
    }
    return rows.slice(-200);
  }

  prune(): void {
    const keep = this.list();
    writeFileSync(this.filePath, keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""), "utf8");
  }
}
