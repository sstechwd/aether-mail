# CONVENTIONS.md — stack, coding rules, security

> This is the stack lock. A root `AGENTS.md` with the same content is intended;
> writing that filename is gated on an explicit approve in the desktop app.
> Until then, **this file is the law of the repo.**

This file is binding. Humans and coding agents follow it.
If a later doc disagrees with this file, this file wins until it is deliberately changed.

**Working product name:** Aether Mail
**Repo:** `aether-mail`
**Status:** planning only — no application code until Phase 0 docs are accepted

---

## Locked stack (do not reopen without a written ADR)

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| Desktop shell | **Tauri 2** (Rust host + OS webview) | Native feel, ~10MB runtime vs Electron's 150MB+ Chromium. Smaller attack surface. Rust is the right language for credentials, IMAP, and sandboxing. Electron is rejected. |
| UI | **React 19 + TypeScript + Vite** | Dense hiring/contributor pool, mature virtualized-list and rich-text ecosystem, far more Tauri examples. Svelte 5 is nicer for tiny UIs; this client will not stay tiny. Coding agents also produce more reliable React than Svelte 5 runes today. |
| Styling | **Tailwind CSS v4** + a headless primitive kit (**Base UI** or Radix) | Progressive disclosure needs boring, consistent primitives — not a custom design-system hobby. |
| Mail protocols | **Rust:** `async-imap` + `lettre` (SMTP) + Stalwart `mail-parser` / `mail-builder` | Protocol and MIME work stay in the Rust host. JS never speaks IMAP/SMTP. `mail-parser` is used in a real mail server; do not roll a MIME parser. |
| Local store | **SQLite** via `sqlx` (or `rusqlite` if sqlx runtime cost bites) + **FTS5** | Single-file, offline-first, excellent full-text search, trivial backup. No Postgres. No IndexedDB-as-source-of-truth. |
| Secrets | OS credential store via Rust `keyring` | Windows Credential Manager / macOS Keychain / libsecret. Never a plaintext file. Never `localStorage`. |
| TLS | `rustls` only | No OpenSSL in the tree if we can avoid it. |
| Agent runtime | **Rust crate `agent-runtime`** in-process | Same process as the mail store. Tool calls are Rust functions with an allowlist. No Node sidecar. No "the model can run shell." |
| LLM providers | Trait + OpenAI-compatible HTTP, Anthropic Messages, Ollama, llama.cpp server | **BYOK and local models are the primary path.** Hosted/paid inference is an optional adapter, never a hard dependency. |
| Packaging | Tauri bundler: NSIS/MSI (Windows), `.dmg` (macOS), `.deb` + AppImage (Linux) | Phase 7. Unsigned local builds are fine until then. |
| Tests | Rust: `cargo test` (temp-file SQLite). UI: Vitest + Testing Library. E2E later: Playwright only if it earns its keep. | Mail/agent crates must be testable with **no window and no network**. |
| License | **MIT** for the open-source core | Paid add-ons live outside this license boundary (separate repo or a clearly marked module the OSS build does not link). |

### Explicitly rejected (for now)

- Electron / Neutralino / Flutter desktop
- Node `imapflow` / `nodemailer` as the mail core
- JMAP-first (Gmail and Outlook — the actual user base — are IMAP / Graph. JMAP is a later adapter.)
- Shipping a model weight inside the installer
- Requiring an account, phone-home, or hosted model to read or send mail
- Putting refresh tokens or passwords in the webview

To change a locked choice: write `docs/adr/NNNN-title.md`, state the cost of the change, and update this table in the same PR.

---

## Repository layout (target)

```
aether-mail/
  PRODUCT.md
  VISION.md
  AGENTS.md                 ← copy of this file, once approved
  docs/CONVENTIONS.md       ← this file (binding until AGENTS.md exists)
  README.md
  LICENSE
  docs/
    ARCHITECTURE.md
    ROADMAP.md
    adr/
  apps/desktop/             ← Tauri 2 + React (created in Phase 1)
    src/                    ← React UI
    src-tauri/              ← thin Tauri host; calls workspace crates
  crates/
    mail-core/              ← IMAP/SMTP/MIME, account, sync engine
    mail-store/             ← SQLite schema, FTS5, queries
    agent-runtime/          ← providers, tool loop, skills loader
    aether-secrets/         ← keyring wrapper
  .hermes/plans/            ← implementation plans, not product docs
```

