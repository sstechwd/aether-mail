import { describe, expect, it } from "vitest";
import { allowOrigin, rejectCrossSite } from "./security.js";

/**
 * The packaged Tauri app does not run on the Vite dev server, so its requests
 * carry a different Origin. Rejecting it broke every API call in the shipped
 * app: fetch fell through to the asset handler and the UI got index.html back
 * ("Unexpected token '<', \"<!DOCTYPE \"...").
 */
describe("allowOrigin — packaged app", () => {
  it("allows the Tauri webview origin on Windows", () => {
    expect(allowOrigin("http://tauri.localhost")).toBe("http://tauri.localhost");
  });

  it("allows the https form used by some Tauri builds", () => {
    expect(allowOrigin("https://tauri.localhost")).toBe("https://tauri.localhost");
  });

  it("still allows the dev server", () => {
    expect(allowOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(allowOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("still refuses a hostile site", () => {
    expect(allowOrigin("https://evil.example")).toBeNull();
    expect(rejectCrossSite("https://evil.example")).toBe(true);
  });

  it("does not treat a lookalike host as trusted", () => {
    expect(allowOrigin("http://tauri.localhost.evil.example")).toBeNull();
    expect(allowOrigin("http://nottauri.localhost")).toBeNull();
  });

  it("allows a request with no Origin header (same-origin / curl)", () => {
    expect(rejectCrossSite(undefined)).toBe(false);
  });
});
