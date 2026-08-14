export const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
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
