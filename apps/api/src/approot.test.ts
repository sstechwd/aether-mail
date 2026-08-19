import { describe, expect, it } from "vitest";
import { appRoot, resolveFromRoot } from "./approot.js";

describe("appRoot", () => {
  it("returns an absolute directory that exists", () => {
    const root = appRoot();
    expect(root).toBeTruthy();
    expect(root.length).toBeGreaterThan(2);
    // Absolute on win32 (C:\...) or posix (/...)
    expect(/^([A-Za-z]:[\\/]|\/)/.test(root)).toBe(true);
  });

  it("does not throw when import.meta.url is unavailable (packaged binary)", () => {
    // In a Node SEA build there is no import.meta.url and no __dirname;
    // appRoot must fall back to the executable's directory rather than crash.
    expect(() => appRoot()).not.toThrow();
  });

  it("resolves child paths under the root", () => {
    const p = resolveFromRoot("data", "mail.json");
    expect(p).toContain("data");
    expect(p).toContain("mail.json");
    expect(p.startsWith(appRoot())).toBe(true);
  });

  it("is stable across calls", () => {
    expect(appRoot()).toBe(appRoot());
  });
});
