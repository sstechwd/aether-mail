import { describe, expect, it } from "vitest";
import { allowOrigin, publicAccount, rejectCrossSite } from "./security.js";

describe("security", () => {
  it("allows only the local Vite origins", () => {
    expect(allowOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(allowOrigin("https://evil.example")).toBeNull();
    expect(rejectCrossSite("https://evil.example")).toBe(true);
    expect(rejectCrossSite(undefined)).toBe(false);
  });

  it("strips secret_ref from API payloads", () => {
    const pub = publicAccount({ id: "acc-1", email: "a@b.c", secret_ref: "memory:acc-1" });
    expect(pub).toEqual({ id: "acc-1", email: "a@b.c" });
    expect(JSON.stringify(pub)).not.toContain("memory:");
  });
});
