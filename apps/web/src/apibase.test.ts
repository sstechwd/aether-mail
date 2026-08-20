import { describe, expect, it } from "vitest";
import { apiUrl } from "./apibase.js";

/**
 * In dev, Vite proxies /api -> 127.0.0.1:8787, so a relative URL works.
 * In the packaged app there is NO proxy: a relative URL resolves against the
 * Tauri asset origin and returns index.html, which is why every call failed
 * with: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 */
describe("apiUrl", () => {
  it("keeps relative paths when a dev proxy is present", () => {
    expect(apiUrl("/api/health", { packaged: false })).toBe("/api/health");
  });

  it("makes paths absolute in the packaged app", () => {
    expect(apiUrl("/api/health", { packaged: true })).toBe("http://127.0.0.1:8787/api/health");
  });

  it("preserves query strings", () => {
    expect(apiUrl("/api/messages?folder=INBOX", { packaged: true })).toBe(
      "http://127.0.0.1:8787/api/messages?folder=INBOX",
    );
  });

  it("does not double-prefix an already absolute url", () => {
    expect(apiUrl("http://127.0.0.1:8787/api/health", { packaged: true })).toBe(
      "http://127.0.0.1:8787/api/health",
    );
  });

  it("handles a path without a leading slash", () => {
    expect(apiUrl("api/health", { packaged: true })).toBe("http://127.0.0.1:8787/api/health");
  });
});
