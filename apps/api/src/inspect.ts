export type AuthResult = "pass" | "fail" | "none" | "unknown";

export type HeaderInspect = {
  from: string;
  fromDomain: string;
  returnPath: string;
  returnPathDomain: string;
  replyTo: string;
  replyToDomain: string;
  receivedHops: number;
  firstHop: string;
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
  findings: string[];
  label: "ok" | "caution" | "danger";
};

function field(raw: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(.*)$`, "im");
  const m = raw.replace(/\r\n[ \t]/g, " ").match(re);
  return (m?.[1] ?? "").trim();
}

function domainOf(addr: string): string {
  const m = addr.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m?.[1] ?? "";
}

function authToken(blob: string, key: "spf" | "dkim" | "dmarc"): AuthResult {
  const m = blob.match(new RegExp(`${key}\\s*=\\s*(pass|fail|softfail|none|neutral|temperror|permerror)`, "i"));
  if (!m) return "unknown";
  const v = m[1].toLowerCase();
  if (v === "pass") return "pass";
  if (v === "fail" || v === "softfail" || v === "permerror") return "fail";
  if (v === "none" || v === "neutral") return "none";
  return "unknown";
}

export function inspectHeaders(raw: string): HeaderInspect {
  const from = field(raw, "From");
  const returnPath = field(raw, "Return-Path");
  const replyTo = field(raw, "Reply-To");
  const auth = field(raw, "Authentication-Results");
  const hops = raw.match(/^Received:/gim) ?? [];
  const firstHop = field(raw, "Received");
  const fromDomain = domainOf(from);
  const returnPathDomain = domainOf(returnPath);
  const replyToDomain = domainOf(replyTo);
  const spf = authToken(auth, "spf");
  const dkim = authToken(auth, "dkim");
  const dmarc = authToken(auth, "dmarc");
  const findings: string[] = [];
  if (fromDomain && returnPathDomain && fromDomain !== returnPathDomain) {
    findings.push(`From domain (${fromDomain}) ≠ Return-Path (${returnPathDomain})`);
  }
  if (fromDomain && replyToDomain && fromDomain !== replyToDomain) {
    findings.push(`Reply-To is ${replyToDomain}, not ${fromDomain}`);
  }
  if (spf === "fail") findings.push("SPF failed");
  if (dkim === "fail") findings.push("DKIM failed");
  if (dmarc === "fail") findings.push("DMARC failed");
  if (!auth && raw.trim()) findings.push("No Authentication-Results header");
  const fails = findings.filter((f) => /fail|≠|Reply-To/i.test(f)).length;
  const label = fails >= 2 ? "danger" : findings.length ? "caution" : "ok";
  return {
    from,
    fromDomain,
    returnPath,
    returnPathDomain,
    replyTo,
    replyToDomain,
    receivedHops: hops.length,
    firstHop: firstHop.slice(0, 180),
    spf,
    dkim,
    dmarc,
    findings,
    label,
  };
}

export function inspectSummary(r: HeaderInspect): string {
  const auth = `spf=${r.spf} dkim=${r.dkim} dmarc=${r.dmarc}`;
  if (!r.findings.length) return `Headers look aligned. ${auth}. ${r.receivedHops} hop(s).`;
  return `Header inspect (${r.label}): ${r.findings.join("; ")}. ${auth}.`;
}
