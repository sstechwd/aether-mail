import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export type MailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  source: "local";
};

export class TemplateBook {
  constructor(private filePath: string) {}

  list(): MailTemplate[] {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as MailTemplate[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  add(input: { name: string; subject: string; body: string }): MailTemplate {
    const name = input.name.trim();
    if (!name) throw new Error("need a template name");
    const row: MailTemplate = {
      id: `tpl-${randomBytes(4).toString("hex")}`,
      name,
      subject: input.subject.trim(),
      body: input.body.slice(0, 4000),
      source: "local",
    };
    const rows = this.list();
    rows.push(row);
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(rows, null, 2), "utf8");
    return row;
  }

  remove(id: string): boolean {
    const rows = this.list();
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return false;
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf8");
    return true;
  }
}
