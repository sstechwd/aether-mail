import { describe, expect, it } from "vitest";
import { canonicalFolder, pickSyncFolders, FOLDER_ORDER, safeMoveFolder } from "./folders.js";

/**
 * IMAP folder names are provider-specific. Gmail uses "[Gmail]/Sent Mail",
 * Outlook uses "Sent Items", others just "Sent". The UI should show one
 * consistent set of names regardless of who hosts the mailbox.
 */
describe("canonicalFolder", () => {
  it("maps Gmail's namespaced names", () => {
    expect(canonicalFolder("[Gmail]/Sent Mail")).toBe("Sent");
    expect(canonicalFolder("[Gmail]/Drafts")).toBe("Drafts");
    expect(canonicalFolder("[Gmail]/Trash")).toBe("Trash");
    expect(canonicalFolder("[Gmail]/Spam")).toBe("Spam");
    expect(canonicalFolder("[Gmail]/All Mail")).toBe("Archive");
  });

  it("maps Outlook and generic names", () => {
    expect(canonicalFolder("Sent Items")).toBe("Sent");
    expect(canonicalFolder("Deleted Items")).toBe("Trash");
    expect(canonicalFolder("Junk Email")).toBe("Spam");
    expect(canonicalFolder("Sent")).toBe("Sent");
    expect(canonicalFolder("Drafts")).toBe("Drafts");
  });

  it("is case-insensitive", () => {
    expect(canonicalFolder("SENT")).toBe("Sent");
    expect(canonicalFolder("inbox")).toBe("INBOX");
  });

  it("keeps INBOX as INBOX", () => {
    expect(canonicalFolder("INBOX")).toBe("INBOX");
  });

  it("passes through a user's own folder untouched", () => {
    expect(canonicalFolder("Receipts")).toBe("Receipts");
    expect(canonicalFolder("Work/Clients")).toBe("Work/Clients");
  });
});

describe("pickSyncFolders", () => {
  it("chooses the real IMAP names for the folders we care about", () => {
    const available = [
      "INBOX",
      "[Gmail]/All Mail",
      "[Gmail]/Sent Mail",
      "[Gmail]/Drafts",
      "[Gmail]/Trash",
      "[Gmail]/Spam",
      "Receipts",
    ];
    const picked = pickSyncFolders(available);
    expect(picked).toContainEqual({ remote: "INBOX", canonical: "INBOX" });
    expect(picked).toContainEqual({ remote: "[Gmail]/Sent Mail", canonical: "Sent" });
    expect(picked).toContainEqual({ remote: "[Gmail]/Drafts", canonical: "Drafts" });
    expect(picked).toContainEqual({ remote: "[Gmail]/Trash", canonical: "Trash" });
  });

  it("always includes INBOX even if the server did not list it", () => {
    expect(pickSyncFolders([])).toContainEqual({ remote: "INBOX", canonical: "INBOX" });
  });

  it("does not sync the same canonical folder twice", () => {
    const picked = pickSyncFolders(["Sent", "[Gmail]/Sent Mail"]);
    const sents = picked.filter((p) => p.canonical === "Sent");
    expect(sents).toHaveLength(1);
  });

  /**
   * Real mailbox, real bug: this account has BOTH a stray top-level "Sent"
   * (empty, left over from another client) and Gmail's real
   * "[Gmail]/Sent Mail". Picking the first match alphabetically chose the empty
   * one and Sent showed zero messages.
   */
  it("prefers the provider's own namespaced folder over a stray lookalike", () => {
    const picked = pickSyncFolders(["INBOX", "Sent", "[Gmail]/Sent Mail", "[Gmail]/Trash"]);
    const sent = picked.find((p) => p.canonical === "Sent");
    expect(sent?.remote).toBe("[Gmail]/Sent Mail");
  });

  it("still uses a plain name when there is no namespaced alternative", () => {
    const picked = pickSyncFolders(["INBOX", "Sent"]);
    expect(picked.find((p) => p.canonical === "Sent")?.remote).toBe("Sent");
  });

  it("skips a user's custom folders — those are opt-in, not automatic", () => {
    const picked = pickSyncFolders(["INBOX", "Receipts", "Work"]);
    expect(picked.map((p) => p.canonical)).not.toContain("Receipts");
  });
});

describe("FOLDER_ORDER", () => {
  it("puts the folders a person checks first at the top", () => {
    expect(FOLDER_ORDER.indexOf("INBOX")).toBe(0);
    expect(FOLDER_ORDER.indexOf("Outbox")).toBeLessThan(FOLDER_ORDER.indexOf("Trash"));
    expect(FOLDER_ORDER).toContain("Sent");
    expect(FOLDER_ORDER).toContain("Drafts");
  });
});

describe("safeMoveFolder", () => {
  it("accepts any mailbox folder, not just Inbox/Archive/Trash", () => {
    expect(safeMoveFolder("Receipts")).toBe("Receipts");
    expect(safeMoveFolder("INBOX")).toBe("INBOX");
    expect(safeMoveFolder("Archive")).toBe("Archive");
  });

  it("refuses a path or an empty name", () => {
    expect(safeMoveFolder("../etc")).toBeNull();
    expect(safeMoveFolder("")).toBeNull();
    expect(safeMoveFolder("a/b")).toBeNull();
  });
});
