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
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
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
    if (/^https?:\/\//i.test(src)) {
      if (opts.allowRemoteImages) {
        return `<img src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer">`;
      }
      return `<span class="blocked-img" data-blocked-src="${esc(src)}">[image blocked]</span>`;
    }
    return "";
  });
  const imgSrc = opts.allowRemoteImages ? "img-src http: https: data:;" : "img-src 'none';";
  const csp = `default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; font-src 'none'; script-src 'none'; frame-src 'none';`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{font:17px/1.65 system-ui,sans-serif;color:#111;margin:0;padding:8px;max-width:42rem}img{max-width:100%;height:auto}.blocked-img,.cid{color:#666;font-size:13px}</style></head><body>${html}</body></html>`;
}
