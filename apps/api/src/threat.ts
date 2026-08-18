export type ThreatInput = { subject: string; from: string; body: string };
export type ThreatReport = {
  score: number;
  label: "ok" | "caution" | "danger";
  reasons: string[];
};

export function scoreThreat(mail: ThreatInput): ThreatReport {
  const blob = `${mail.subject}\n${mail.from}\n${mail.body}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  if (/attacker@|forward every|delete the originals/.test(blob)) {
    score += 50;
    reasons.push("Asks to forward or delete mail (prompt injection / fraud)");
  }
  if (/verify your account|urgent:|password expires|wire transfer/.test(blob)) {
    score += 25;
    reasons.push("Urgency / credential bait");
  }
  if (/@evil\.|noreply@.*\.zip|bit\.ly\//.test(blob)) {
    score += 20;
    reasons.push("Suspicious sender or short link");
  }
  if (/unsubscribe|newsletter|this week in/.test(blob)) {
    score = Math.max(0, score - 15);
    reasons.push("Looks like a newsletter");
  }
  score = Math.min(100, score);
  const label = score >= 70 ? "danger" : score >= 40 ? "caution" : "ok";
  return { score, label, reasons };
}
