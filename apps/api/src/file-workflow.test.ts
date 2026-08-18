import { describe, expect, it } from "vitest";
import { compileWorkflow } from "./workflows.js";
import { MailStore } from "./store.js";

describe("file-from-sender workflow", () => {
  it("compiles create folder Priya and move mail from her address", () => {
    const rule = compileWorkflow(
      "Messages from priya@example.com create a folder named Priya and move them there",
    );
    expect(rule.action).toBe("file");
    expect(rule.folder).toBe("Priya");
    expect(rule.matches({ subject: "Hi", from: "Priya Shah <priya@example.com>", body: "hello" })).toBe(
      true,
    );
  });

  it("store can create a user folder and move into it", () => {
    const store = MailStore.openMemory();
    store.loadFixture([
      {
        id: "m1",
        accountId: "fixture",
        folder: "INBOX",
        from: "Priya Shah <priya@example.com>",
        to: "you@localhost",
        subject: "Hi",
        date: "2026-08-16T00:00:00.000Z",
        unread: true,
        body: "hello",
      },
    ]);
    store.ensureFolder("fixture", "Priya");
    store.move("m1", "Priya");
    expect(store.listFolders("fixture").map((f) => f.name)).toContain("Priya");
    expect(store.listMessages("fixture", "Priya")[0].id).toBe("m1");
  });
});
