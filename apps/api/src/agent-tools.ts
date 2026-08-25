/**
 * Agent tool-use: propose, show, approve, execute.
 *
 * The agent used to be a text generator — read a message, call a model, return
 * prose. Useful for a summary, useless for "stop this newsletter reaching my
 * inbox", because the user still had to go and build the rule by hand.
 *
 * The obvious fix — hand the model a function that writes to the store — is
 * the wrong one. It would make every mailbox a prompt-injection target: mail
 * is attacker-controlled input, and a model that can act on it can be told to
 * act by whoever wrote the message.
 *
 * So the model does not act. It returns a STRUCTURED PROPOSAL, we validate it
 * against a closed allow-list, the user reads a plain-language description of
 * exactly what it would do, and one human click executes it. The model writes
 * a suggestion; a person commits it.
 *
 * This keeps "the agent cannot send or delete" structurally true — there is no
 * send action in the schema, so a model asking to send is rejected by the
 * parser, not by a policy someone can relax later.
 */

/** Told to the model. Deliberately short: it is also the security boundary. */
export const PROPOSAL_SCHEMA = `Reply with ONE JSON object and nothing else.

To file mail automatically:
{"action":"create_rule","field":"from"|"to"|"subject","contains":"<text>","then":"move"|"star"|"read","folder":"<name, only when then=move>","why":"<one short sentence>"}

To save a reusable reply:
{"action":"create_template","name":"<short name>","body":"<the reply text>","why":"<one short sentence>"}

To silence a noisy thread (its replies arrive read and archived, never deleted):
{"action":"mute_thread","subject":"<the thread subject>","why":"<one short sentence>"}

To make this message come back later:
{"action":"snooze","preset":"later"|"tomorrow"|"weekend"|"next-week","why":"<one short sentence>"}

No other actions exist. Do not explain outside the JSON.`;

export type RuleProposal = {
  field: "from" | "to" | "subject";
  contains: string;
  then: "move" | "star" | "read";
  folder?: string;
};

export type TemplateProposal = { name: string; body: string };

export type MuteProposal = { subject: string };

/** Only the presets the snooze engine implements. No free-form dates. */
export type SnoozeProposal = { preset: "later" | "tomorrow" | "weekend" | "next-week" };

export type Proposal = {
  action: "create_rule" | "create_template" | "mute_thread" | "snooze";
  rule?: RuleProposal;
  template?: TemplateProposal;
  mute?: MuteProposal;
  snooze?: SnoozeProposal;
  /** The model's stated reason, shown to the user so they can judge it. */
  why?: string;
};

const FIELDS = ["from", "to", "subject"] as const;
const VERBS = ["move", "star", "read"] as const;
const PRESETS = ["later", "tomorrow", "weekend", "next-week"] as const;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Find the JSON object in whatever the model returned.
 *
 * Small local models pad JSON with commentary however firmly you ask them not
 * to, and refusing those replies would make the feature feel broken on exactly
 * the setup we recommend (Ollama, on your own machine).
 */
function extractJson(raw: string): unknown {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Parse and validate a proposal. Returns null for anything not on the
 * allow-list — including any attempt to send, delete, or run a command.
 */
export function parseProposal(raw: string): Proposal | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const action = clean(obj.action, 40);
  const why = clean(obj.why, 240);

  if (action === "create_rule") {
    const field = clean(obj.field, 20) as RuleProposal["field"];
    const then = clean(obj.then, 20) as RuleProposal["then"];
    const contains = clean(obj.contains, 300);
    const folder = clean(obj.folder, 100);

    if (!FIELDS.includes(field)) return null;
    if (!VERBS.includes(then)) return null;
    // An empty pattern would match every message in the mailbox.
    if (!contains) return null;
    if (then === "move" && !folder) return null;

    return {
      action: "create_rule",
      rule: { field, contains, then, folder: then === "move" ? folder : undefined },
      why: why || undefined,
    };
  }

  if (action === "create_template") {
    const name = clean(obj.name, 80);
    const body = clean(obj.body, 4000);
    if (!name || !body) return null;
    return { action: "create_template", template: { name, body }, why: why || undefined };
  }

  if (action === "mute_thread") {
    const subject = clean(obj.subject, 300);
    // An empty subject would mute every thread in the mailbox.
    if (!subject) return null;
    /*
     * Only the subject is carried through. Any `then`/`folder` the model
     * invents is dropped on the floor rather than rejected — muting has
     * exactly one behaviour (arrive read and archived, never deleted) and it
     * is not the model's to vary.
     */
    return { action: "mute_thread", mute: { subject }, why: why || undefined };
  }

  if (action === "snooze") {
    const preset = clean(obj.preset, 20) as SnoozeProposal["preset"];
    // Closed list: these are what the snooze engine implements, and a
    // free-form date would be a parsing surface for no benefit.
    if (!PRESETS.includes(preset)) return null;
    return { action: "snooze", snooze: { preset }, why: why || undefined };
  }

  return null;
}

/**
 * Plain language for the confirm step.
 *
 * The user has to be able to check the proposal without knowing the schema —
 * an approval nobody understands is not consent.
 */
export function describeProposal(p: Proposal): string {
  if (p.action === "create_rule" && p.rule) {
    const what =
      p.rule.then === "move"
        ? `move it to ${p.rule.folder}`
        : p.rule.then === "star"
          ? "flag it"
          : "mark it read";
    const where =
      p.rule.field === "from" ? "sender" : p.rule.field === "to" ? "recipient" : "subject";
    return `When the ${where} contains “${p.rule.contains}”, ${what}.`;
  }
  if (p.action === "create_template" && p.template) {
    return `Save a reply template called “${p.template.name}”.`;
  }
  if (p.action === "mute_thread" && p.mute) {
    // Says what happens to the mail, and says what does NOT — "will it delete
    // my mail?" is the first thing anyone asks about muting.
    return `Mute “${p.mute.subject}”. New replies arrive already read and archived, never deleted.`;
  }
  if (p.action === "snooze" && p.snooze) {
    const when =
      p.snooze.preset === "later"
        ? "later today"
        : p.snooze.preset === "tomorrow"
          ? "tomorrow morning"
          : p.snooze.preset === "weekend"
            ? "this weekend"
            : "next week";
    return `Hide this message and bring it back ${when}.`;
  }
  return "Unknown proposal.";
}
