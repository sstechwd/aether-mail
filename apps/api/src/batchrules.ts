/**
 * Accepting several folder suggestions at once.
 *
 * The suggestions panel already computes five candidates. Accepting them one
 * at a time costs five confirmations and five backlog sweeps, which is the
 * friction the feature existed to remove.
 *
 * VALIDATE EVERYTHING, THEN MUTATE. A batch that validates inside its loop
 * ends up having created three rules before failing, leaving the user to work
 * out which three. This returns a plan or an error and creates nothing until
 * the caller has the whole plan — the same lesson the bulk message endpoint
 * taught when it returned 200 for an unknown action on missing ids.
 */

export type BatchEntry = {
  /** Sender domain to match, e.g. "mailer.shop.example". */
  match: string;
  /** Destination folder. */
  folder: string;
};

export type PlannedRule = {
  field: "from";
  contains: string;
  action: "move";
  folder: string;
};

export type BatchPlan = {
  ok: boolean;
  rules: PlannedRule[];
  error?: "no_entries" | "empty_match" | "no_folder" | "bad_folder" | "too_many";
};

/** One request should not be able to rewrite the whole rule book. */
const MAX_ENTRIES = 20;

function fail(error: BatchPlan["error"]): BatchPlan {
  return { ok: false, rules: [], error };
}

/**
 * Turn accepted suggestions into rules, or explain why not.
 *
 * Deliberately narrow: every rule is `from contains X -> move to Y`, because
 * that is what a sender suggestion means. Allowing arbitrary fields and verbs
 * here would quietly turn this into a general rule-writing endpoint with
 * weaker validation than the real one.
 */
export function planBatch(entries: BatchEntry[]): BatchPlan {
  if (!Array.isArray(entries) || entries.length === 0) return fail("no_entries");
  if (entries.length > MAX_ENTRIES) return fail("too_many");

  const rules: PlannedRule[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const contains = (entry?.match ?? "").trim();
    const folder = (entry?.folder ?? "").trim();

    // An empty pattern would match every message in the mailbox.
    if (!contains) return fail("empty_match");
    if (!folder) return fail("no_folder");
    // A folder name arrives from the client; never let it carry a path.
    if (/[/\\]/.test(folder) || folder.includes("..")) return fail("bad_folder");

    const key = contains.toLowerCase();
    // A duplicate is not an error — the user ticked two rows for the same
    // sender — but creating two identical rules would be.
    if (seen.has(key)) continue;
    seen.add(key);

    rules.push({ field: "from", contains, action: "move", folder });
  }

  return { ok: true, rules };
}
