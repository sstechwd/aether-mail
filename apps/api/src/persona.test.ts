import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PersonaBook } from "./persona.js";

describe("PersonaBook", () => {
  it("keeps at most 8 samples and never stores empty fluff", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-persona-")), "persona.json");
    const book = new PersonaBook(file);
    expect(() => book.add("too short")).toThrow(/longer/);
    book.add("Hey Priya — Thursday 9:30 works on my side. See you then. —S");
    expect(book.read().samples).toHaveLength(1);
    expect(book.promptBlock()).toContain("Thursday");
  });
});
