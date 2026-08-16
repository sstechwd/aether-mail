import { describe, expect, it } from "vitest";
import { SecretVault } from "./vault.js";

describe("SecretVault", () => {
  it("evicts the oldest secret so RAM stays bounded", () => {
    const vault = new SecretVault(2);
    vault.put("a", "1");
    vault.put("b", "2");
    vault.put("c", "3");
    expect(vault.size).toBe(2);
    expect(vault.has("a")).toBe(false);
    expect(vault.get("c")).toBe("3");
  });
});
