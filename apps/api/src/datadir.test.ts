import { describe, expect, it } from "vitest";
import { chooseDataDir } from "./datadir.js";

/**
 * Where the user's mail actually lives.
 *
 * Until now `data/` sat next to the executable. That works in the repo, but a
 * real install puts it inside the program directory — so an uninstall or a
 * reinstall can take the mailbox with it, and on a per-machine install the
 * directory is not even writable.
 *
 * Mail is user data. It belongs in the OS location for user data, and the
 * program directory should hold only the program.
 *
 * This is a pure function so the macOS and Linux rules can be tested from
 * Windows — the alternative is three platforms of untested string joining.
 */

const NONE = () => false;

describe("chooseDataDir", () => {
  it("keeps using the repo data/ when running from a source tree", () => {
    // Dev must not change behaviour: the working mailbox is there.
    const got = chooseDataDir({
      appRoot: "C:\\src\\aether-mail",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      exists: (p) => p.includes("apps"),
    });
    expect(got.dir).toBe("C:\\src\\aether-mail\\data");
    expect(got.source).toBe("source-tree");
  });

  it("uses %APPDATA% on Windows when installed", () => {
    const got = chooseDataDir({
      appRoot: "C:\\Users\\x\\AppData\\Local\\Programs\\Aether Mail",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      exists: NONE,
    });
    expect(got.dir).toBe("C:\\Users\\x\\AppData\\Roaming\\Aether Mail");
    expect(got.source).toBe("os");
  });

  it("uses Application Support on macOS", () => {
    const got = chooseDataDir({
      appRoot: "/Applications/Aether Mail.app/Contents/MacOS",
      platform: "darwin",
      env: { HOME: "/Users/x" },
      exists: NONE,
    });
    expect(got.dir).toBe("/Users/x/Library/Application Support/Aether Mail");
  });

  it("honours XDG_DATA_HOME on Linux", () => {
    const got = chooseDataDir({
      appRoot: "/opt/aether",
      platform: "linux",
      env: { HOME: "/home/x", XDG_DATA_HOME: "/home/x/.local/share" },
      exists: NONE,
    });
    expect(got.dir).toBe("/home/x/.local/share/aether-mail");
  });

  it("falls back to ~/.local/share when XDG is unset", () => {
    const got = chooseDataDir({
      appRoot: "/opt/aether",
      platform: "linux",
      env: { HOME: "/home/x" },
      exists: NONE,
    });
    expect(got.dir).toBe("/home/x/.local/share/aether-mail");
  });

  it("an explicit override wins over everything", () => {
    // Tests and power users need to point the app at a specific directory.
    const got = chooseDataDir({
      appRoot: "C:\\src\\aether-mail",
      platform: "win32",
      env: { AETHER_DATA_DIR: "D:\\mail", APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      exists: () => true,
    });
    expect(got.dir).toBe("D:\\mail");
    expect(got.source).toBe("override");
  });

  it("falls back to the app root when the OS gives us nothing", () => {
    // A broken environment must not mean a crash on launch.
    const got = chooseDataDir({
      appRoot: "C:\\app",
      platform: "win32",
      env: {},
      exists: NONE,
    });
    expect(got.dir).toBe("C:\\app\\data");
    expect(got.source).toBe("fallback");
  });

  it("reports a legacy directory to migrate when one exists", () => {
    // Someone who already ran the old build has mail in the program folder.
    const got = chooseDataDir({
      appRoot: "C:\\Programs\\Aether Mail",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      exists: (p) => p === "C:\\Programs\\Aether Mail\\data\\mail.db",
    });
    expect(got.legacy).toBe("C:\\Programs\\Aether Mail\\data");
  });

  it("does not report a legacy directory when there is no database in it", () => {
    // An empty data/ is not worth migrating and must not look like one.
    const got = chooseDataDir({
      appRoot: "C:\\Programs\\Aether Mail",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      exists: NONE,
    });
    expect(got.legacy).toBeNull();
  });

  it("never reports the destination as its own legacy directory", () => {
    // In the source tree, dir IS <root>/data — migrating it onto itself would
    // be a self-destructive no-op waiting to go wrong.
    const got = chooseDataDir({
      appRoot: "C:\\src\\aether-mail",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      exists: () => true,
    });
    expect(got.dir).toBe("C:\\src\\aether-mail\\data");
    expect(got.legacy).toBeNull();
  });
});
