/**
 * Where the user's mail lives.
 *
 * Until now `data/` sat beside the executable. That is right in a source tree
 * and wrong everywhere else: a real install puts it inside the program
 * directory, so an uninstall or a reinstall can take the mailbox with it, and
 * a per-machine install cannot even write there.
 *
 * Mail is user data. The program directory should hold the program.
 *
 * The decision is a PURE FUNCTION taking platform, env and an `exists` probe,
 * so the macOS and Linux rules are testable from Windows. Three platforms of
 * untested string joining is how a "works on my machine" data-loss bug is
 * born.
 */

import path from "node:path";

export type DataDirChoice = {
  /** Directory the app should read and write. */
  dir: string;
  /** Why we chose it — surfaced in logs so a support answer is one line. */
  source: "override" | "source-tree" | "os" | "fallback";
  /**
   * A previous install's `data/` holding a real database, or null. The caller
   * migrates it once; this function only reports it.
   */
  legacy: string | null;
};

export type DataDirInput = {
  appRoot: string;
  platform: NodeJS.Platform | string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
};

/** The OS location for this app's user data. Null when the env lacks the vars. */
function osDataDir(input: DataDirInput): string | null {
  const { platform, env } = input;

  if (platform === "win32") {
    const appdata = env.APPDATA;
    return appdata ? path.win32.join(appdata, "Aether Mail") : null;
  }

  if (platform === "darwin") {
    const home = env.HOME;
    return home ? path.posix.join(home, "Library", "Application Support", "Aether Mail") : null;
  }

  // Linux and friends: XDG, with the spec's own default when it is unset.
  const xdg = env.XDG_DATA_HOME;
  if (xdg) return path.posix.join(xdg, "aether-mail");
  const home = env.HOME;
  return home ? path.posix.join(home, ".local", "share", "aether-mail") : null;
}

/**
 * Decide the data directory.
 *
 * Order matters:
 *   1. AETHER_DATA_DIR — tests and power users must be able to be explicit.
 *   2. A source tree keeps using <root>/data, so development is unchanged and
 *      the existing working mailbox is not orphaned by an upgrade.
 *   3. Otherwise the OS user-data location.
 *   4. If the environment gives us nothing, fall back to <root>/data rather
 *      than crashing on launch. A degraded location beats no app.
 */
export function chooseDataDir(input: DataDirInput): DataDirChoice {
  const joinFor = input.platform === "win32" ? path.win32.join : path.posix.join;
  const rootData = joinFor(input.appRoot, "data");

  const override = input.env.AETHER_DATA_DIR;
  if (override) return { dir: override, source: "override", legacy: null };

  // A checkout has apps/ next to package.json; an install never does.
  const inSourceTree = input.exists(joinFor(input.appRoot, "apps"));
  if (inSourceTree) return { dir: rootData, source: "source-tree", legacy: null };

  const os = osDataDir(input);
  const dir = os ?? rootData;
  const source: DataDirChoice["source"] = os ? "os" : "fallback";

  /*
   * Only report a legacy directory that holds a real database, and never when
   * it IS the destination — migrating a directory onto itself is a no-op
   * waiting to go wrong.
   */
  const legacyDb = joinFor(input.appRoot, "data", "mail.db");
  const legacy = dir !== rootData && input.exists(legacyDb) ? rootData : null;

  return { dir, source, legacy };
}
