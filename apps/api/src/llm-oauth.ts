/**
 * LLM subscription sign-in.
 *
 * SuperGrok (xAI) publishes a device-code OAuth flow that third-party
 * desktop apps can use. Usage then comes out of the SuperGrok / X Premium+
 * allowance instead of a metered API key.
 *
 * Claude and ChatGPT do not. Anthropic forbids third-party apps from using
 * claude.ai / Pro / Max credentials (they disable accounts). OpenAI's
 * "Sign in with ChatGPT" is only for Codex and named partners — copying
 * that client id is impersonation, not a feature. We refuse both.
 *
 * The xAI client id below is a public native-app id (device-code, no secret).
 * It is not a password. Tokens still go in the OS keyring.
 */

export type OauthDecision =
  | { ok: true; provider: "grok" }
  | { ok: false; reason: string };

export function oauthAllowedFor(preset: string): OauthDecision {
  if (preset === "grok") return { ok: true, provider: "grok" };
  if (preset === "claude") {
    return {
      ok: false,
      reason:
        "Anthropic does not allow third-party apps to sign in with a claude.ai / Pro / Max subscription. An API key from console.anthropic.com is the supported path.",
    };
  }
  if (preset === "openai") {
    return {
      ok: false,
      reason:
        "OpenAI does not offer ChatGPT-subscription sign-in to third-party mail apps. An API key from platform.openai.com is the supported path.",
    };
  }
  return { ok: false, reason: "That provider has no subscription sign-in." };
}

/** Public xAI Grok CLI OAuth client (device-code; no client secret). */
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
export const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";

export function xaiTokenEndpointOk(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "auth.x.ai" || host === "x.ai" || host.endsWith(".x.ai");
  } catch {
    return false;
  }
}

export type DeviceStart = {
  deviceCode: string;
  userCode: string;
  url: string;
  expiresIn: number;
  intervalMs: number;
};

export function parseDeviceCodeStart(raw: unknown): DeviceStart {
  const p = (raw ?? {}) as Record<string, unknown>;
  const deviceCode = typeof p.device_code === "string" ? p.device_code : "";
  const userCode = typeof p.user_code === "string" ? p.user_code : "";
  const url =
    (typeof p.verification_uri_complete === "string" && p.verification_uri_complete) ||
    (typeof p.verification_uri === "string" && p.verification_uri) ||
    "";
  if (!deviceCode || !userCode || !url) throw new Error("xAI device-code response was incomplete");
  const expiresIn = Number(p.expires_in) || 900;
  const interval = Number(p.interval) || 5;
  return {
    deviceCode,
    userCode,
    url,
    expiresIn,
    intervalMs: Math.max(1, interval) * 1000,
  };
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "ready"; accessToken: string; refreshToken: string; expiresIn: number }
  | { status: "denied"; message: string }
  | { status: "error"; message: string };

export function interpretDevicePoll(httpStatus: number, raw: unknown): DevicePoll {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (httpStatus === 200) {
    const accessToken = typeof p.access_token === "string" ? p.access_token : "";
    const refreshToken = typeof p.refresh_token === "string" ? p.refresh_token : "";
    if (!accessToken || !refreshToken) {
      return { status: "error", message: "xAI signed you in but did not return both tokens." };
    }
    return {
      status: "ready",
      accessToken,
      refreshToken,
      expiresIn: Number(p.expires_in) || 3600,
    };
  }
  const err = typeof p.error === "string" ? p.error : "";
  if (err === "authorization_pending") return { status: "pending" };
  if (err === "slow_down") return { status: "pending" };
  if (httpStatus === 403 || err === "access_denied") {
    return {
      status: "denied",
      message:
        "xAI refused this SuperGrok login for API use. Some subscription tiers can chat on grok.com but are not on the OAuth allow-list. Paste an API key from console.x.ai instead.",
    };
  }
  const detail =
    (typeof p.error_description === "string" && p.error_description) ||
    err ||
    `xAI sign-in failed (${httpStatus})`;
  return { status: "error", message: detail };
}

export function xaiRefreshForm(refreshToken: string): Record<string, string> {
  return {
    grant_type: "refresh_token",
    client_id: XAI_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  };
}

export function xaiDeviceStartForm(): Record<string, string> {
  return {
    client_id: XAI_OAUTH_CLIENT_ID,
    scope: XAI_OAUTH_SCOPE,
  };
}

export function xaiDevicePollForm(deviceCode: string): Record<string, string> {
  return {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: XAI_OAUTH_CLIENT_ID,
    device_code: deviceCode,
  };
}

/** What we store in the single /llm keyring slot. A raw string is a legacy API key. */
export type LlmSecret =
  | { kind: "apikey"; key: string }
  | { kind: "oauth"; access: string; refresh: string; expiresAt: number };

export function packLlmSecret(secret: LlmSecret): string {
  return JSON.stringify(secret);
}

export function unpackLlmSecret(raw: string): LlmSecret | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const p = JSON.parse(text) as Partial<LlmSecret> & { kind?: string };
      if (p.kind === "oauth" && p.access && p.refresh) {
        return { kind: "oauth", access: p.access, refresh: p.refresh, expiresAt: Number(p.expiresAt) || 0 };
      }
      if (p.kind === "apikey" && p.key) return { kind: "apikey", key: p.key };
    } catch {
      return null;
    }
    return null;
  }
  return { kind: "apikey", key: text };
}
