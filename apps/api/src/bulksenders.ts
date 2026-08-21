/**
 * Folder-level automation candidates.
 *
 * The agent could already suggest a rule for the one message you have open.
 * That is the wrong unit of work. The useful observation is "these 33 messages
 * share a sender — one rule files them all". On the live inbox here, five
 * domains account for 42% of 179 messages.
 *
 * Deliberately NOT an LLM job. Counting senders is arithmetic, and a 7B model
 * on a CPU would do it slower and occasionally wrong. The model's turn comes
 * afterwards, to phrase the suggestion; the candidates are computed exactly.
 *
 * The safety property that matters: never propose filing a domain the user
 * actually corresponds with. Silently archiving a colleague because they mail
 * you often is unforgivable, and "they send a lot" is exactly the signal a
 * naive implementation would key on.
 */

export type SourceRow = {
  from: string;
  subject?: string;
  unread?: boolean;
};

export type Candidate = {
  /** Domain to match on, e.g. "mailer.shop.example". */
  match: string;
  /** Human name for the suggestion, e.g. "Humble Bundle". */
  label: string;
  count: number;
  unread: number;
  /** True when this domain was held back rather than offered. */
  withheld?: boolean;
  /** Why it was held back, in words a user can read. */
  reason?: string;
};

export type Options = {
  /** Domains the user has sent mail TO — never propose filing these. */
  corresponded?: Set<string>;
  /** Patterns already covered by a rule; do not suggest them again. */
  alreadyRuled?: string[];
  /** Below this, a sender is not a filing problem. */
  minCount?: number;
  maxCandidates?: number;
  /** Return withheld domains too, flagged, so the UI can explain itself. */
  includeWithheld?: boolean;
};

/*
 * Subjects that must never be auto-filed.
 *
 * A filing rule is domain-wide and blunt: it cannot tell a Pixel advert from a
 * security alert sent by the same company. Found by reading the real
 * suggestions rather than trusting them — the live inbox offered "google.com,
 * 5 messages", and that rule would also have archived two "Security alert"
 * notices, two account-change notices and five delivery failures.
 *
 * Burying those is a real harm, and worse than the untidy inbox the rule was
 * meant to fix. So a domain that mixes them in is not offered at all.
 *
 * Anchored to the start, or to a word boundary with adjacent punctuation, so
 * ordinary marketing copy ("Secure your seat at our sale") does not trip it —
 * being too eager here quietly disables the feature for normal newsletters.
 */
const NEVER_FILE = [
  /^security alert/,
  /\bsecurity alert\b/,
  /\bsuspicious (activity|sign)/,
  /\bverification code\b/,
  /\bverify your (email|account|address)\b/,
  /\bone[- ]time (pass)?code\b/,
  /\bpassword (was )?(changed|reset)\b/,
  /\bnew sign[- ]?in\b/,
  /\btwo[- ]factor\b/,
  /\b2fa\b/,
  /^delivery status notification/,
  /^undeliverable\b/,
  /^mail delivery (failed|subsystem)/,
  /\bpayment (failed|declined)\b/,
  /\byour receipt\b/,
  /^invoice\b/,
  /\bfamily group member\b/,
];

/** Does this subject look like mail a user must not miss? */
function mustNotFile(subject: string): boolean {
  const s = (subject ?? "").toLowerCase().trim();
  if (!s) return false;
  return NEVER_FILE.some((re) => re.test(s));
}

/** Bare address out of `Name <a@b.c>` or `a@b.c`. */
function addressOf(from: string): string {
  const angled = /<([^>]+)>/.exec(from ?? "");
  return (angled ? angled[1] : (from ?? "")).trim().toLowerCase();
}

function domainOf(from: string): string {
  const addr = addressOf(from);
  if (!addr.includes("@")) return "";
  const domain = addr.split("@").pop() ?? "";
  // "@" alone, or a trailing dot, is not a domain.
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : "";
}

/** Display name if the header carried one, else the address. */
function labelOf(from: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*</.exec(from ?? "");
  if (named?.[1]?.trim()) return named[1].trim();
  return addressOf(from);
}

/**
 * Find senders worth a filing rule, biggest first.
 *
 * Grouped by DOMAIN rather than full address: real bulk mail varies the local
 * part per campaign (deal-1@, deal-2@, promo@), so grouping by address would
 * show five candidates of six messages each instead of one of thirty.
 */
export function findBulkSenders(rows: SourceRow[], opts: Options = {}): Candidate[] {
  const minCount = opts.minCount ?? 5;
  const maxCandidates = opts.maxCandidates ?? 5;
  const ruled = (opts.alreadyRuled ?? []).map((r) => r.toLowerCase());

  type DomainEntry = {
    count: number;
    unread: number;
    labels: Map<string, number>;
    protectedSubject?: string;
  };
  const byDomain = new Map<string, DomainEntry>();

  for (const row of rows) {
    const domain = domainOf(row?.from ?? "");
    if (!domain) continue;

    const entry: DomainEntry = byDomain.get(domain) ?? {
      count: 0,
      unread: 0,
      labels: new Map<string, number>(),
    };
    entry.count += 1;
    if (row.unread) entry.unread += 1;
    // Remember the first must-not-file subject so the reason can be specific.
    if (!entry.protectedSubject && mustNotFile(row.subject ?? "")) {
      entry.protectedSubject = (row.subject ?? "").trim();
    }
    const label = labelOf(row.from);
    entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
    byDomain.set(domain, entry);
  }

  const out: Candidate[] = [];
  const withheld: Candidate[] = [];
  for (const [domain, entry] of byDomain) {
    if (entry.count < minCount) continue;
    // A domain the user writes to is a correspondent, not a newsletter.
    if (opts.corresponded?.has(domain)) continue;
    // Already handled; suggesting it again is noise.
    if (ruled.some((r) => r.includes(domain) || domain.includes(r))) continue;

    // Most common display name wins — bulk senders vary it slightly.
    let label = domain;
    let best = 0;
    for (const [name, n] of entry.labels) {
      if (n > best) {
        best = n;
        label = name;
      }
    }

    /*
     * The domain also carries mail that must not be buried, so a blunt
     * domain-wide rule is unsafe. Withhold it rather than offer a rule that
     * would archive a security alert.
     */
    if (entry.protectedSubject) {
      if (opts.includeWithheld) {
        withheld.push({
          match: domain,
          label,
          count: entry.count,
          unread: entry.unread,
          withheld: true,
          reason: `also sends security or transactional mail (e.g. "${entry.protectedSubject}")`,
        });
      }
      continue;
    }

    out.push({ match: domain, label, count: entry.count, unread: entry.unread });
  }

  out.sort((a, b) => b.count - a.count);
  withheld.sort((a, b) => b.count - a.count);
  /*
   * Withheld domains are kept in a SEPARATE list and appended after the cap.
   *
   * Sharing the budget meant a large withheld domain sorted above real
   * candidates and pushed a perfectly good suggestion off the end — so turning
   * on the explanation would have COST the user actionable suggestions. An
   * explanation must never be more expensive than staying silent.
   */
  return [...out.slice(0, maxCandidates), ...withheld.slice(0, maxCandidates)];
}
