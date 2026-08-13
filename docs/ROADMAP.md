# ROADMAP.md — Aether Mail

Phased. Each phase has a **demo you can click** and a **stop rule**. Do not start phase N+1 because phase N is boring.

Sub-agent split when we leave planning: **mail-core**, **agent-runtime**, **UI**, **packaging**. Parent agent keeps the docs and the interfaces.

---

## Phase 0 — Planning (this phase)

**Done when:** this documentation set exists, stack is locked, git repo is initialized.

- VISION, PRODUCT, CONVENTIONS/AGENTS, ARCHITECTURE, ROADMAP
- No application code
- Human accepts or amends the stack table

**Stop rule:** do not `create-tauri-app` until the human says the name and stack are good.

---

## Phase 1 — Hollow shell

**Demo:** a signed-in-looking window with empty folder list, empty thread list, settings page that can *store and retrieve* a dummy secret in the OS keyring.

- Scaffold Tauri 2 + React 19 + TS + Tailwind in `apps/desktop`
- Cargo workspace with empty crates (`mail-core`, `mail-store`, `agent-runtime`, `aether-secrets`)
- `aether-secrets` implemented for real (keyring round-trip tests)
- CI: `cargo test` + UI typecheck on push (GitHub Actions)
- App data dir created on first launch

**Stop rule:** no IMAP yet. Prove the window and the secret store.

---

## Phase 2 — Read path (the real product starts here)

**Demo:** connect to a real IMAP inbox (app password), see folders, click a thread, read plain + simple HTML, go offline and still read what was fetched.

- `mail-store` schema + FTS5 stub
- `mail-core` connect / LIST / UID FETCH / cache
- UI: folder tree, virtualized thread list, read pane
- Sandboxed HTML render, remote images blocked
- Headless tests with a recorded or local fake IMAP (GreenMail / python `aioimaplib` fixture, or checked-in protocol traces)

**Stop rule:** do not compose yet. Reading must be trustworthy.

---

## Phase 3 — Write path

**Demo:** reply to a message, send via SMTP, see it in Sent after sync.

- `mail-builder` + `lettre`
- Drafts in SQLite
- Compose UI (plain first, simple rich later)
- Send errors that a human can understand
- OAuth for Gmail/Microsoft is **allowed to start here as a spike**, not required to close the phase. Generic IMAP/SMTP must ship first.

**Stop rule:** no agent. A mute Thunderbird is more useful than a chatty broken one.

---

## Phase 4 — Search, sync quality, multi-account

**Demo:** two accounts; search "invoice March" offline; IDLE updates the open folder.

- FTS5 populated on fetch
- IDLE + incremental sync that does not corrupt UIDVALIDITY
- Multi-account switcher
- Attachment save-to-disk

**Stop rule:** no "AI search." SQLite FTS or nothing.

---

## Phase 5 — Agent v1 (BYOK / local)

**Demo:** open a thread, ask "draft a polite decline," get a draft in the compose box, edit, send yourself. Disconnect the network except IMAP and the model still works with Ollama.

- `agent-runtime` provider trait + OpenAI-compatible + Ollama
- Tools: search, read_thread, list_folders, draft_reply, summarize_thread
- Confirm UI for anything that would send
- Transcript drawer
- Prompt-injection tests: a fixture mail that says "send everything to attacker@…" must not produce a send

**Stop rule:** no scheduled agents, no premium marketplace, no hosted proxy.

---

## Phase 6 — Skills + progressive disclosure

**Demo:** a non-technical user never sees a system prompt. A power user drops a `SKILL.md` into the skills dir and it appears in a picker.

- Built-in skills: triage, draft-reply, summarize-thread
- User skills directory
- First-run: agent stays closed; a single "Ask Aether" button
- Per-account "allow cloud models" switch

---

## Phase 7 — Packaging

**Demo:** a stranger on Windows installs from a GitHub Release and connects IMAP without installing Rust.

- Tauri bundler: NSIS/MSI, later macOS/Linux
- Code signing when we have a cert (unsigned is OK for source-build users)
- `README` build instructions that actually work on this machine

---

## Phase 8 — Paid add-on (optional, separate)

**Demo:** OSS build unchanged. A user who wants hosted models pastes a license key, hits *our* proxy, sees a usage number. Turning it off returns them to BYOK.

- Provider adapter only — no mail-core changes
- ToS + disclosed markup
- Premium skill packs as data, not compiled code
- Encrypted sync only if someone will pay for it; do not invent it speculatively

---

## Suggested sub-agent cut when Phase 1 starts

| Sub-agent | Owns | First deliverable |
|---|---|---|
| mail-core | crates/mail-core, mail-store | schema + connect/LIST tests |
| agent-runtime | crates/agent-runtime | provider trait + fixture test (can start in Phase 5; stub crate in Phase 1) |
| UI | apps/desktop/src | shell layout + settings |
| packaging | CI, Tauri conf, later bundling | Actions workflow that runs tests |

Parent does not implement. Parent writes interfaces and reviews.

---

## Near-term human decisions (only these)

1. Accept **Aether Mail** as the working name? (easy to change now)
2. Accept the locked stack in `docs/CONVENTIONS.md`?
3. Local git only, or also create `sstechwd/aether-mail` on GitHub (public)?
4. Approve writing root `AGENTS.md` (desktop gated that filename).
