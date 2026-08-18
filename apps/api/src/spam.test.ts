import { describe, expect, it } from "vitest";
import { compileWorkflow } from "./workflows.js";
import { MailStore } from "./store.js";

describe("spam folder", () => {
  it("compiles move newsletters to spam", () => {
    const rule = compileWorkflow("move newsletters to spam");
    expect(rule.action).toBe("file");
    expect(rule.folder?.toLowerCase()).toBe("spam");
  });

  it("ensures Spam exists as a real folder", () => {
    const store = MailStore.openMemory();
    store.ensureFolder("fixture", "Spam");
    expect(store.listFolders("fixture").map((f) => f.name)).toContain("Spam");
  });
});
