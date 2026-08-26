# Building Aether Mail on Windows, macOS, and Linux

The code is already cross-platform (Rust + Tauri 2 + Node). The **installer**
on GitHub Releases is Windows-only because that is the machine we have.
Mac and Linux builds must be produced **on that OS**. Do not cross-compile
the first one from Windows.

## All three

```bash
git clone https://github.com/sstechwd/aether-mail
cd aether-mail
npm ci
cargo build --release -p aether-cli
npm run sidecar:build
cargo tauri build --config apps/desktop/tauri.conf.json
```

`npm run sidecar:build` infers the host triple (Windows / Darwin / Linux,
x86_64 or arm64). Do not hardcode `x86_64-pc-windows-msvc` on a Mac.

## Bundles

| OS | Command extra | Output |
|---|---|---|
| Windows | default (`nsis` in tauri.conf) | `target/release/bundle/nsis/` |
| macOS | `--bundles dmg` | `target/release/bundle/dmg/` |
| Linux | `--bundles deb,appimage` | `target/release/bundle/` |

On macOS/Linux, `bundle.resources` in `apps/desktop/tauri.conf.json` should
point at `aether-cli` (no `.exe`). The Windows line is the `.exe`.

Unsigned on every OS until we can pay for certificates. See `docs/SIGNING.md`.

## Data directory (already OS-aware)

| OS | Mail lives in |
|---|---|
| Windows | `%APPDATA%\Aether Mail` |
| macOS | `~/Library/Application Support/Aether Mail` |
| Linux | `$XDG_DATA_HOME/aether-mail` or `~/.local/share/aether-mail` |

Never store the mailbox next to the binary on an installed copy.
