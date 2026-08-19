/**
 * Build the API sidecar as a self-contained executable.
 *
 * Why: the desktop app must not require the user to install Node. esbuild
 * collapses the API to a single ~86KB file, then Node's SEA embeds it in a copy
 * of the Node runtime. The result is one .exe Tauri bundles as a sidecar.
 *
 * Run: npm run sidecar:build
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sidecarDir = path.join(root, "apps", "desktop", "sidecar");
const entry = path.join(root, "apps", "api", "src", "index.ts");

// Tauri looks for <name>-<target-triple><ext>.
const TRIPLE = process.env.TAURI_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc";
const EXT = process.platform === "win32" ? ".exe" : "";
const outExe = path.join(sidecarDir, `aether-api-${TRIPLE}${EXT}`);
const bundle = path.join(sidecarDir, "aether-api.cjs");
const blob = path.join(sidecarDir, "aether-api-sea.blob");
// Constant required by Node's SEA; do not change.
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(cmd, args, cwd = root) {
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

mkdirSync(sidecarDir, { recursive: true });

console.log("· bundling API -> single file");
run("npx", [
  "esbuild",
  entry,
  "--bundle",
  "--platform=node",
  "--target=node22",
  "--format=cjs",
  `--outfile=${bundle}`,
]);

console.log("· generating SEA blob");
run("node", ["--experimental-sea-config", path.join(sidecarDir, "sea-config.json")], sidecarDir);

console.log("· copying node runtime");
if (existsSync(outExe)) rmSync(outExe);
copyFileSync(process.execPath, outExe);

console.log("· injecting blob");
run("npx", ["postject", outExe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE], sidecarDir);

console.log(`✓ sidecar built: ${path.relative(root, outExe)}`);