Until Phase 1, only the markdown / license / git metadata exist. Do not scaffold Tauri until the human says go.

---

## Coding conventions

1. **English, plain, no hype** in comments, commit messages, and docs.
2. **Small PRs.** One crate or one UI surface per change when possible.
3. **TDD for mail-core, mail-store, and agent-runtime.** Write the failing test first. UI may start as sketches; business rules may not.
4. **No `unwrap()` on I/O, network, or crypto paths** in non-test Rust. Use `Result` and typed errors (`thiserror`).
5. **TypeScript `strict` on.** No `any` without a one-line justification comment.
6. **IPC is the security boundary.** Every Tauri command is an allowlisted, typed function. The webview may pass an `account_id` and a `message_id`. It may not pass a password, a raw IMAP command, or a file path the Rust side did not already own.
7. **Commits:** `type: short description` (`feat`, `fix`, `docs`, `test`, `chore`, `refactor`). Present tense.
8. **Do not add a dependency** to avoid 40 lines of code. Do add a dependency to avoid a MIME, TLS, or crypto implementation.
9. **Feature flags, not dead code.** Incomplete paid-tier hooks stay behind `cfg` or live in a separate crate the OSS build does not link.

---

## Security rules (non-negotiable)

Email is credentials + a lifetime of personal data. Treat it that way.

1. **Secrets stay in the OS keyring.** The Rust host reads them. The webview never receives a password, app password, refresh token, or API key. Session-scoped opaque handles only.
2. **No logging of secrets, mail bodies, or recipients** at info/debug in default builds. If a debug flag dumps a message, it is off by default and documented.
3. **HTML mail is hostile.** Render in a sandboxed iframe / separate webview with no IPC, no cookies, and remote images blocked until the user allows the sender.
4. **Agent tools are an allowlist.** Default tools: search, read thread, list folders, draft reply, propose label/move. `send`, `delete`, `forward`, and any account-mutation require an explicit UI confirmation dialog. The model cannot click "confirm" for the user.
5. **Least data to the model.** Send retrieved snippets and headers, not the whole mailbox. User can set "local models only" per account.
6. **Network allowlist.** The host may contact: configured IMAP/SMTP hosts, configured LLM endpoints, and (optional) the paid inference proxy. No other egress. No crash-reporter that uploads mail.
7. **No telemetry by default.** If we ever add usage metrics, they are opt-in, aggregated, and contain no subjects, addresses, or bodies.
8. **Supply chain.** Pin versions. Prefer crates.io / npm packages with real maintenance. No install-time network scripts. `cargo deny` + `npm audit` in CI once CI exists.
9. **Threat model lives in `docs/ARCHITECTURE.md`.** Update it when we add a network surface.
10. **Paid inference** is a separate endpoint the user opts into. Transparent ToS. Markup is disclosed. Core features work with the user's own key or a local model.

---

## Agent / LLM conventions

- Provider trait lives in `crates/agent-runtime`. Adding a vendor = one new adapter + tests with recorded fixtures. No vendor SDKs that force their own HTTP stack if an OpenAI-compatible POST will do.
- Skills are markdown files in the user data dir (`skills/<name>/SKILL.md`), same idea as Hermes skills: trigger, steps, pitfalls. The OSS app ships a small built-in set (triage, draft-reply, summarize-thread). Premium packs are optional downloads, not compiled in.
- The tool loop is deterministic: model requests a tool → host executes → host returns JSON → model continues. Cap iterations. Cap tokens. Show the transcript in a drawer the user can open.
- **BYOK is default.** Settings: paste key → stored in keyring → used locally. Ollama / llama.cpp detected on localhost if present.
- Hosted/paid path: later. Pattern (a) proxy through OpenRouter (or equivalent) with a subscription, or (b) our own meter. Never required.

---

## How agents should work in this repo

1. Read this file, then `PRODUCT.md`, `VISION.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`.
2. Implement only the current roadmap phase unless the human expands scope.
3. Prefer `crates/` work that can be tested headlessly.
4. Use sub-agents by concern: mail-core, agent-runtime, UI, packaging. Keep the parent context lean — summaries, not diffs.
5. Do not "just add Electron compatibility" or a second mail backend. One stack.
6. If blocked, say so. Do not invent IMAP server behavior or fake test output.

---

## Current phase

**Phase 0 — planning.** Deliverable is this documentation set and a git repo. Next human decision: accept the stack and name, then Phase 1 scaffolds Tauri.
