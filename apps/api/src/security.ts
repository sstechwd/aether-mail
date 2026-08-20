/**
 * Origins allowed to call the local API.
 *
 * `tauri.localhost` is the packaged desktop app's webview origin. Without it,
 * every API call from the shipped app was rejected and the UI received
 * index.html instead of JSON ("Unexpected token '<'"). The dev-server origins
 * stay for `npm run dev`.
 *
 * This is an exact allow-list, never a prefix/suffix match: `tauri.localhost`
 * must not also admit `tauri.localhost.evil.example`.
 */
export const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

export function allowOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

/** Browser cross-site calls always send Origin. Reject those we did not allow. */
export function rejectCrossSite(origin: string | undefined): boolean {
  return Boolean(origin) && !ALLOWED_ORIGINS.includes(origin as string);
}

export const MAX_BODY_BYTES = 1_000_000;

export function publicAccount<T extends { secret_ref?: string }>(row: T): Omit<T, "secret_ref"> {
  const { secret_ref: _drop, ...rest } = row;
  return rest;
}
