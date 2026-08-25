import { describe, expect, it } from "vitest";
import {
  interpretDevicePoll,
  oauthAllowedFor,
  packLlmSecret,
  parseDeviceCodeStart,
  unpackLlmSecret,
  xaiTokenEndpointOk,
} from "./llm-oauth.js";

/**
 * SuperGrok sign-in (xAI device-code OAuth).
 *
 * Claude Pro/Max and ChatGPT Plus are not offered here: Anthropic forbids
 * third-party apps from using claude.ai credentials, and OpenAI's ChatGPT
 * sign-in is only for Codex / first-party clients. Pretending otherwise
 * risks the user's account.
 */

describe("which subscriptions we will sign in", () => {
  it("allows SuperGrok and refuses Claude and ChatGPT", () => {
    expect(oauthAllowedFor("grok")?.ok).toBe(true);
    expect(oauthAllowedFor("claude")?.ok).toBe(false);
    expect(oauthAllowedFor("openai")?.ok).toBe(false);
    expect(oauthAllowedFor("ollama")?.ok).toBe(false);
  });

  it("names the company that is saying no, not us", () => {
    expect(oauthAllowedFor("claude")?.reason).toMatch(/Anthropic/i);
    expect(oauthAllowedFor("openai")?.reason).toMatch(/OpenAI/i);
  });
});

describe("xAI device-code payloads", () => {
  it("reads the URL the browser should open", () => {
    const start = parseDeviceCodeStart({
      device_code: "dev-1",
      user_code: "ABCD-1234",
      verification_uri: "https://auth.x.ai/activate",
      verification_uri_complete: "https://auth.x.ai/activate?user_code=ABCD-1234",
      expires_in: 900,
      interval: 5,
    });
    expect(start.userCode).toBe("ABCD-1234");
    expect(start.url).toContain("auth.x.ai");
    expect(start.intervalMs).toBe(5000);
  });

  it("rejects a start payload that is missing the device code", () => {
    expect(() => parseDeviceCodeStart({ user_code: "X" })).toThrow(/device/i);
  });

  it("treats authorization_pending as wait, not failure", () => {
    const r = interpretDevicePoll(400, { error: "authorization_pending" });
    expect(r.status).toBe("pending");
  });

  it("returns tokens on 200", () => {
    const r = interpretDevicePoll(200, {
      access_token: "tok-a",
      refresh_token: "tok-r",
      expires_in: 3600,
      token_type: "Bearer",
    });
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.accessToken).toBe("tok-a");
      expect(r.refreshToken).toBe("tok-r");
    }
  });

  it("surfaces a 403 as a tier refusal, not a bad password", () => {
    const r = interpretDevicePoll(403, { error: "access_denied" });
    expect(r.status).toBe("denied");
    if (r.status === "denied") expect(r.message).toMatch(/SuperGrok|tier|API/i);
  });
});

describe("xAI token endpoint lock", () => {
  it("only posts refresh tokens to xAI", () => {
    expect(xaiTokenEndpointOk("https://auth.x.ai/oauth2/token")).toBe(true);
    expect(xaiTokenEndpointOk("https://evil.example/oauth2/token")).toBe(false);
    expect(xaiTokenEndpointOk("https://auth.x.ai.evil.example/oauth2/token")).toBe(false);
  });

  it("packs oauth tokens as json and still reads a leftover raw key", () => {
    const packed = packLlmSecret({
      kind: "oauth",
      access: "tok-a",
      refresh: "tok-r",
      expiresAt: 9,
    });
    expect(packed).toContain("\"oauth\"");
    expect(unpackLlmSecret(packed)).toEqual({
      kind: "oauth",
      access: "tok-a",
      refresh: "tok-r",
      expiresAt: 9,
    });
    expect(unpackLlmSecret("sk-legacy")).toEqual({ kind: "apikey", key: "sk-legacy" });
  });
});
