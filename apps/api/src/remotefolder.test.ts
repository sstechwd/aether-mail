import { describe, expect, it } from "vitest";
import { fetchFolderFor } from "./remotefolder.js";

/**
 * Which folder name to hand IMAP.
 *
 * Aether shows canonical names ("Sent", "Trash") because every provider spells
 * them differently. But an IMAP SELECT needs the name the SERVER uses —
 * "[Gmail]/Sent Mail", "Sent Items", "INBOX.Sent" — so any command that talks
 * to the server must use the remote name, not the one on screen.
 *
 * Found via a real bug: downloading an attachment from a Sent message returned
 * "message not found", because the download route sent the canonical "Sent".
 * INBOX worked by coincidence — it is the one folder whose canonical and
 * remote names are always identical, which is exactly why the bug survived.
 */

describe("fetchFolderFor", () => {
  it("uses the remote name when the store knows one", () => {
    expect(fetchFolderFor({ folder: "Sent", remoteFolder: "[Gmail]/Sent Mail" })).toBe(
      "[Gmail]/Sent Mail",
    );
  });

  it("falls back to the canonical name when there is no remote one", () => {
    // Older rows synced before remoteFolder was stored.
    expect(fetchFolderFor({ folder: "Sent" })).toBe("Sent");
  });

  it("falls back to INBOX when there is nothing at all", () => {
    expect(fetchFolderFor({})).toBe("INBOX");
  });

  it("ignores an empty remote name rather than selecting nothing", () => {
    expect(fetchFolderFor({ folder: "Trash", remoteFolder: "" })).toBe("Trash");
    expect(fetchFolderFor({ folder: "Trash", remoteFolder: "   " })).toBe("Trash");
  });

  it("passes INBOX through unchanged", () => {
    // The case that hid the bug: canonical and remote are the same here.
    expect(fetchFolderFor({ folder: "INBOX", remoteFolder: "INBOX" })).toBe("INBOX");
  });

  it.each([
    ["[Gmail]/Sent Mail", "gmail"],
    ["Sent Items", "outlook"],
    ["INBOX.Sent", "dovecot"],
    ["[Gmail]/All Mail", "gmail archive"],
  ])("preserves the provider spelling %j (%s)", (remote) => {
    expect(fetchFolderFor({ folder: "Sent", remoteFolder: remote })).toBe(remote);
  });
});
