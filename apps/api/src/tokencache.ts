/**
 * Short-lived OAuth access tokens.
 *
 * An access token lasts about an hour. Without refresh, OAuth works for one
 * sync and then silently stops — worse than not shipping it, because the
 * failure looks like a broken mailbox rather than an expired credential.
 *
 * Only the ACCESS token and its expiry live here. The refresh token is the
 * long-lived secret and stays in the OS keyring, so losing this file costs one
 * re-authorisation rather than the account. That split is the whole point of
 * the class: it keeps a cache file from quietly becoming a credential store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CachedToken = {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
};

/** Refresh this far ahead of real expiry; see oauth.ts for the reasoning. */
const SKEW_MS = 2 * 60_000;

export class TokenCache {
  private path: string;
  private tokens: Record<string, CachedToken>;

  private constructor(path: string, tokens: Record<string, CachedToken>) {
    this.path = path;
    this.tokens = tokens;
  }

  static openFile(path: string): TokenCache {
    let tokens: Record<string, CachedToken> = {};
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          tokens = parsed as Record<string, CachedToken>;
        }
      }
    } catch {
      // A corrupt cache must not stop the app booting. Worst case the user
      // signs in again.
      tokens = {};
    }
    return new TokenCache(path, tokens);
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.tokens, null, 2), "utf8");
  }

  get(accountId: string): CachedToken | undefined {
    return this.tokens[accountId];
  }

  /**
   * Store a token.
   *
   * Only the two fields are copied, never the whole object: callers hold a
   * refresh token on the same shape, and spreading it here would persist the
   * long-lived secret to disk.
   */
  set(accountId: string, token: CachedToken): void {
    this.tokens[accountId] = {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
    };
    this.save();
  }

  /** True when there is a token with real time left on it. */
  usable(accountId: string): boolean {
    const t = this.tokens[accountId];
    if (!t?.accessToken) return false;
    return Date.now() + SKEW_MS < t.expiresAt;
  }

  clear(accountId: string): void {
    delete this.tokens[accountId];
    this.save();
  }

  /** Everything held, for tests and diagnostics. */
  raw(): Record<string, CachedToken> {
    return { ...this.tokens };
  }
}
