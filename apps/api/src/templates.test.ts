import { describe, expect, it } from "vitest";
import { TemplateBook } from "./templates.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("TemplateBook", () => {
  it("stores a local reply template without a marketplace", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-tpl-")), "templates.json");
    const book = new TemplateBook(file);
    const row = book.add({ name: "Short yes", subject: "Re: {{subject}}", body: "Works on my side — thanks." });
    expect(book.list()).toHaveLength(1);
    expect(row.body).toContain("Works");
    expect(book.remove(row.id)).toBe(true);
    expect(book.list()).toHaveLength(0);
  });
});
