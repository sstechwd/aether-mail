import { describe, expect, it } from "vitest";
import { safeOpenUrl } from "./openurl.js";

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
