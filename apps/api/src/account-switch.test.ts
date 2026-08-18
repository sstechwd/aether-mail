import { describe, expect, it } from "vitest";
import { resolveAccountSwitch } from "./account-switch.js";

describe("resolveAccountSwitch", () => {
  it("accepts fixture or a saved account and rejects unknown ids", () => {
    expect(resolveAccountSwitch({ requested: "fixture", fixtureId: "fixture", savedIds: ["acc-gmail"] })).toBe("fixture");
    expect(resolveAccountSwitch({ requested: "acc-gmail", fixtureId: "fixture", savedIds: ["acc-gmail"] })).toBe("acc-gmail");
    expect(resolveAccountSwitch({ requested: "nope", fixtureId: "fixture", savedIds: ["acc-gmail"] })).toBeNull();
  });
});
