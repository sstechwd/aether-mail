import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export type WorkflowAction = "star" | "archive" | "keep" | "file";

export type MailHint = { subject: string; from: string; body: string };

export type Workflow = {
  id: string;
  spoken: string;
  action: WorkflowAction;
  auto: true;
  terms: string[];
  folder?: string;
  matches: (mail: MailHint) => boolean;
};

const FORBIDDEN = /\b(send|delete|forward|trash|remove the originals)\b/i;

const STAR_TERMS = ["invoice", "invoices", "bill", "bills", "receipt", "payment due"];
const ARCHIVE_TERMS = ["newsletter", "newsletters", "digest", "digests", "unsubscribe", "weekly"];

export function compileWorkflows(spoken: string): Workflow[] {
  const text = spoken.trim();
  if (!text) throw new Error("need a workflow in plain English");
  if (FORBIDDEN.test(text)) {
    throw new Error("Workflows never send, delete, or forward. Say star or archive instead.");
  }
  if (/\bstar\b|\bflag\b/i.test(text) && /\barchive\b|\bfile away\b/i.test(text)) {
    return text
      .split(/\band\b/i)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => compileWorkflow(part));
  }
  return [compileWorkflow(text)];
}

export function compileWorkflow(spoken: string): Workflow {
  const text = spoken.trim();
  if (!text) throw new Error("need a workflow in plain English");
  if (FORBIDDEN.test(text)) {
    throw new Error("Workflows never send, delete, or forward. Say star or archive instead.");
  }
  let action: WorkflowAction = "keep";
  let folder: string | undefined;
  const named = text.match(/folder named\s+([A-Za-z0-9._-]+)/i);
  const fromAddr = text.match(/from\s+([^\s]+@[^\s,]+)/i);
  if (named && /\b(move|create|file)\b/i.test(text)) {
    action = "file";
    folder = named[1];
  } else if (/\bmove\b.+\bto\s+(spam|junk)\b/i.test(text)) {
    action = "file";
    folder = "Spam";
  } else if (/\bstar\b|\bflag\b/i.test(text)) action = "star";
  else if (/\barchive\b|\bfile away\b/i.test(text)) action = "archive";
  else throw new Error("Say what to do: star, archive, or create a folder and move mail from an address.");

  const terms =
    action === "file" && fromAddr
      ? [fromAddr[1].toLowerCase()]
      : action === "file"
        ? extractTerms(text.replace(/\b(move|to|spam|junk|folder|named|create|them|there)\b/gi, " "), "archive")
        : extractTerms(text, action);
  if (terms.length === 0) throw new Error("Say what to match (invoices, newsletters, a sender).");

  return {
    id: `wf-${randomBytes(6).toString("hex")}`,
    spoken: text,
    action,
    auto: true,
    terms,
    folder,
    matches: (mail) => {
      const hay = blob(mail)[0];
      if (action === "file" && fromAddr) return hay.includes(fromAddr[1].toLowerCase());
      return terms.some((k) => hay.includes(k));
    },
  };
}

function extractTerms(text: string, action: WorkflowAction): string[] {
  const lower = text.toLowerCase();
  const fromKnown = (action === "star" ? STAR_TERMS : ARCHIVE_TERMS).filter((t) => lower.includes(t));
  if (fromKnown.length) return fromKnown;
  const leftover = lower
    .replace(/\b(star|flag|archive|file away|emails?|mail|and|the|a|an|about|from|when|arrives?)\b/g, " ")
    .split(/[^a-z0-9@.+-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  return leftover.slice(0, 6);
}

function blob(mail: MailHint): string[] {
  return [`${mail.subject} ${mail.from} ${mail.body}`.toLowerCase()];
}

export function applyWorkflows(
  rules: Array<Pick<Workflow, "action" | "matches" | "folder">>,
  mail: MailHint & { id: string },
): { id: string; apply: WorkflowAction[]; fileTo?: string } {
  const apply: WorkflowAction[] = [];
  let fileTo: string | undefined;
  for (const rule of rules) {
    if (rule.matches(mail) && rule.action !== "keep" && !apply.includes(rule.action)) {
      apply.push(rule.action);
      if (rule.action === "file" && rule.folder) fileTo = rule.folder;
    }
  }
  return { id: mail.id, apply, fileTo };
}

type Saved = { id: string; spoken: string; action: WorkflowAction; terms: string[]; folder?: string };

export class WorkflowBook {
  constructor(private filePath?: string) {}

  private rows: Saved[] = this.filePath ? this.read() : [];

  private read(): Saved[] {
    if (!this.filePath) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as Saved[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private write(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.rows, null, 2), "utf8");
  }

  list(): Workflow[] {
    return this.rows.map((row) => ({
      ...row,
      auto: true as const,
      matches: (mail: MailHint) => blob(mail).some((t) => row.terms.some((k) => t.includes(k))),
    }));
  }

  add(rule: Workflow): Workflow {
    this.rows.push({
      id: rule.id,
      spoken: rule.spoken,
      action: rule.action,
      terms: rule.terms,
      folder: rule.folder,
    });
    this.write();
    return rule;
  }

  publicList(): Array<{ id: string; spoken: string; action: WorkflowAction }> {
    return this.rows.map(({ id, spoken, action }) => ({ id, spoken, action }));
  }

  remove(id: string): boolean {
    const next = this.rows.filter((r) => r.id !== id);
    if (next.length === this.rows.length) return false;
    this.rows = next;
    this.write();
    return true;
  }
}
