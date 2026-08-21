/**
 * OAuth2 for IMAP and SMTP.
 *
 * The single largest adoption blocker in docs/DAILY-DRIVER-ASSESSMENT.md:
 * Google and Microsoft are removing app passwords, and anyone whose employer
 * enforces 2FA cannot connect at all without this.
 *
 * Loopback redirect with PKCE (RFC 8252 + RFC 7636), deliberately:
 *
 *   - A desktop app cannot keep a client secret. Anything shipped in the
 *     binary is public, so PKCE is the only real protection and the flow is
 *     designed to work without a secret at all.
 *   - No embedded webview. A window inside a mail client asking for your
 *     Google password is indistinguishable from phishing, and teaching users
 *     to accept that is actively harmful. The system browser already has
 *     their session and their password manager.
 *   - We never see the password. We receive a scoped token that the user can
 *     revoke from their provider's account page without touching Aether.
 *
 * Tokens are stored in the OS keyring like every other credential — never in
 * JSON, argv, or logs.
 */

import { createHash, randomBytes } from "node:crypto";

export type OAuthConfig = {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  /** Where to send the user to revoke access, shown in the UI. */
  revokeHint: string;
};

export type OAuthToken = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
};

/**
 * Refresh this long before the token actually dies.
 *
 * A sync that starts 30 seconds before expiry can easily finish after it, so
 * refreshing early costs one extra request and avoids a spurious auth failure.
 */
const EXPIRY_SKEW_MS = 2 * 60_000;

const PROVIDERS: Record<string, OAuthConfig> = {
  gmail: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // The full mail scope is what IMAP and SMTP need; narrower read-only
    // scopes cannot send.
    scope: "https://mail.google.com/",
    revokeHint: "https://myaccount.google.com/permissions",
  },
  outlook: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // offline_access is what yields a refresh token; without it the user is
    // asked to re-authorise every hour.
    scope:
      "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    revokeHint: "https://account.microsoft.com/privacy/app-access",
  },
};

export function providerOAuth(provider: string): OAuthConfig | null {
  return PROVIDERS[provider] ?? null;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build the authorisation URL the system browser should open.
 *
 * Returns the verifier and state alongside it: the verifier proves at token
 * exchange that the same client started the flow, and the state is checked on
 * the callback so another local process cannot inject a code.
 */
export function buildAuthUrl(
  cfg: OAuthConfig,
  clientId: string,
  port: number,
): { url: string; verifier: string; state: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(24));

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: `http://127.0.0.1:${port}/oauth/callback`,
    scope: cfg.scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    // Without this Google skips the consent screen on re-auth and returns no
    // refresh token, which looks like a bug months later when it expires.
    prompt: "consent",
  });

  return { url: `${cfg.authUrl}?${params.toString()}`, verifier, state };
}

/** The SASL XOAUTH2 initial response, base64 as IMAP AUTHENTICATE expects. */
export function xoauth2Token(email: string, accessToken: string): string {
  return Buffer.from(`user=${email}\x01auth=Bearer ${accessToken}\x01\x01`, "utf8").toString(
    "base64",
  );
}

/** True when a token is missing, expired, or about to be. */
export function isExpired(expiresAt: number | undefined): boolean {
  if (!expiresAt) return true;
  return Date.now() + EXPIRY_SKEW_MS >= expiresAt;
}

/**
 * Normalise a token endpoint response.
 *
 * `previousRefresh` is kept when the server omits one: Google returns a
 * refresh token only on first authorisation, and dropping it would silently
 * log the user out an hour later.
 */
export function parseTokenResponse(body: unknown, previousRefresh?: string): OAuthToken | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const accessToken = typeof obj.access_token === "string" ? obj.access_token : "";
  if (!accessToken) return null;

  const refreshToken =
    typeof obj.refresh_token === "string" && obj.refresh_token ? obj.refresh_token : previousRefresh;
  const expiresIn = typeof obj.expires_in === "number" ? obj.expires_in : 3600;

  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 };
}

/** Exchange an authorisation code for tokens. No client secret: PKCE only. */
export async function exchangeCode(
  cfg: OAuthConfig,
  clientId: string,
  code: string,
  verifier: string,
  port: number,
): Promise<OAuthToken | null> {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `http://127.0.0.1:${port}/oauth/callback`,
    }).toString(),
  });
  return parseTokenResponse(await res.json().catch(() => null));
}

/** Trade a refresh token for a fresh access token. */
export async function refreshAccessToken(
  cfg: OAuthConfig,
  clientId: string,
  refreshToken: string,
): Promise<OAuthToken | null> {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  return parseTokenResponse(await res.json().catch(() => null), refreshToken);
}
