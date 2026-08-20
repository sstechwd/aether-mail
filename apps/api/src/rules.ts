/**
 * Filing rules.
 *
 * Spoken workflows already exist, but those are agent-compiled and the model
 * decides what they mean. A mail client also needs the boring deterministic
 * kind: a visible list of "from X → move to Y" that the user can read, edit
 * and reason about with no model involved. Set once, runs forever.
 *
 * SECURITY: a rule may file, flag or mark read. It may NEVER reply or forward.
 * A rule that fires on incoming mail and sends something is an auto-responder,
 * and an auto-responder driven by attacker-controlled input is a mail loop or
 * an exfiltration channel. The action type has no send variant, so this is
 * structural rather than a convention — the same guarantee the agent has.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Which header the rule looks at. */
export type RuleField = "from" | "to" | "subject";

/** What the rule does. Note there is no "reply" or "forward". */
export type RuleAction = "move" | "star" | "read";

export type Rule = {
  id: string;
  field: RuleField;
  /** Plain substring match — not a regex, so a rule cannot hang the sync. */
  contains: string;
  action: RuleAction;
  /** Destination folder, required when action is "move". */
  folder?: string;
  enabled: boolean;
};

export type RuleInput = Omit<Rule, "id">;

/** The subset of a message a rule can see. */
export type RuleTarget = { from: string; to: string; subject: string; folder: string };

/**
 * Does this rule fire for this message?
 *
 * An empty pattern matches nothing. The opposite — treating "" as "matches
 * everything" — turns a half-typed rule into one that files the entire inbox.
 */
export function matchesRule(rule: Rule, msg: RuleTarget): boolean {
  if (!rule.enabled) return false;
  const needle = (rule.contains ?? "").trim().toLowerCase();
  if (!needle) return false;
  const hay = (msg[rule.field] ?? "").toLowerCase();
  return hay.includes(needle);
}

export class RuleBook {
  private rules: Rule[] = [];
  private filePath: string | null = null;

  static openFile(filePath: string): RuleBook {
    const book = new RuleBook();
    book.filePath = filePath;
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (Array.isArray(rows)) {
        book.rules = rows.filter(
          (r): r is Rule =>
            !!r && typeof r === "object" && typeof (r as Rule).id === "string",
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return book;
  }

  list(): Rule[] {
    return [...this.rules];
  }

  add(input: RuleInput): Rule {
    if (!(input.contains ?? "").trim()) {
      throw new Error("A rule needs something to match on.");
    }
    if (input.action === "move" && !(input.folder ?? "").trim()) {
      throw new Error("A move rule needs a destination folder.");
    }
    const rule: Rule = {
      ...input,
      contains: input.contains.trim(),
      id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };
    this.rules.push(rule);
    this.save();
    return rule;
  }

  remove(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length === before) return false;
    this.save();
    return true;
  }

  setEnabled(id: string, enabled: boolean): void {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return;
    rule.enabled = enabled;
    this.save();
  }

  /**
   * The first rule that fires, or null.
   *
   * First-match-wins rather than applying every rule: predictable order is
   * worth more than expressiveness here, and a user can read the list top to
   * bottom and know what happens.
   */
  apply(msg: RuleTarget): Rule | null {
    return this.rules.find((r) => matchesRule(r, msg)) ?? null;
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.rules), "utf8");
  }
}
