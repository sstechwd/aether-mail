/**
 * Keeping an OAuth account signed in.
 *
 * `oauth.ts` can refresh a token and `tokencache.ts` knows when one is stale,
 * but until something calls them OAuth works for a single sync and then stops.
 * That failure presents as a mailbox that mysteriously stopped updating rather
 * than as an expired credential, which is the worst possible version of it.
 *
 * This is the missing call. Dependencies are injected rather than imported so
 * the decision logic is testable without a network or a keyring — the part
 * that actually goes wrong is the branching, not the HTTP.
 */

import type { OAuthToken } from "./oauth.js";
import type { TokenCache } from "./tokencache.js";

export type RefreshableAccount = {
  id: string;
  provider: string;
  secret_ref: string;
};

export type RefreshDeps = {
  /** Configured OAuth client id for a provider, or "" when unset. */
  clientIdFor: (provider: string) => string;
  /** The long-lived refresh token from the OS keyring, or "" if gone. */
  loadRefreshToken: (secretRef: string) => string;
  refresh: (provider: string, clientId: string, refreshToken: string) => Promise<OAuthToken | null>;
  /** Persist the new access token where the mail CLI will read it. */
  storeAccessToken: (
    secretRef: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
  ) => void;
};

export type RefreshResult = {
  ok: boolean;
  refreshed: boolean;
  reason: string;
};

/** An account authenticated by token rather than password. */
function isOAuthAccount(account: RefreshableAccount): boolean {
  return account.secret_ref.startsWith("oauth:");
}

/**
 * Make sure the account has a usable access token, refreshing if needed.
 *
 * Returns rather than throws: a sync loop calling this for every account must
 * be able to skip one broken account and carry on with the rest.
 */
export async function ensureFreshToken(
  account: RefreshableAccount,
  cache: TokenCache,
  deps: RefreshDeps,
): Promise<RefreshResult> {
  if (!isOAuthAccount(account)) {
    return { ok: true, refreshed: false, reason: "password account" };
  }
  if (cache.usable(account.id)) {
    return { ok: true, refreshed: false, reason: "token still valid" };
  }

  // Drop the stale entry first. If anything below fails we must not leave a
  // dead token sitting in the cache for the next caller to send.
  cache.clear(account.id);

  const clientId = deps.clientIdFor(account.provider);
  if (!clientId) {
    return {
      ok: false,
      refreshed: false,
      reason: `No OAuth client id configured for ${account.provider}. See docs/OAUTH.md.`,
    };
  }

  const refreshToken = deps.loadRefreshToken(account.secret_ref);
  if (!refreshToken) {
    return {
      ok: false,
      refreshed: false,
      reason: `${account.provider} access has been revoked or lost. Please sign in again.`,
    };
  }

  let token: OAuthToken | null = null;
  try {
    token = await deps.refresh(account.provider, clientId, refreshToken);
  } catch (e) {
    // A transient network failure must not be reported as a sign-out, or the
    // user re-authorises for no reason every time their wifi drops.
    return {
      ok: false,
      refreshed: false,
      reason: `Could not reach ${account.provider} to refresh the session: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  if (!token) {
    return {
      ok: false,
      refreshed: false,
      reason: `${account.provider} refused to refresh the session. Please sign in again.`,
    };
  }

  cache.set(account.id, { accessToken: token.accessToken, expiresAt: token.expiresAt });
  // The keyring copy is what the mail CLI actually reads, so both have to be
  // updated or the next fetch still presents the dead token.
  deps.storeAccessToken(
    account.secret_ref,
    token.accessToken,
    token.refreshToken ?? refreshToken,
    token.expiresAt,
  );

  return { ok: true, refreshed: true, reason: "refreshed" };
}
