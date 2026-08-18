import { describe, expect, it } from "vitest";
import { applyWorkflows, compileWorkflow, WorkflowBook } from "./workflows.js";

describe("compileWorkflow", () => {
  it("compiles star invoices from plain English", () => {
    const rule = compileWorkflow("star invoices and bills");
    expect(rule.action).toBe("star");
    expect(rule.auto).toBe(true);
    expect(rule.matches({ subject: "Invoice #12", from: "ap@x.com", body: "due" })).toBe(true);
    expect(rule.matches({ subject: "Hi", from: "a@b.c", body: "hello" })).toBe(false);
  });

  it("compiles archive newsletters", () => {
    const rule = compileWorkflow("archive newsletters and weekly digests");
    expect(rule.action).toBe("archive");
    expect(rule.matches({ subject: "Rust Weekly newsletter", from: "news@x.com", body: "unsubscribe" })).toBe(
      true,
    );
  });

  it("compiles keep invoices unread", () => {
    const rule = compileWorkflow("keep invoices unread");
    expect(rule.action).toBe("keep");
    expect(rule.matches({ subject: "Invoice #9", from: "ap@x.com", body: "due" })).toBe(true);
  });

  it("refuses to compile a send or delete workflow", () => {
    expect(() => compileWorkflow("when mail arrives, send a reply and delete it")).toThrow(/never/i);
  });
});

describe("applyWorkflows", () => {
  it("stars matching mail and does not send", () => {
    const book = new WorkflowBook();
    book.add(compileWorkflow("star invoices"));
    const out = applyWorkflows(book.list(), {
      id: "m1",
      subject: "Invoice due Friday",
      from: "billing@acme.test",
      body: "please pay",
    });
    expect(out.apply).toEqual(["star"]);
    expect(out.apply).not.toContain("send");
  });
});
