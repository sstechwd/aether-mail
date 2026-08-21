import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqlStore } from "./sqlstore.js";

/**
 * SQLite-backed mail storage.
 *
 * The JSON store loads every message — bodies, HTML, the lot — into memory at
 * startup and rewrites the whole file on any change. Measured on the live
 * mailbox: 8.0 MB for 246 messages, so roughly 325 MB at 10,000. That is the
 * difference between a demo and something a stranger can adopt.
 *
 * This must be a drop-in for the JSON store's interface, so the API does not
 * need rewriting around it, and it must carry existing data across without
 * losing anything.
 */

function freshDb(): string {
  return join(mkdtempSync(join(tmpdir(), "aether-sql-")), "mail.db");
}

const MSG = {
  id: "m1",
  accountId: "acc-1",
  folder: "INBOX",
  from: "Priya <priya@example.com>",
  to: "me@example.com",
  subject: "Quarterly numbers",
  date: "2026-08-20T10:00:00Z",
  unread: true,
  body: "The Q3 figures are attached for review.",
  headers: "From: priya@example.com",
};

describe("SqlStore", () => {
  let store: SqlStore;
  beforeEach(() => {
    store = SqlStore.openFile(freshDb());
  });

  it("starts empty", () => {
    expect(store.listMessages("acc-1", "INBOX")).toHaveLength(0);
  });

  it("stores and reads a message back whole", () => {
    store.loadFixture([MSG]);
    const got = store.getMessage("m1");
    expect(got?.subject).toBe("Quarterly numbers");
    expect(got?.body).toContain("Q3 figures");
    expect(got?.unread).toBe(true);
  });

  it("upserts rather than duplicating on re-sync", () => {
    store.loadFixture([MSG]);
    store.loadFixture([{ ...MSG, subject: "Quarterly numbers (v2)" }]);
    expect(store.listMessages("acc-1", "INBOX")).toHaveLength(1);
    expect(store.getMessage("m1")?.subject).toBe("Quarterly numbers (v2)");
  });

  it("does not clobber a local read/starred state on re-sync", () => {
    // IMAP re-delivers the same message; losing local flags every sync makes
    // "mark read" feel broken.
    store.loadFixture([MSG]);
    store.markRead("m1");
    store.setStarred("m1", true);
    store.loadFixture([MSG]);
    const got = store.getMessage("m1");
    expect(got?.unread).toBe(false);
    expect(got?.starred).toBe(true);
  });

  it("lists newest first by default", () => {
    store.loadFixture([
      { ...MSG, id: "old", date: "2026-08-18T10:00:00Z" },
      { ...MSG, id: "new", date: "2026-08-20T10:00:00Z" },
    ]);
    expect(store.listMessages("acc-1", "INBOX").map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("lists oldest first when asked", () => {
    store.loadFixture([
      { ...MSG, id: "old", date: "2026-08-18T10:00:00Z" },
      { ...MSG, id: "new", date: "2026-08-20T10:00:00Z" },
    ]);
    expect(store.listMessages("acc-1", "INBOX", "oldest").map((m) => m.id)).toEqual(["old", "new"]);
  });

  it("keeps bodies out of the list query", () => {
    // The list pane only needs envelopes. Pulling every body to render 40 rows
    // is what made the JSON store expensive. Body is typed as a string for
    // callers, so the list path returns it empty rather than absent.
    store.loadFixture([MSG]);
    const row = store.listMessages("acc-1", "INBOX")[0];
    expect(row.subject).toBe("Quarterly numbers");
    expect(row.body).toBe("");
    // …and the full fetch still has it.
    expect(store.getMessage("m1")?.body).toContain("Q3 figures");
  });

  it("summarises folders with unread counts", () => {
    store.loadFixture([
      MSG,
      { ...MSG, id: "m2", unread: false },
      { ...MSG, id: "m3", folder: "Sent", unread: false },
    ]);
    const folders = store.listFolders("acc-1");
    const inbox = folders.find((f) => f.name === "INBOX");
    expect(inbox?.total).toBe(2);
    expect(inbox?.unread).toBe(1);
    expect(folders.find((f) => f.name === "Sent")?.total).toBe(1);
  });

  it("moves a message between folders", () => {
    store.loadFixture([MSG]);
    store.move("m1", "Archive");
    expect(store.listMessages("acc-1", "INBOX")).toHaveLength(0);
    expect(store.listMessages("acc-1", "Archive")).toHaveLength(1);
  });

  it("marks a whole folder read", () => {
    store.loadFixture([MSG, { ...MSG, id: "m2" }]);
    store.markFolderRead("acc-1", "INBOX");
    expect(store.listFolders("acc-1").find((f) => f.name === "INBOX")?.unread).toBe(0);
  });

  describe("search", () => {
    beforeEach(() => {
      store.loadFixture([
        MSG,
        { ...MSG, id: "m2", subject: "Lunch plans", body: "That new place on Tuesday" },
      ]);
    });

    it("finds by subject", () => {
      expect(store.search("acc-1", "quarterly").map((m) => m.id)).toEqual(["m1"]);
    });

    it("finds by body text", () => {
      expect(store.search("acc-1", "Tuesday").map((m) => m.id)).toEqual(["m2"]);
    });

    it("finds by sender", () => {
      expect(store.search("acc-1", "priya").length).toBeGreaterThan(0);
    });

    it("is case-insensitive", () => {
      expect(store.search("acc-1", "QUARTERLY")).toHaveLength(1);
    });

    it("returns nothing for a term that is not there", () => {
      expect(store.search("acc-1", "zzzznotpresent")).toHaveLength(0);
    });

    it("finds every message containing a common word", () => {
      // Caught on the real mailbox: 153 messages contained "the" but search
      // returned 4. The prefix-quoting scheme was silently matching almost
      // nothing. A search that quietly returns 3% of the truth is worse than
      // one that errors, because you believe it.
      store.loadFixture([
        { ...MSG, id: "c1", body: "the first thing" },
        { ...MSG, id: "c2", body: "and the second thing" },
        { ...MSG, id: "c3", body: "nothing relevant here" },
      ]);
      expect(store.search("acc-1", "the").length).toBeGreaterThanOrEqual(2);
    });

    it("matches a word prefix, so typing half a word still finds it", () => {
      store.loadFixture([{ ...MSG, id: "p1", body: "the quarterly review meeting" }]);
      expect(store.search("acc-1", "quarter").some((m) => m.id === "p1")).toBe(true);
    });

    it("requires all terms, so two words narrow rather than widen", () => {
      store.loadFixture([
        { ...MSG, id: "t1", subject: "alpha beta" },
        { ...MSG, id: "t2", subject: "alpha only" },
      ]);
      const hits = store.search("acc-1", "alpha beta").map((m) => m.id);
      expect(hits).toContain("t1");
      expect(hits).not.toContain("t2");
    });

    it("does not crash on FTS5 punctuation a user might type", () => {
      // A bare quote or AND/OR is a syntax error in FTS5 MATCH. A search box
      // must never 500 because someone typed an apostrophe.
      for (const q of ['"', "a AND", "OR", "*", "foo(", "it's", "-"]) {
        expect(() => store.search("acc-1", q)).not.toThrow();
      }
    });

    it("keeps one account's mail out of another's results", () => {
      store.loadFixture([{ ...MSG, id: "other", accountId: "acc-2", subject: "quarterly leak" }]);
      expect(store.search("acc-1", "quarterly").every((m) => m.id !== "other")).toBe(true);
    });
  });

  describe("migration from the JSON store", () => {
    it("carries every message across", () => {
      const dir = mkdtempSync(join(tmpdir(), "aether-mig-"));
      const jsonPath = join(dir, "mail.json");
      writeFileSync(jsonPath, JSON.stringify([MSG, { ...MSG, id: "m2", folder: "Sent" }]), "utf8");

      const migrated = SqlStore.openFile(join(dir, "mail.db"), jsonPath);
      expect(migrated.getMessage("m1")?.subject).toBe("Quarterly numbers");
      expect(migrated.listMessages("acc-1", "Sent")).toHaveLength(1);
    });

    it("does not re-import on the second open", () => {
      const dir = mkdtempSync(join(tmpdir(), "aether-mig-"));
      const jsonPath = join(dir, "mail.json");
      const dbPath = join(dir, "mail.db");
      writeFileSync(jsonPath, JSON.stringify([MSG]), "utf8");

      const first = SqlStore.openFile(dbPath, jsonPath);
      first.move("m1", "Archive");
      first.close();

      // Re-importing would drag the message back to INBOX and undo the user's
      // action every single startup.
      const second = SqlStore.openFile(dbPath, jsonPath);
      expect(second.getMessage("m1")?.folder).toBe("Archive");
    });

    it("survives a corrupt JSON file rather than refusing to start", () => {
      const dir = mkdtempSync(join(tmpdir(), "aether-mig-"));
      const jsonPath = join(dir, "mail.json");
      writeFileSync(jsonPath, "{ not json", "utf8");
      expect(() => SqlStore.openFile(join(dir, "mail.db"), jsonPath)).not.toThrow();
    });
  });

  it("persists across a reopen", () => {
    const path = freshDb();
    const first = SqlStore.openFile(path);
    first.loadFixture([MSG]);
    first.close();
    expect(SqlStore.openFile(path).getMessage("m1")?.subject).toBe("Quarterly numbers");
  });

  describe("drafting", () => {
    beforeEach(() => {
      store.loadFixture([MSG]);
    });

    it("composes a draft into the Drafts folder", () => {
      const draft = store.compose({
        accountId: "acc-1",
        to: "them@example.com",
        subject: "Hello",
        body: "text",
      });
      expect(draft.folder).toBe("Drafts");
      expect(store.getMessage(draft.id)?.subject).toBe("Hello");
    });

    it("a reply addresses the sender and keeps the subject threaded", () => {
      const draft = store.reply("m1");
      expect(draft.to).toContain("priya@example.com");
      expect(draft.subject.toLowerCase()).toContain("re:");
      // Quoting the original is what makes a reply readable in the thread.
      expect(draft.body).toContain("Q3 figures");
    });

    it("does not double up the Re: prefix on a reply to a reply", () => {
      store.loadFixture([{ ...MSG, id: "r1", subject: "Re: Quarterly numbers" }]);
      expect(store.reply("r1").subject).toBe("Re: Quarterly numbers");
    });

    it("a forward keeps the body but leaves the recipient empty", () => {
      const draft = store.forward("m1");
      expect(draft.subject.toLowerCase()).toContain("fwd:");
      expect(draft.to).toBe("");
      expect(draft.body).toContain("Q3 figures");
    });

    it("throws rather than inventing a draft for a message that is gone", () => {
      expect(() => store.reply("nope")).toThrow();
    });
  });

  it("ensureFolder makes an empty folder visible", () => {
    store.loadFixture([MSG]);
    store.ensureFolder("acc-1", "Archive");
    expect(store.listFolders("acc-1").some((f) => f.name === "Archive")).toBe(true);
  });

  describe("removeFolder", () => {
    it("removes an empty folder the user created", () => {
      store.loadFixture([MSG]);
      store.ensureFolder("acc-1", "Scratch");
      expect(store.removeFolder("acc-1", "Scratch")).toBe(true);
      expect(store.listFolders("acc-1").some((f) => f.name === "Scratch")).toBe(false);
    });

    it("refuses to remove a folder that still holds mail", () => {
      // Deleting a folder must never be a way to lose messages by accident.
      store.loadFixture([MSG]);
      expect(store.removeFolder("acc-1", "INBOX")).toBe(false);
      expect(store.listMessages("acc-1", "INBOX")).toHaveLength(1);
    });

    it("refuses to remove a standard mail folder even when empty", () => {
      // A user who deletes Sent or Trash has broken their client, not tidied
      // it — those are recreated by the server on the next sync anyway.
      store.ensureFolder("acc-1", "Trash");
      expect(store.removeFolder("acc-1", "Trash")).toBe(false);
      expect(store.removeFolder("acc-1", "INBOX")).toBe(false);
      expect(store.removeFolder("acc-1", "Sent")).toBe(false);
    });

    it("returns false for a folder that does not exist", () => {
      expect(store.removeFolder("acc-1", "Nope")).toBe(false);
    });
  });
});
