import { describe, expect, it } from "vitest";
import { safeOpenUrl, windowsStartArgs } from "./openurl.js";

describe("safeOpenUrl", () => {
  it("allows ordinary https and mailto", () => {
    expect(safeOpenUrl("https://example.com/path")).toBe(true);
    expect(safeOpenUrl("http://example.com")).toBe(true);
    expect(safeOpenUrl("mailto:a@b.c")).toBe(true);
  });

  it("refuses javascript, file, and credentialed urls", () => {
    expect(safeOpenUrl("javascript:alert(1)")).toBe(false);
    expect(safeOpenUrl("file:///C:/Windows/notepad.exe")).toBe(false);
    expect(safeOpenUrl("https://user:pass@evil.example/")).toBe(false);
    expect(safeOpenUrl("")).toBe(false);
  });
});

describe("windowsStartArgs", () => {
  it("keeps tracking query strings with & as one start target", () => {
    const url = "https://shop.example/buy?utm=1&id=2";
    const args = windowsStartArgs(url);
    expect(args[0]).toBe("/c");
    expect(args.join(" ")).toContain("utm=1");
    expect(args.join(" ")).toContain("id=2");
    const urlArg = args[args.length - 1];
    expect(urlArg.startsWith('"') || urlArg.includes("^&")).toBe(true);
  });
});
