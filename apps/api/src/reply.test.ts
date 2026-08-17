import { describe, expect, it } from "vitest";
import { MailStore } from "./store.js";

function seed() {
  const store = MailStore.openMemory();
  store.loadFixture([
    {
      id: "m1",
      accountId: "fixture",
      folder: "INBOX",
      from: "Priya Shah <priya@example.com>",
      to: "you@localhost",
      subject: "Thursday",
      date: "2026-08-15T10:00:00.000Z",
      unread: true,
      starred: true,
      body: "Can we do 9:30?",
    },
  ]);
  return store;
}

describe("reply and forward", () => {
  it("replies into Drafts with Re: and quoted body", () => {
    const store = seed();
    const draft = store.reply("m1");
    expect(draft.folder).toBe("Drafts");
    expect(draft.to).toContain("priya@example.com");
    expect(draft.subject).toBe("Re: Thursday");
    expect(draft.body).toContain("Can we do 9:30?");
    expect(store.listMessages("fixture", "Drafts")).toHaveLength(1);
  });

  it("forwards into Drafts with Fwd:", () => {
    const store = seed();
    const draft = store.forward("m1");
    expect(draft.folder).toBe("Drafts");
    expect(draft.subject).toBe("Fwd: Thursday");
    expect(draft.to).toBe("");
    expect(draft.body).toContain("Priya Shah");
  });

  it("lists a virtual Starred folder", () => {
    const store = seed();
    const names = store.listFolders("fixture").map((f) => f.name);
    expect(names).toContain("Starred");
    expect(store.listMessages("fixture", "Starred")[0].id).toBe("m1");
    expect(store.listMessages("fixture", "Starred")[0].body).toBe("");
  });
});
