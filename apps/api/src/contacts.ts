/**
 * Contacts, harvested from mail you already have.
 *
 * No CardDAV, no address-book sync, no new storage: the store already knows
 * everyone you have corresponded with. Typing a full address every time is the
 * single most annoying thing about composing in a fresh client, and this fixes
 * it with data we already hold.
 */

export type Contact = {
  address: string;
  name?: string;
  /** Higher is more relevant. People you write to outrank people who write to you. */
  score: number;
};

type Sourced = { from?: string; to?: string; folder?: string; date?: string };

/** `Priya Raman <priya@example.com>` -> name + address */
function splitAddress(raw: string): { name?: string; address: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(value);
  if (angled) {
    // Real senders wrap names in quotes, and decoding earlier in the pipeline
    // can leave one side unbalanced ('Amazon.com"'). Strip any quote at either
    // end rather than only a matched pair.
    const name = angled[1].trim().replace(/^["']+/, "").replace(/["']+$/, "").trim();
    const address = angled[2].trim().toLowerCase();
    if (!address.includes("@")) return null;
    return { name: name || undefined, address };
  }
  const bare = value.toLowerCase();
  return bare.includes("@") ? { address: bare } : null;
}

/** Addresses nobody wants suggested when composing. */
function isNoReply(address: string): boolean {
  return /^(no-?reply|do-?not-?reply|bounce|mailer-daemon|postmaster|notifications?)@/i.test(address);
}

/**
 * Build the address book.
 *
 * Scoring is deliberately simple and explainable:
 *   +3  you addressed them (appears in To of a message you sent)
 *   +1  they wrote to you
 *   -2  the address looks automated
 */
export function harvestContacts(messages: Sourced[], me: string): Contact[] {
  const mine = (me ?? "").trim().toLowerCase();
  const byAddress = new Map<string, Contact>();

  const add = (raw: string | undefined, weight: number): void => {
    for (const piece of (raw ?? "").split(",")) {
      const parsed = splitAddress(piece);
      if (!parsed) continue;
      if (parsed.address === mine) continue;
      const existing = byAddress.get(parsed.address);
      if (existing) {
        existing.score += weight;
        // Keep the first real display name we saw.
        if (!existing.name && parsed.name) existing.name = parsed.name;
      } else {
        byAddress.set(parsed.address, {
          address: parsed.address,
          name: parsed.name,
          score: weight + (isNoReply(parsed.address) ? -2 : 0),
        });
      }
    }
  };

  for (const m of messages) {
    if (m.folder === "Sent" || m.folder === "Drafts") {
      add(m.to, 3);
    } else {
      add(m.from, 1);
    }
  }

  return [...byAddress.values()].sort(
    (a, b) => b.score - a.score || a.address.localeCompare(b.address),
  );
}

/** Match on address or display name — people think in names. */
export function suggestContacts(book: Contact[], query: string, limit = 6): Contact[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [];
  return book
    .filter((c) => c.address.includes(q) || (c.name ?? "").toLowerCase().includes(q))
    .slice(0, limit);
}
