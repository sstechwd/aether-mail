/**
 * Where the app's files live.
 *
 * This must work in three different worlds:
 *   1. dev / vitest  — ESM, `import.meta.url` exists
 *   2. bundled CJS   — `__dirname` exists, no `import.meta`
 *   3. packaged SEA  — neither exists; only `process.execPath` is meaningful
 *
 * Getting this wrong is not cosmetic: these paths locate `aether-cli` (which
 * talks to the OS keyring) and the `data/` directory. A packaged build that
 * resolves them to the wrong place silently loses the user's mail store.
 */
import path from "node:path";
import { existsSync } from "node:fs";

let cached: string | null = null;

/** True when running inside a Node single-executable build. */
export function isPackaged(): boolean {
  // Node sets this for SEA builds; the cast keeps TS happy on older typings.
  const sea = (process as unknown as { isSEA?: boolean }).isSEA;
  return Boolean(sea);
}

function moduleDir(): string | null {
  // CJS bundle (esbuild --format=cjs) gives us __dirname.
  const dirname = (globalThis as unknown as { __dirname?: string }).__dirname;
  if (typeof dirname === "string" && dirname.length > 0) return dirname;
  return null;
}

/**
 * Repo/install root: the directory that contains `data/` and `target/`.
 * Walks up looking for a marker so it works from src, dist, or a bundle.
 *
 * Deliberately NOT cached across differing candidates: under a parallel test
 * runner one module can resolve the root before another changes cwd, and a
 * cached wrong answer then leaks into unrelated code (this cost a real
 * debugging cycle — the Sibyl script "went missing" only in a full run).
 */
export function appRoot(): string {
  if (cached && existsSync(cached)) return cached;

  const candidates: string[] = [];
  const dir = moduleDir();
  if (dir) candidates.push(dir);
  // Packaged: sit next to the executable.
  if (process.execPath) candidates.push(path.dirname(process.execPath));
  candidates.push(process.cwd());

  // Prefer a root that actually looks like this app (has package.json AND a
  // sibling we care about) over the first bare package.json we stumble into.
  const strong: string[] = [];
  const weak: string[] = [];
  for (const start of candidates) {
    let cur = path.resolve(start);
    for (let hops = 0; hops < 6; hops += 1) {
      const hasPkg = existsSync(path.join(cur, "package.json"));
      const hasData = existsSync(path.join(cur, "data"));
      const hasScripts = existsSync(path.join(cur, "scripts"));
      if (hasPkg && (hasData || hasScripts)) strong.push(cur);
      else if (hasPkg || hasData) weak.push(cur);
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  }

  cached = strong[0] ?? weak[0] ?? process.cwd();
  return cached;
}

/** Join a path under the app root. */
export function resolveFromRoot(...parts: string[]): string {
  return path.join(appRoot(), ...parts);
}
