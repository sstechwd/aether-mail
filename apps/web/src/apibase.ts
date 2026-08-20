/**
 * Where the API lives.
 *
 * Dev: Vite proxies `/api` to 127.0.0.1:8787, so relative URLs work.
 * Packaged: there is no proxy. A relative URL resolves against the Tauri asset
 * origin (`tauri.localhost`) and returns index.html, so every call failed with
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * The API always binds 127.0.0.1 only — making the URL absolute does not widen
 * the network surface.
 */

export const API_ORIGIN = "http://127.0.0.1:8787";

/** True when running inside the Tauri shell rather than a browser tab. */
export function isPackaged(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

export function apiUrl(path: string, opts?: { packaged?: boolean }): string {
  const packaged = opts?.packaged ?? isPackaged();
  if (/^https?:\/\//i.test(path)) return path;
  if (!packaged) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}${suffix}`;
}
