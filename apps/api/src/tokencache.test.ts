import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenCache } from "./tokencache.js";

/**
 * Cached OAuth tokens.
 *
 * An access token lasts about an hour. Without refresh, OAuth works
 * beautifully for one sync and then silently stops — which is worse than not
 * shipping it, because the failure looks like a broken mailbox rather than an
 * expired credential.
 *
 * The refresh token itself is the long-lived secret and belongs in the OS
 * keyring. This cache holds only the short-lived access token and the expiry,
 * so losing the file costs one re-authorisation, not the account.
 */

function freshCache(): TokenCache {
  return TokenCache.openFile(join(mkdtempSync(join(tmpdir(), "aether-tok-")), "tokens.json"));
}

describe("TokenCache", () => {
  let cache: TokenCache;
  beforeEach(() => {
    cache = freshCache();
  });

  it("has nothing for an unknown account", () => {
    expect(cache.get("acc-1")).toBeUndefined();
  });

  it("stores and returns a token", () => {
    cache.set("acc-1", { accessToken: "at", expiresAt: Date.now() + 3600_000 });
    expect(cache.get("acc-1")?.accessToken).toBe("at");
  });

  it("reports a fresh token as usable", () => {
    cache.set("acc-1", { accessToken: "at", expiresAt: Date.now() + 3600_000 });
    expect(cache.usable("acc-1")).toBe(true);
  });

  it("reports an expired token as not usable", () => {
    cache.set("acc-1", { accessToken: "at", expiresAt: Date.now() - 1000 });
    expect(cache.usable("acc-1")).toBe(false);
  });

  it("treats a token expiring inside the refresh window as not usable", () => {
    // A sync starting 30s before expiry can finish after it.
    cache.set("acc-1", { accessToken: "at", expiresAt: Date.now() + 30_000 });
    expect(cache.usable("acc-1")).toBe(false);
  });

  it("survives a reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aether-tok-")), "tokens.json");
    const first = TokenCache.openFile(path);
    first.set("acc-1", { accessToken: "at", expiresAt: Date.now() + 3600_000 });
    expect(TokenCache.openFile(path).get("acc-1")?.accessToken).toBe("at");
  });

  it("never writes a refresh token to disk", () => {
    // The refresh token is the long-lived secret. It belongs in the keyring;
    // if it also sat here, the file would be as sensitive as a password.
    cache.set("acc-1", {
      accessToken: "at",
      expiresAt: Date.now() + 3600_000,
      // @ts-expect-error deliberately passing a field the type forbids
      refreshToken: "rt-should-not-persist",
    });
    expect(JSON.stringify(cache.raw())).not.toContain("rt-should-not-persist");
  });

  it("forgets a token on demand, for sign-out", () => {
    cache.set("acc-1", { accessToken: "at", expiresAt: Date.now() + 3600_000 });
    cache.clear("acc-1");
    expect(cache.get("acc-1")).toBeUndefined();
  });

  it("keeps accounts separate", () => {
    cache.set("acc-1", { accessToken: "one", expiresAt: Date.now() + 3600_000 });
    cache.set("acc-2", { accessToken: "two", expiresAt: Date.now() + 3600_000 });
    expect(cache.get("acc-1")?.accessToken).toBe("one");
    expect(cache.get("acc-2")?.accessToken).toBe("two");
  });

  it("starts empty rather than throwing on a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-tok-"));
    const path = join(dir, "tokens.json");
    require("node:fs").writeFileSync(path, "{ not json", "utf8");
    expect(() => TokenCache.openFile(path)).not.toThrow();
    expect(TokenCache.openFile(path).get("acc-1")).toBeUndefined();
  });
});
