export function looksLikeHtml(raw: string): boolean {
  return /<[a-z][\s\S]*>/i.test(raw);
}

export function remoteImageCount(raw: string): number {
  return [...raw.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].length;
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeMailHtml(raw: string, opts: { allowRemoteImages: boolean }): string {
  let html = raw.replace(/\r\n/g, "\n");
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  /*
   * Keep the sender's <style>, but scrub it.
   *
   * Stripping style blocks outright is what made HTML mail look "boxy": a
   * newsletter carries its whole layout in there, and without it a multi-column
   * design collapses into stacked raw blocks. Keeping it is safe in this
   * context — the frame is sandboxed with no scripts and no same-origin, and
   * the CSP forbids fetching anything. What CSS can still do is pull a remote
   * resource (@import / url()) or, in ancient engines, run expression(). Those
   * come out.
   */
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
    const safe = css
      .replace(/@import[^;]*;?/gi, "")
      .replace(/expression\s*\(/gi, "void(")
      .replace(/javascript:/gi, "")
      .replace(/behavior\s*:[^;]*;?/gi, "")
      .replace(/-moz-binding[^;]*;?/gi, "")
      // url() may only reference bytes that came with the message.
      .replace(/url\(\s*['"]?\s*(?!data:)[^)]*\)/gi, "none");
    return `<style>${safe}</style>`;
  });
  html = html.replace(/<(iframe|object|embed|link|meta|base|form|input|button|textarea|svg)\b[\s\S]*?>/gi, "");
  html = html.replace(/<\/(iframe|object|embed|form|svg)>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/\bhref\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, 'href="#"');
  html = html.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const alt = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (src.toLowerCase().startsWith("cid:")) {
      return `<span class="cid">[inline image not downloaded]</span>`;
    }
    // A data: image here was decoded from this message's own MIME parts by
    // aether-cli — no network fetch, so no tracking pixel risk. Images only:
    // data:text/html would be a script-smuggling vector.
    if (/^data:/i.test(src)) {
      if (/^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=]+$/i.test(src)) {
        return `<img src="${esc(src)}" alt="${esc(alt)}">`;
      }
      return `<span class="blocked-img">[image blocked]</span>`;
    }
    if (/^https?:\/\//i.test(src)) {
      if (opts.allowRemoteImages) {
        return `<img src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer">`;
      }
      return `<span class="blocked-img" data-blocked-src="${esc(src)}">[image blocked]</span>`;
    }
    return "";
  });
  // data: is always permitted for images because those bytes came from the message
  // itself; http(s) stays gated behind the user's explicit Load choice.
  const imgSrc = opts.allowRemoteImages ? "img-src http: https: data:;" : "img-src data:;";
  const csp = `default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; font-src 'none'; script-src 'none'; frame-src 'none';`;
  // No max-width on the body: the message decides its own width. Clamping it
  // here is what made wide newsletters look squeezed into a narrow column.
  const shell =
    "body{font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0;padding:12px 14px;background:#fff}" +
    "img{max-width:100%;height:auto}" +
    "table{max-width:100%}" +
    "a{color:#0b5fff}" +
    ".blocked-img,.cid{color:#666;font-size:13px}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${shell}</style></head><body>${html}</body></html>`;
}
