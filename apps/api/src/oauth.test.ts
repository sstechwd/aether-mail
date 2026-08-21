import { describe, expect, it } from "vitest";
import {
  buildAuthUrl,
  xoauth2Token,
  isExpired,
  providerOAuth,
  parseTokenResponse,
} from "./oauth.js";

/**
 * OAuth2 for IMAP and SMTP.
 *
 * docs/DAILY-DRIVER-ASSESSMENT.md called this the single largest adoption
 * blocker: Google and Microsoft are removing app passwords, and anyone whose
 * employer enforces 2FA cannot connect at all today.
 *
 * We use the LOOPBACK REDIRECT flow (RFC 8252), not a device code and not an
 * embedded webview:
 *   - a native app cannot keep a client secret, so PKCE is mandatory
 *   - an embedded webview asking for a Google password is indistinguishable
 *     from phishing, and trains users to accept exactly that
 *   - the system browser already has the user's session and their password
 *     manager, and we never see the password at all
 */

describe("providerOAuth", () => {
  it("knows Google's endpoints", () => {
    const g = providerOAuth("gmail");
    expect(g?.authUrl).toContain("accounts.google.com");
    expect(g?.scope).toContain("mail.google.com");
  });

  it("knows Microsoft's endpoints", () => {
    const m = providerOAuth("outlook");
    expect(m?.authUrl).toContain("login.microsoftonline.com");
    // Offline access is what gets us a refresh token; without it the user has
    // to re-authorise every hour.
    expect(m?.scope).toContain("offline_access");
  });

  it("returns null for a provider without OAuth", () => {
    expect(providerOAuth("custom")).toBeNull();
  });
});

describe("buildAuthUrl", () => {
  const cfg = providerOAuth("gmail")!;

  it("includes PKCE, not a client secret", () => {
    const { url } = buildAuthUrl(cfg, "client-id-123", 8123);
    expect(url).toContain("code_challenge=");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).not.toContain("client_secret");
  });

  it("redirects to loopback on the port we are listening on", () => {
    const { url } = buildAuthUrl(cfg, "cid", 8123);
    expect(decodeURIComponent(url)).toContain("http://127.0.0.1:8123");
  });

  it("returns the verifier so the token exchange can prove it", () => {
    const { verifier } = buildAuthUrl(cfg, "cid", 8123);
    // RFC 7636: 43-128 chars.
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("uses a fresh verifier and state every time", () => {
    const a = buildAuthUrl(cfg, "cid", 8123);
    const b = buildAuthUrl(cfg, "cid", 8123);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });

  it("asks for a refresh token", () => {
    const { url } = buildAuthUrl(cfg, "cid", 8123);
    expect(url).toContain("access_type=offline");
  });
});

describe("xoauth2Token", () => {
  it("builds the SASL string IMAP expects", () => {
    // RFC 7628 / Google's XOAUTH2: user=<email>^Aauth=Bearer <token>^A^A
    const raw = Buffer.from(xoauth2Token("me@gmail.com", "tok123"), "base64").toString("utf8");
    expect(raw).toBe("user=me@gmail.com\x01auth=Bearer tok123\x01\x01");
  });

  it("is base64 so it can go straight into AUTHENTICATE", () => {
    const t = xoauth2Token("me@gmail.com", "tok");
    expect(/^[A-Za-z0-9+/]+=*$/.test(t)).toBe(true);
  });
});

describe("isExpired", () => {
  it("treats a token expiring within the skew as expired", () => {
    // Refreshing a minute early beats a failed sync at the boundary.
    expect(isExpired(Date.now() + 30_000)).toBe(true);
  });

  it("accepts a token with real time left", () => {
    expect(isExpired(Date.now() + 30 * 60_000)).toBe(false);
  });

  it("treats a missing expiry as expired rather than assuming valid", () => {
    expect(isExpired(undefined)).toBe(true);
    expect(isExpired(0)).toBe(true);
  });
});

describe("parseTokenResponse", () => {
  it("reads a normal token response", () => {
    const t = parseTokenResponse({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
    });
    expect(t?.accessToken).toBe("at");
    expect(t?.refreshToken).toBe("rt");
    expect(t!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("keeps the old refresh token when the server omits one", () => {
    // Google returns refresh_token only on first authorisation. Dropping it
    // would silently log the user out an hour later.
    const t = parseTokenResponse({ access_token: "at2", expires_in: 3599 }, "old-rt");
    expect(t?.refreshToken).toBe("old-rt");
  });

  it("returns null when there is no access token", () => {
    expect(parseTokenResponse({ error: "invalid_grant" })).toBeNull();
    expect(parseTokenResponse(null)).toBeNull();
  });
});
