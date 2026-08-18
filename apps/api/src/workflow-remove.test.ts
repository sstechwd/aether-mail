import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileWorkflow, WorkflowBook } from "./workflows.js";

describe("WorkflowBook.remove", () => {
  it("forgets a taught rule", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-wf-")), "wf.json");
    const book = new WorkflowBook(file);
    const rule = book.add(compileWorkflow("star invoices"));
    expect(book.publicList()).toHaveLength(1);
    expect(book.remove(rule.id)).toBe(true);
    expect(book.publicList()).toHaveLength(0);
    expect(book.remove("nope")).toBe(false);
  });
});
