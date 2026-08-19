/**
 * Reply / Reply-all / Forward.
 *
 * Addressing is the part that goes wrong: a reply must go to the *sender*, not
 * to the inbound To header (which is you). Reply-all must keep everyone else and
 * drop you, without duplicating the sender into Cc.
 */

import { extractAddress } from "./send-prepare.js";

export type SourceMessage = {
  id?: string;
  from: string;
  to?: string;
  cc?: string;
  subject: string;
  date?: string;
  body?: string;
};

export type Composed = {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
};

/** Split an address header into bare addresses, dropping empties. */
function addressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => extractAddress(part.trim()))
    .filter((a) => a.length > 0);
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Add a prefix only when it is not already there. */
function prefixOnce(subject: string, prefix: string): string {
  const trimmed = subject.trim();
  const re = new RegExp(`^${prefix}\\s*:`, "i");
  return re.test(trimmed) ? trimmed : `${prefix}: ${trimmed}`;
}

/**
 * Quote text for a reply. Bounded: quoting a 5,000-line newsletter would make
 * every reply enormous and is never what the user wants.
 */
export function quoteBody(body: string, maxLines = 200): string {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  const kept = lines.slice(0, maxLines).map((l) => (l.length ? `> ${l}` : ">"));
  if (lines.length > maxLines) {
    kept.push(`> ... (${lines.length - maxLines} more lines trimmed)`);
  }
  return kept.join("\n");
}

function attribution(src: SourceMessage): string {
  const when = src.date ? new Date(src.date) : null;
  const stamp =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "";
  const who = src.from?.trim() || "they";
  return stamp ? `On ${stamp}, ${who} wrote:` : `${who} wrote:`;
}

export function buildReply(src: SourceMessage, opts: { me: string; all?: boolean }): Composed {
  const sender = extractAddress(src.from);
  const me = extractAddress(opts.me);

  let cc: string | undefined;
  if (opts.all) {
    const others = [...addressList(src.to), ...addressList(src.cc)].filter(
      (a) => !sameAddress(a, me) && !sameAddress(a, sender),
    );
    // De-duplicate while preserving order.
    const seen = new Set<string>();
    const unique = others.filter((a) => {
      const key = a.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length) cc = unique.join(", ");
  }

  return {
    to: sender,
    cc,
    subject: prefixOnce(src.subject ?? "", "Re"),
    // Leading blank lines: the user types above the quote.
    body: `\n\n${attribution(src)}\n${quoteBody(src.body ?? "")}`,
    inReplyTo: src.id,
  };
}

export function buildForward(src: SourceMessage): Composed {
  const header = [
    "---------- Forwarded message ----------",
    `From: ${src.from ?? ""}`,
    src.date ? `Date: ${src.date}` : "",
    `Subject: ${src.subject ?? ""}`,
    src.to ? `To: ${src.to}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    to: "",
    subject: prefixOnce(src.subject ?? "", "Fwd"),
    body: `\n\n${header}\n\n${src.body ?? ""}`,
  };
}
