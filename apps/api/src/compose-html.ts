/**
 * Outgoing HTML.
 *
 * Rich-text compose means a contenteditable, which means the browser hands us
 * whatever markup it likes — plus anything the user pasted in from a web page.
 * That HTML then goes out over SMTP to other people.
 *
 * The threat model is the reverse of reading mail. Here we are the SENDER: if
 * a pasted tracking pixel or script survives, this client becomes the vector
 * rather than the victim. So the rule is an allow-list of the tags people
 * actually use to write, and nothing else.
 */

/** Tags a person needs to write an email. Everything else goes. */
const ALLOWED = new Set([
  "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span",
  "ul", "ol", "li", "blockquote", "a", "code", "pre", "h1", "h2", "h3",
]);

/**
 * Sanitize composed HTML for sending.
 *
 * Deliberately a strict allow-list rather than a deny-list: a deny-list has to
 * anticipate every dangerous tag, an allow-list only has to know the safe ones.
 */
export function sanitizeComposedHtml(raw: string): string {
  if (!raw) return "";
  let html = raw;

  // Whole elements whose content should not survive either.
  html = html.replace(/<(script|style|iframe|object|embed|form|svg|noscript)[\s\S]*?<\/\1>/gi, "");
  html = html.replace(/<(script|style|iframe|object|embed|form|svg|input|button|link|meta|base|img)\b[^>]*>/gi, "");
  html = html.replace(/<\/(script|style|iframe|object|embed|form|svg)>/gi, "");

  // Any remaining tag: keep it only if allowed, and strip its attributes.
  html = html.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (match, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED.has(name)) return "";
    if (match.startsWith("</")) return `</${name}>`;

    // A link may keep a safe href. Nothing else keeps any attribute — style
    // can hide text, and on* is script.
    if (name === "a") {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
      if (/^(https?:|mailto:)/i.test(url)) {
        const safe = url.replace(/"/g, "&quot;");
        return `<a href="${safe}">`;
      }
      return "<a>";
    }
    return `<${name}>`;
  });

  return html;
}

/**
 * A text/plain alternative for the multipart body.
 *
 * Every HTML mail should carry one: plenty of people read in plain text, and a
 * message with no text part looks empty to them.
 */
export function htmlToPlainText(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // Keep the link target — a bare label is useless without the URL.
  text = text.replace(
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, d: string, s: string, b: string, label: string) => {
      const url = (d ?? s ?? b ?? "").trim();
      const clean = label.replace(/<[^>]+>/g, "").trim();
      return clean && clean !== url ? `${clean} (${url})` : url;
    },
  );

  text = text.replace(/<li\b[^>]*>/gi, "\n- ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h1|h2|h3|blockquote|ul|ol)>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // contenteditable emits empty paragraphs generously; collapse the result.
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Is there any real formatting, or is this just text in a wrapper?
 *
 * If there is none, send text/plain only. A multipart/alternative whose HTML
 * part is `<div>hello</div>` is noise on the wire and looks worse in some
 * clients than the plain text would have.
 */
export function hasFormatting(raw: string): boolean {
  if (!raw) return false;
  const meaningful = /<(b|strong|i|em|u|s|ul|ol|li|blockquote|a|code|pre|h1|h2|h3)\b/i;
  return meaningful.test(raw);
}
