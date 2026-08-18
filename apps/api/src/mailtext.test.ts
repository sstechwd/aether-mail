import { describe, expect, it } from "vitest";
import { readableBody, toIsoDate } from "./mailtext.js";

describe("mailtext", () => {
  it("parses RFC822 dates so newest-first sort works", () => {
    expect(toIsoDate("Wed, 12 Mar 2025 09:14:00 -0700").startsWith("2025-03-12")).toBe(true);
    expect(toIsoDate("not a date")).toMatch(/^\d{4}-/);
  });

  it("strips HTML so Gmail bodies are readable", () => {
    const raw = "<html><body><div>Hi Priya</div><br>See you Friday</body></html>";
    const text = readableBody(raw);
    expect(text).toContain("Hi Priya");
    expect(text).toContain("See you Friday");
    expect(text.toLowerCase()).not.toContain("<html");
    expect(text).not.toContain("<div>");
  });
});
