export function extractAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  return (angle?.[1] ?? from).trim();
}

export function prepareSend(input: {
  draft?: string | { text?: string } | null;
  to?: string;
  subject?: string;
  source?: { folder: string; from: string; to: string; subject: string; body: string } | null;
}): { to: string; subject: string; body: string } {
  const drafted =
    typeof input.draft === "string" ? input.draft : input.draft?.text ?? "";
  const src = input.source;
  const body = drafted.trim() || (src?.folder === "Drafts" ? src.body.trim() : "");
  let to = (input.to ?? "").trim();
  if (!to && src) {
    to = src.folder === "Drafts" ? src.to.trim() : extractAddress(src.from);
  }
  let subject = (input.subject ?? "").trim();
  if (!subject && src) {
    subject =
      src.folder === "Drafts" || src.subject.startsWith("Re:") ? src.subject : `Re: ${src.subject}`;
  }
  if (!to || !body) {
    throw new Error("Need a recipient and a body before confirm.");
  }
  return { to, subject: subject || "(no subject)", body };
}
