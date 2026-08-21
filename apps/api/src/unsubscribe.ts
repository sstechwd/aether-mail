/**
 * One-click unsubscribe: RFC 2369 `List-Unsubscribe`, RFC 8058 One-Click.
 *
 * Filing a newsletter hides it; unsubscribing stops it. On the live inbox here
 * 93 of 180 messages carry the header and 90 of those support One-Click, so
 * this is the difference between managing the symptom and fixing the cause.
 *
 * THE HEADER IS ATTACKER-CONTROLLED INPUT — it arrives in mail from strangers.
 * Every value is hostile until proven otherwise:
 *
 *  - `mailto:` unsubscribe means SENDING AN EMAIL, which is precisely the
 *    capability this app withholds from the agent. It is surfaced as something
 *    only a human can do, never as a button the app can press.
 *  - any scheme other than https (javascript:, file:, data:, plain http) is
 *    rejected outright rather than sanitised, because there is no legitimate
 *    unsubscribe that needs them.
 *  - embedded credentials (https://real.example@evil.example) are rejected:
 *    the URL reads as trustworthy and resolves somewhere else.
 *
 * Even a perfectly valid https unsubscribe confirms the address is live, which
 * is the classic reason not to click unsubscribe in spam. That judgement
 * belongs to the human, so nothing here fires automatically.
 */

export type Unsubscribe = {
  /** Safe https endpoint, when there is one. */
  url?: string;
  /** Address for a mailto-only unsubscribe. Requires a human to send. */
  mailto?: string;
  /** "web" is a request we can make; "email" needs the user to send mail. */
  method: "web" | "email";
  /** RFC 8058: the sender promises a POST is enough, with no confirm page. */
  oneClick: boolean;
  /** Sending domain, so the UI can name who is being unsubscribed from. */
  fromDomain?: string;
};

/** Longest plausible unsubscribe URL. Beyond this it is not a real one. */
const MAX_URL = 2000;

/** Unfold RFC 5322 continuation lines into single logical headers. */
function unfold(raw: string): string {
  return (raw ?? "").replace(/\r?\n[ \t]+/g, "");
}

function headerValue(raw: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:[ \\t]*(.*)$`, "im");
  return re.exec(unfold(raw))?.[1]?.trim();
}

/**
 * Is this a URL we are willing to request?
 *
 * Allow-list of one scheme. A deny-list would have to anticipate every
 * dangerous scheme; this only has to know the single safe one.
 */
function safeHttps(candidate: string): string | undefined {
  if (!candidate || candidate.length > MAX_URL) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  // https://looks-legit.example@evil.example/ resolves to evil.example.
  if (parsed.username || parsed.password) return undefined;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return undefined;
  return parsed.toString();
}

function domainOfFrom(raw: string): string | undefined {
  const from = headerValue(raw, "from");
  if (!from) return undefined;
  const angled = /<([^>]+)>/.exec(from);
  const addr = (angled ? angled[1] : from).trim().toLowerCase();
  if (!addr.includes("@")) return undefined;
  return addr.split("@").pop() || undefined;
}

/**
 * Read the unsubscribe options out of a raw header block.
 *
 * Returns undefined when there is nothing usable, so callers can simply not
 * offer the action rather than handling an error.
 */
export function parseUnsubscribe(rawHeaders: string): Unsubscribe | undefined {
  const value = headerValue(rawHeaders ?? "", "list-unsubscribe");
  if (!value) return undefined;

  const entries = [...value.matchAll(/<([^>]*)>/g)].map((m) => m[1].trim());
  const fromDomain = domainOfFrom(rawHeaders);

  // https wins whenever it is offered: mailto means sending mail.
  let url: string | undefined;
  for (const entry of entries) {
    const safe = safeHttps(entry);
    if (safe) {
      url = safe;
      break;
    }
  }

  if (url) {
    const post = headerValue(rawHeaders, "list-unsubscribe-post");
    return {
      url,
      method: "web",
      oneClick: /one-click/i.test(post ?? ""),
      fromDomain,
    };
  }

  const mailtoEntry = entries.find((e) => e.toLowerCase().startsWith("mailto:"));
  if (mailtoEntry) {
    // Strip any ?subject=/&body= — those are the sender's wording, and this
    // address is only ever handed to the normal human confirm-to-send path.
    const addr = mailtoEntry.slice("mailto:".length).split("?")[0].trim();
    if (addr.includes("@") && addr.length < 320) {
      return { mailto: addr, method: "email", oneClick: false, fromDomain };
    }
  }

  return undefined;
}
