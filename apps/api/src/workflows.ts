import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export type WorkflowAction = "star" | "archive" | "keep";

export type MailHint = { subject: string; from: string; body: string };

export type Workflow = {
  id: string;
  spoken: string;
  action: WorkflowAction;
  auto: true;
  terms: string[];
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
  if (/\bstar\b|\bflag\b/i.test(text)) action = "star";
  else if (/\barchive\b|\bfile away\b/i.test(text)) action = "archive";
  else throw new Error("Say what to do: star or archive. Send/delete are not allowed.");

  const terms = extractTerms(text, action);
  if (terms.length === 0) throw new Error("Say what to match (invoices, newsletters, a sender).");

  return {
    id: `wf-${randomBytes(6).toString("hex")}`,
    spoken: text,
    action,
    auto: true,
    terms,
    matches: (mail) => blob(mail).some((t) => terms.some((k) => t.includes(k))),
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
  rules: Array<Pick<Workflow, "action" | "matches">>,
  mail: MailHint & { id: string },
): { id: string; apply: WorkflowAction[] } {
  const apply: WorkflowAction[] = [];
  for (const rule of rules) {
    if (rule.matches(mail) && rule.action !== "keep" && !apply.includes(rule.action)) {
      apply.push(rule.action);
    }
  }
  return { id: mail.id, apply };
}

type Saved = { id: string; spoken: string; action: WorkflowAction; terms: string[] };

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
    this.rows.push({ id: rule.id, spoken: rule.spoken, action: rule.action, terms: rule.terms });
    this.write();
    return rule;
  }

  publicList(): Array<{ id: string; spoken: string; action: WorkflowAction }> {
    return this.rows.map(({ id, spoken, action }) => ({ id, spoken, action }));
  }
}
