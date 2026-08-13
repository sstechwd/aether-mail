# Aether Mail

Local-first desktop email client with an optional on-device agent.

Thunderbird-shaped mail. Hermes-shaped tools. Your IMAP account, your disk, your keys.

**Status:** Phase 0 — planning. No application code yet.

## Read this first

| Doc | What it is |
|---|---|
| [VISION.md](VISION.md) | Why this exists |
| [PRODUCT.md](PRODUCT.md) | What v1 is and is not |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | **Locked stack, coding rules, security** (binding) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Crates, IPC, threat model |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 0–8 |

A root `AGENTS.md` will mirror `docs/CONVENTIONS.md` once that filename is approved in the Hermes desktop app.

## Stack (locked)

Tauri 2 + React 19 + TypeScript + Vite + Tailwind. Mail and agent in Rust (`async-imap`, `lettre`, Stalwart MIME, SQLite FTS5, OS keyring). BYOK / Ollama first. Electron is rejected.

## License

MIT. The open-source client is the product. Paid hosted inference, if it ever exists, is an optional adapter — not a requirement to read or send mail.

## Build

Nothing to build until Phase 1. When that lands, this section will have the exact commands.
