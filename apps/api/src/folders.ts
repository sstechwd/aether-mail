/**
 * Folder naming across providers.
 *
 * IMAP folder names are provider-specific: Gmail says "[Gmail]/Sent Mail",
 * Outlook says "Sent Items", others just "Sent". The UI shows one consistent
 * set regardless of who hosts the mailbox, so the mapping lives here.
 */

/** Display order — what a person checks most, first. */
export const FOLDER_ORDER = [
  "INBOX",
  "Starred",
  "Drafts",
  "Outbox",
  "Sent",
  "Archive",
  "Spam",
  "Trash",
] as const;

/** Folders we sync automatically. A user's own folders are opt-in. */
const SYNCED: ReadonlyArray<(typeof FOLDER_ORDER)[number]> = [
  "INBOX",
  "Sent",
  "Drafts",
  "Trash",
  "Spam",
];

const ALIASES: Record<string, string> = {
  inbox: "INBOX",
  // Gmail
  "[gmail]/sent mail": "Sent",
  "[gmail]/drafts": "Drafts",
  "[gmail]/trash": "Trash",
  "[gmail]/spam": "Spam",
  "[gmail]/all mail": "Archive",
  "[gmail]/starred": "Starred",
  "[google mail]/sent mail": "Sent",
  "[google mail]/trash": "Trash",
  // Outlook / Exchange
  "sent items": "Sent",
  "deleted items": "Trash",
  "junk email": "Spam",
  "junk e-mail": "Spam",
  junk: "Spam",
  outbox: "Outbox",
  // Common generic names
  sent: "Sent",
  drafts: "Drafts",
  draft: "Drafts",
  trash: "Trash",
  deleted: "Trash",
  bin: "Trash",
  spam: "Spam",
  archive: "Archive",
  "all mail": "Archive",
};

/** Provider-specific IMAP name -> the name we show. */
export function canonicalFolder(remote: string): string {
  const key = remote.trim().toLowerCase();
  const mapped = ALIASES[key];
  if (mapped) return mapped;
  // "Junk Email" maps to Junk above; normalise that to Spam.
  if (key === "junk email") return "Spam";
  return remote.trim();
}

/**
 * Given what the server actually has, decide what to sync.
 * INBOX is always included even if LIST failed or returned nothing.
 *
 * When two remote folders map to the same canonical name — a real Gmail
 * account can carry both a stray top-level "Sent" and "[Gmail]/Sent Mail" —
 * prefer the provider's namespaced one. The stray is usually an empty leftover
 * from another client, and picking it made Sent show zero messages.
 */
export function pickSyncFolders(available: string[]): Array<{ remote: string; canonical: string }> {
  const best = new Map<string, string>();

  const score = (remote: string): number => {
    // A namespaced name ("[Gmail]/Sent Mail") is the provider's own and wins.
    if (remote.startsWith("[")) return 2;
    return 1;
  };

  for (const remote of available) {
    const canonical = canonicalFolder(remote);
    if (!SYNCED.includes(canonical as (typeof SYNCED)[number])) continue;
    const current = best.get(canonical);
    if (current === undefined || score(remote) > score(current)) {
      best.set(canonical, remote);
    }
  }

  if (!best.has("INBOX")) best.set("INBOX", "INBOX");

  // Keep INBOX first; the rest follow the display order.
  const order = (name: string): number => {
    const i = (FOLDER_ORDER as readonly string[]).indexOf(name);
    return i === -1 ? FOLDER_ORDER.length : i;
  };
  return [...best.entries()]
    .map(([canonical, remote]) => ({ remote, canonical }))
    .sort((a, b) => order(a.canonical) - order(b.canonical));
}

/** Sort folder summaries into the order a human expects. */
export function sortFolders<T extends { name: string }>(folders: T[]): T[] {
  const rank = (name: string): number => {
    const i = (FOLDER_ORDER as readonly string[]).indexOf(name);
    return i === -1 ? FOLDER_ORDER.length : i;
  };
  return [...folders].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/**
 * A folder a message may be moved into.
 *
 * Drag-and-drop used to fail on any user folder because the HTTP move
 * route only allowed INBOX / Archive / Trash. Any mailbox name is fine;
 * a path is not.
 */
export function safeMoveFolder(raw: string | undefined): string | null {
  const name = (raw ?? "").trim();
  if (!name || name.length > 80) return null;
  if (/[\\/]|\.\./.test(name)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._[\]-]*$/.test(name)) return null;
  return name;
}
