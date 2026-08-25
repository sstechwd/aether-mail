import { describe, expect, it } from "vitest";
import { parseUserCommand } from "./user-command.js";

/**
 * Commands the USER types in chat. These run now.
 *
 * Mail-body instructions still cannot act. This parser is only for the
 * chat box, which is the user, not the sender of a message.
 */

describe("parseUserCommand", () => {
  it("creates a mail folder from ordinary English", () => {
    const a = parseUserCommand("make a folder called Receipts");
    expect(a).toEqual({ action: "create_folder", name: "Receipts" });
    expect(parseUserCommand("create a folder named Amazon")).toEqual({
      action: "create_folder",
      name: "Amazon",
    });
    expect(parseUserCommand("make a folder Receipts")).toEqual({
      action: "create_folder",
      name: "Receipts",
    });
  });

  it("asks for a name instead of guessing", () => {
    expect(parseUserCommand("make a folder")).toEqual({ action: "need_folder_name" });
    expect(parseUserCommand("create a folder")).toEqual({ action: "need_folder_name" });
  });

  it("will not create a desktop or disk folder", () => {
    expect(parseUserCommand("create a folder on my desktop")).toEqual({ action: "refuse_filesystem" });
    expect(parseUserCommand("make a folder C:\\Temp")).toEqual({ action: "refuse_filesystem" });
    expect(parseUserCommand("make a folder ../etc")).toEqual({ action: "refuse_filesystem" });
  });

  it("creates a filing rule from ordinary English", () => {
    const r = parseUserCommand("make a rule that files amazon to Receipts");
    expect(r).toEqual({
      action: "create_rule",
      field: "from",
      contains: "amazon",
      then: "move",
      folder: "Receipts",
    });
    expect(parseUserCommand("file mail from billing@store.test into Bills")).toEqual({
      action: "create_rule",
      field: "from",
      contains: "billing@store.test",
      then: "move",
      folder: "Bills",
    });
  });

  it("leaves normal chat alone", () => {
    expect(parseUserCommand("summarize this")).toBeNull();
    expect(parseUserCommand("what is this email about")).toBeNull();
  });

  it("still cannot send or delete", () => {
    expect(parseUserCommand("make a rule that deletes amazon")).toBeNull();
    expect(parseUserCommand("send a reply to everyone")).toBeNull();
  });

  it("moves the open message to a named folder", () => {
    expect(parseUserCommand("move this to Receipts")).toEqual({ action: "move_open", folder: "Receipts" });
    expect(parseUserCommand("put this in Archive")).toEqual({ action: "move_open", folder: "Archive" });
    expect(parseUserCommand("file this to Bills")).toEqual({ action: "move_open", folder: "Bills" });
  });

  it("makes a rule from the open sender", () => {
    expect(parseUserCommand("always file this sender to Receipts")).toEqual({
      action: "rule_from_open",
      then: "move",
      folder: "Receipts",
    });
    expect(parseUserCommand("always put mail like this in Bills")).toEqual({
      action: "rule_from_open",
      then: "move",
      folder: "Bills",
    });
  });
});
