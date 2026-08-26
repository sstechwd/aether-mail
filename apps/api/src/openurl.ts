/**
 * URLs we will hand to the OS (Firefox, mailto handler).
 *
 * Mail HTML is hostile. Only http(s) and mailto, never javascript:, file:,
 * or a URL that already contains a password.
 */
import { execFile } from "node:child_process";

export function safeOpenUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password) return false;
    if (u.protocol === "mailto:") return Boolean(u.pathname || u.href);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Google / Microsoft login pages for mail OAuth (system browser only). */
export function mailOauthUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "accounts.google.com" ||
      host.endsWith(".google.com") ||
      host === "login.microsoftonline.com" ||
      host.endsWith(".microsoftonline.com") ||
      host === "login.live.com" ||
      host === "account.microsoft.com"
    );
  } catch {
    return false;
  }
}

export function windowsStartArgs(url: string): string[] {
  // cmd.exe splits on bare &. Newsletter links always have tracking queries.
  const escaped = url.replace(/"/g, "").replace(/&/g, "^&");
  return ["/c", "start", "", escaped];
}

export function openInOsBrowser(url: string): void {
  if (!safeOpenUrl(url) && !mailOauthUrlOk(url)) return;
  if (process.platform === "win32") {
    execFile("cmd.exe", windowsStartArgs(url), { windowsHide: true }, () => undefined);
    return;
  }
  if (process.platform === "darwin") {
    execFile("open", [url], () => undefined);
    return;
  }
  execFile("xdg-open", [url], () => undefined);
}
