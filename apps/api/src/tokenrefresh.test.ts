import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenCache } from "./tokencache.js";
import { ensureFreshToken } from "./tokenrefresh.js";

/**
 * Keeping an OAuth account signed in.
 *
 * An access token lasts about an hour. oauth.ts can refresh and tokencache.ts
 * knows when a token is stale, but until something CALLS them OAuth works for
 * one sync and then dies — and the failure looks like a broken mailbox rather
 * than an expired credential, which is the worst possible presentation.
 *
 * This is that missing call. Dependencies are injected so the logic is
 * testable without touching the network or the keyring.
 */

function freshCache(): TokenCache {
  return TokenCache.openFile(join(mkdtempSync(join(tmpdir(), "aether-ref-")), "tokens.json"));
}

const PASSWORD_ACCOUNT = { id: "acc-pw", provider: "custom", secret_ref: "aether:acc-pw" };
const OAUTH_ACCOUNT = { id: "acc-g", provider: "gmail", secret_ref: "oauth:gmail:me@gmail.com" };

describe("ensureFreshToken", () => {
  let cache: TokenCache;
  beforeEach(() => {
    cache = freshCache();
  });

  it("leaves a password account alone", async () => {
    const refresh = vi.fn();
    const result = await ensureFreshToken(PASSWORD_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "rt",
      refresh,
      storeAccessToken: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(result.refreshed).toBe(false);
    // Refreshing a password account would be nonsense and a wasted request.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing when the cached token is still good", async () => {
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "good", expiresAt: Date.now() + 40 * 60_000 });
    const refresh = vi.fn();
    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "rt",
      refresh,
      storeAccessToken: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(result.refreshed).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes when the token is stale", async () => {
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "old", expiresAt: Date.now() - 1000 });
    const refresh = vi
      .fn()
      .mockResolvedValue({ accessToken: "new", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
    const store = vi.fn();

    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "rt",
      refresh,
      storeAccessToken: store,
    });

    expect(result.ok).toBe(true);
    expect(result.refreshed).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    // The new token has to reach both the cache and the keyring, or the next
    // CLI call still sends the dead one.
    expect(cache.get(OAUTH_ACCOUNT.id)?.accessToken).toBe("new");
    expect(store).toHaveBeenCalledWith(OAUTH_ACCOUNT.secret_ref, "new", "rt", expect.any(Number));
  });

  it("refreshes when there is no cached token at all", async () => {
    const refresh = vi
      .fn()
      .mockResolvedValue({ accessToken: "new", expiresAt: Date.now() + 3600_000 });
    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "rt",
      refresh,
      storeAccessToken: vi.fn(),
    });
    expect(result.refreshed).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("reports a clear reason when the refresh token is gone", async () => {
    // The user revoked access, or the keyring entry was lost. Silence here
    // becomes a mailbox that mysteriously stops updating.
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "old", expiresAt: Date.now() - 1000 });
    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "",
      refresh: vi.fn(),
      storeAccessToken: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("sign in");
  });

  it("reports a clear reason when the provider refuses the refresh", async () => {
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "old", expiresAt: Date.now() - 1000 });
    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "rt",
      refresh: vi.fn().mockResolvedValue(null),
      storeAccessToken: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("sign in");
  });

  it("does not throw when the network is down mid-refresh", async () => {
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "old", expiresAt: Date.now() - 1000 });
    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "rt",
      refresh: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      storeAccessToken: vi.fn(),
    });
    expect(result.ok).toBe(false);
    // A transient network failure must not read as "you were signed out".
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("clears a dead cached token so a stale one is never reused", async () => {
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "old", expiresAt: Date.now() - 1000 });
    await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "cid",
      loadRefreshToken: () => "",
      refresh: vi.fn(),
      storeAccessToken: vi.fn(),
    });
    expect(cache.get(OAUTH_ACCOUNT.id)).toBeUndefined();
  });

  it("fails clearly when the client id is missing", async () => {
    cache.set(OAUTH_ACCOUNT.id, { accessToken: "old", expiresAt: Date.now() - 1000 });
    const result = await ensureFreshToken(OAUTH_ACCOUNT, cache, {
      clientIdFor: () => "",
      loadRefreshToken: () => "rt",
      refresh: vi.fn(),
      storeAccessToken: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("client id");
  });
});
