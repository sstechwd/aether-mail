/**
 * Conversation threading.
 *
 * A mailbox is a list of messages; a person reads it as a set of conversations.
 * 149 flat rows where 40 of them are one back-and-forth is the single biggest
 * thing that makes a client feel primitive.
 *
 * Two strategies, in order:
 *   1. References / In-Reply-To — what RFC 5322 provides, and correct even when
 *      someone changes the subject line mid-thread.
 *   2. Normalized subject — the fallback for senders that strip those headers,
 *      which mailing lists and some phone clients still do.
 *
 * The messages already carry raw headers in the store, so this needs no extra
 * fetch and no schema change.
 */

export type Threadable = {
  id: string;
  subject?: string;
  from?: string;
  date?: string;
  headers?: string;
  unread?: boolean;
};

export type Thread<T extends Threadable = Threadable> = {
  key: string;
  /** Newest message — what the list row shows. */
  latest: T;
  /** How many messages are in this conversation. */
  count: number;
  /** True when any message in the thread is unread. */
  unread: boolean;
  /** Distinct senders, for a "Priya, you, Ana" style row. */
  participants: string[];
  /** Every message id, so opening a thread can show the whole exchange. */
  ids: string[];
};

/** `Re: Fwd: [list] Subject` -> `subject` */
export function normalizeSubject(subject: string): string {
  let s = (subject ?? "").trim();
  // Strip stacked prefixes and list tags until nothing more comes off.
  for (;;) {
    const next = s
      .replace(/^\s*(re|fw|fwd|aw|sv|vs|antw)\s*(\[\d+\])?\s*:\s*/i, "")
      .replace(/^\s*\[[^\]]+\]\s*/, "");
    if (next === s) break;
    s = next;
  }
  return s.trim().toLowerCase();
}

/** Pull a header value out of the raw header blob. */
function header(headers: string, name: string): string | null {
  const re = new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)$`, "im");
  const match = re.exec(headers ?? "");
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

/** First message-id in a References chain is the thread root. */
function firstMessageId(value: string): string | null {
  const match = /<[^>]+>/.exec(value);
  return match ? match[0] : null;
}

/**
 * A stable key for the conversation a message belongs to.
 *
 * An unthreadable message (no headers, no subject) gets a key unique to itself
 * rather than joining a giant "" bucket with every other blank-subject mail.
 */
export function threadKey(msg: { subject?: string; headers?: string; id?: string }): string {
  const headers = msg.headers ?? "";

  const references = header(headers, "References");
  if (references) {
    const root = firstMessageId(references);
    if (root) return root;
  }

  const inReplyTo = header(headers, "In-Reply-To");
  if (inReplyTo) {
    const root = firstMessageId(inReplyTo);
    if (root) return root;
  }

  // A message that started a thread is keyed by its own id, so replies
  // pointing at it land in the same bucket.
  const own = header(headers, "Message-ID");
  const normalized = normalizeSubject(msg.subject ?? "");
  if (own && !normalized) {
    const self = firstMessageId(own);
    if (self) return self;
  }

  if (normalized) return `subj:${normalized}`;
  return `id:${msg.id ?? Math.random().toString(36)}`;
}

function addressOf(from: string): string {
  const angled = /<([^>]+)>/.exec(from ?? "");
  return (angled ? angled[1] : (from ?? "")).trim().toLowerCase();
}

function time(value?: string): number {
  const t = new Date(value ?? "").getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Group messages into conversations, newest conversation first. */
export function groupIntoThreads<T extends Threadable>(messages: T[]): Array<Thread<T>> {
  const buckets = new Map<string, T[]>();

  for (const msg of messages) {
    // Messages that started a thread carry their own Message-ID; replies carry
    // it in References. Key on the root either way.
    const own = firstMessageId(header(msg.headers ?? "", "Message-ID") ?? "");
    const referenced = threadKey(msg);
    // If this message's own id is already a bucket, join it.
    const key = own && buckets.has(own) ? own : referenced;
    const list = buckets.get(key);
    if (list) {
      list.push(msg);
    } else {
      buckets.set(key, [msg]);
      // Register the message's own id as an alias so later replies find it.
      if (own && own !== key && !buckets.has(own)) buckets.set(own, buckets.get(key)!);
    }
  }

  // The alias trick above can point two keys at the same array; de-duplicate.
  const seen = new Set<T[]>();
  const threads: Array<Thread<T>> = [];

  for (const [key, list] of buckets) {
    if (seen.has(list)) continue;
    seen.add(list);

    const sorted = [...list].sort((a, b) => time(b.date) - time(a.date));
    const participants: string[] = [];
    for (const m of sorted) {
      const addr = addressOf(m.from ?? "");
      if (addr && !participants.includes(addr)) participants.push(addr);
    }

    threads.push({
      key,
      latest: sorted[0],
      count: sorted.length,
      unread: sorted.some((m) => m.unread === true),
      participants,
      ids: sorted.map((m) => m.id),
    });
  }

  return threads.sort((a, b) => time(b.latest.date) - time(a.latest.date));
}
