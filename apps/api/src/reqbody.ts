/**
 * Request body validation.
 *
 * Fuzzing the running API turned up three routes that returned HTTP 500 — with
 * the internal error text in the response body — when handed input of the wrong
 * shape: a non-JSON body, an object where a string was expected, a number where
 * a string was expected. Malformed input from a client is an expected event,
 * not a server fault, so it must produce a clean 400.
 *
 * These helpers make "assume the shape" impossible at the call site.
 */

/** Parse a JSON object body. Returns null for anything that is not an object. */
export function parseJsonBody(raw: string): Record<string, unknown> | null {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    // Arrays and primitives are valid JSON but wrong for every route here;
    // accepting them means `body.field` is undefined at best.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Coerce to a string, or the fallback. Never throws, never returns a non-string. */
export function asString(value: unknown, fallback = "", maxLength = 100_000): string {
  if (typeof value !== "string") return fallback;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Coerce to an array of strings, dropping anything else, bounded in length. */
export function asStringArray(value: unknown, maxItems = 100): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}
