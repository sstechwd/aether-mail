import { describe, expect, it } from "vitest";
import { buildReply, buildForward, quoteBody } from "./reply.js";

const SRC = {
  id: "m1",
  from: "Priya Raman <priya@example.com>",
  to: "me@example.com",
  subject: "Q3 numbers",
  date: "2026-08-18T16:12:44Z",
  body: "Here are the numbers.\nLet me know.",
};

describe("buildReply", () => {
  it("addresses the sender, not the inbound To (which is me)", () => {
    const r = buildReply(SRC, { me: "me@example.com" });
    expect(r.to).toBe("priya@example.com");
    expect(r.to).not.toContain("me@example.com");
  });

  it("prefixes the subject once, never twice", () => {
    expect(buildReply(SRC, { me: "me@example.com" }).subject).toBe("Re: Q3 numbers");
    const already = buildReply({ ...SRC, subject: "Re: Q3 numbers" }, { me: "me@example.com" });
    expect(already.subject).toBe("Re: Q3 numbers");
    const lower = buildReply({ ...SRC, subject: "re: Q3 numbers" }, { me: "me@example.com" });
    expect(lower.subject).toBe("re: Q3 numbers");
  });

  it("quotes the original beneath an attribution line", () => {
    const r = buildReply(SRC, { me: "me@example.com" });
    expect(r.body).toContain("> Here are the numbers.");
    expect(r.body).toContain("> Let me know.");
    expect(r.body).toMatch(/wrote:/);
  });

  it("leaves room to type above the quote", () => {
    const r = buildReply(SRC, { me: "me@example.com" });
    expect(r.body.startsWith("\n")).toBe(true);
  });
});

describe("buildReply reply-all", () => {
  it("keeps the other recipients but drops me", () => {
    const src = { ...SRC, to: "me@example.com, ana@example.com", cc: "bob@example.com" };
    const r = buildReply(src, { me: "me@example.com", all: true });
    expect(r.to).toContain("priya@example.com");
    expect(r.cc).toContain("ana@example.com");
    expect(r.cc).toContain("bob@example.com");
    expect(r.cc).not.toContain("me@example.com");
  });

  it("does not duplicate the sender into cc", () => {
    const src = { ...SRC, to: "me@example.com, priya@example.com" };
    const r = buildReply(src, { me: "me@example.com", all: true });
    expect((r.cc ?? "").includes("priya@example.com")).toBe(false);
  });
});

describe("buildForward", () => {
  it("has no recipient — the human picks one", () => {
    const f = buildForward(SRC);
    expect(f.to).toBe("");
  });

  it("prefixes Fwd: once", () => {
    expect(buildForward(SRC).subject).toBe("Fwd: Q3 numbers");
    expect(buildForward({ ...SRC, subject: "Fwd: Q3 numbers" }).subject).toBe("Fwd: Q3 numbers");
  });

  it("includes the original headers so the recipient has context", () => {
    const f = buildForward(SRC);
    expect(f.body).toContain("Priya Raman");
    expect(f.body).toContain("Q3 numbers");
    expect(f.body).toContain("Here are the numbers.");
    expect(f.body).toMatch(/Forwarded message/i);
  });
});

describe("quoteBody", () => {
  it("prefixes every line, including empty ones", () => {
    expect(quoteBody("a\n\nb")).toBe("> a\n>\n> b");
  });

  it("caps runaway quotes so a reply cannot balloon", () => {
    const huge = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const out = quoteBody(huge, 50);
    expect(out.split("\n").length).toBeLessThanOrEqual(51);
    expect(out).toMatch(/trimmed/i);
  });
});
