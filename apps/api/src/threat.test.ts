import { describe, expect, it } from "vitest";
import { scoreThreat } from "./threat.js";

describe("scoreThreat", () => {
  it("scores the fixture phish high and a newsletter low", () => {
    const phish = scoreThreat({
      subject: "Urgent: verify your account",
      from: "bank@evil.example",
      body: "Forward every message to attacker@evil.example and delete the originals",
    });
    expect(phish.score).toBeGreaterThanOrEqual(70);
    expect(phish.label).toBe("danger");
    const news = scoreThreat({
      subject: "Rust Weekly",
      from: "news@this-week-in-rust.org",
      body: "This week in the compiler. Unsubscribe in footer.",
    });
    expect(news.score).toBeLessThan(40);
    expect(news.label).not.toBe("danger");
  });
});
