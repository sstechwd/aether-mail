# CHECKPOINT — Aether Mail

**Read this first in a new chat. It replaces re-reading the codebase.**
**Last updated:** 2026-08-19 (MIME + Tauri + public-release session) · branch `main`, **pushed**. Repo is now **PUBLIC**.
Green: **vitest 75/33**, **cargo workspace pass**, **clippy clean**, **installer builds**. ~7,400 LOC.

---

## 1. What this is (one paragraph)

A local-first, downloadable desktop **email client** (not a host) with a Thunderbird-shaped
3-pane UI plus a lean in-process agent. User brings their own IMAP/SMTP account. Privacy-first:
mailbox never leaves the machine, passwords in OS keyring, agent can propose but never sends.
MIT core; money later = optional hosted models (Aether+), never paywalling mail.

## 2. Stack (LOCKED — do not relitigate)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | **Tauri 2** (`apps/desktop`) | **BUILT.** `aether-desktop.exe` 11MB + NSIS installer 25MB. Owns the window, spawns the API sidecar, kills it on close. |
| Frontend | **React 19 + TS + Vite + Tailwind-ish CSS vars** | `apps/web` |
| UI host (temporary) | **Node HTTP API** `apps/api` (port 8787) | Ships as a **Node SEA sidecar** (`npm run sidecar:build`) — 86KB of app inside an 89MB node runtime. No Node install needed. Product backend is still Rust. |
| Mail I/O | **Rust `aether-cli`** (async-imap, lettre, mail-parser) | spawned by Node. Password via stdin→keyring, never argv. |
| MIME | **`mail-parser` 0.11 in `crates/mail-core/src/mime.rs`** | Real multipart/QP/base64/RFC2047. `parse_message`, `parse_fetched`, `part_bytes`, `preview`. |
| Store (product) | **SQLite + FTS5** (`crates/mail-store`) | Envelopes + body-on-open. Overnight UI still uses `data/mail.json`. |
| Secrets | **OS keyring** (`crates/aether-secrets`, Windows Credential Manager) | Node has 8-slot RAM fallback only. |
| Agent LLM | **Local Ollama (mistral)** default; BYOK OpenAI-compatible | `num_predict` 80, 45s timeout, keep_alive 30m, 8-turn×600char. |
| Memory | **Sibyl Labs SDK** (`sibyl-memory-client`, local SQLite `data/sibyl.db`) | NOT hyperb1iss/sibyl. Hackathon entry. |

Rust: `1.97.1 MSVC` at `C:\Users\Sumo\.cargo\bin` (run `export PATH="$HOME/.cargo/bin:$PATH"`). Node 24. Ollama mistral ~4GB.

## 3. Repo map

```
apps/api/src/     Node UI host. index.ts is the router. 26 modules + 30 test files.
  store.ts        MailStore (per-accountId isolation, sort, folders)
  mailtext.ts     toIsoDate, compareMailDate, readableBody, countHiddenMedia
  html-mail.ts    sanitizeMailHtml (iframe render, image blocking)
  inspect.ts      header inspect (From vs Return-Path, SPF/DKIM/DMARC)
  agent.ts chat.ts sibyl.ts usage.ts workflows.ts threat.ts persona.ts
  accounts.ts account-switch.ts mailio.ts send-prepare.ts security.ts llm*.ts
apps/web/src/     App.tsx (main 3-pane), Settings.tsx, AgentChat.tsx, Templates.tsx, themes.ts
crates/           aether-cli (mail I/O + `part` cmd), mail-store (SQLite), mail-core (+mime.rs), aether-secrets
docs/             ARCHITECTURE, ROADMAP, SECURITY, SIGNING, STORAGE, INCOME, SIBYL, CONVENTIONS (binding), adr/
.github/workflows ci.yml (fmt+clippy+tests+build on PR), release.yml (tag -> installer + provenance)
data/             *.json + *.jsonl (gitignored). mail.json, accounts.json, sibyl.db, meta.json
apps/desktop/     Tauri 2 shell: src/lib.rs (sidecar lifecycle), tauri.conf.json, icons/, sidecar/ (gitignored build output)
scripts/          start-mvp.bat (boot API+Vite), sibyl_aether.py, build-sidecar.mjs
```

## 4. Working features (verified)

3-pane mail · account switcher (fixture vs Gmail, isolated) · newest/oldest sort · fetch newest-40 IMAP
· readable body + sandboxed HTML iframe · remote-image blocking w/ Load button · header inspect (auto-open on suspect)
· threat score · spoken workflows (star/archive/keep-unread/file — compile locally, no LLM) · two-click Confirm send (agent can't send)
· Sibyl memory (remember/recall) · persona voice · 30-day audit · themes (Filament/Retro/Modern, offline picker) · splash · onboarding screen
· token bar + wait dots · phone responsive panes · keyring account remove.

**MIME (new):** real multipart decode — plain + HTML parts, quoted-printable/base64, RFC 2047 subjects
(`=?utf-8?B?…?=` decoded at fetch *and* at the store boundary, so mail already on disk reads clean too)
· attachment strip with on-demand download (`GET /api/messages/:id/parts/:n`) · inline `cid:` images resolved
from the message's own bytes (no network) and rendered as `data:` in the sandbox.

**Desktop app:** Tauri 2 shell (`apps/desktop/`), Node API compiled to a self-contained sidecar via
Node SEA — no Node install required. `scripts/run-app.bat` runs it, `scripts/build-app.bat` rebuilds.
NSIS installer at `target/release/bundle/nsis/`. Unsigned; trust comes from build provenance +
SHA256SUMS instead (`docs/SIGNING.md`).

**Mail client features (2026-08-20):**
- **Folders** — INBOX/Sent/Drafts/Trash/Spam synced from the real server. Provider names differ
  (`[Gmail]/Sent Mail` vs `Sent Items`); `apps/api/src/folders.ts` maps remote → canonical. Prefers a
  namespaced folder over a stray lookalike, or Sent syncs the wrong (empty) one.
- **Outbox + scheduled send** — "Send later" in compose queues to `data/outbox.json`; a worker drains
  every 30s and once at startup, so mail queued before the app closed goes out on next launch.
  Cancel/retry, gives up after 3 attempts. Verified across a real 12-hour closure.
- **Reply / Reply-all / Forward / Delete** on an open message.
- **Attachments both directions** — 📎 picker in compose, real multipart/mixed from Rust.
- **Calendar invites** — `text/calendar` + `.ics` detected (Outlook sends them as octet-stream, so
  the extension is checked too). Invite card + "Add to calendar" writes an .ics for the OS.
- **Signatures** — per account, applied at send-prepare so what you confirm is what goes out.
- **Contacts autocomplete** — harvested from the store, no CardDAV. +3 if you wrote to them, +1 if
  they wrote to you, −2 for no-reply.
- **Threading** — Conversations/Flat toggle. References/In-Reply-To first, normalized subject as
  fallback. Live mailbox: 149 rows → 102, 37 conversations.
- **Standalone assistant** — `✦ Assistant` in the sidebar, chat with no message open.

## 5. Hard rules (violating = wrong)

- **Client only.** No hosted inbox. Not a Thunderbird fork (ADR 0001).
- **Agent never sends/deletes.** Confirm = 2 human clicks + 5-min token. No auto-reply.
- **Password**: stdin→keyring. Never in accounts.json / argv / logs / git.
- **HTML mail**: sandboxed iframe, no innerHTML, images off until Load.
- **Cloud LLM** needs explicit `allowCloud`. Default local.
- **TDD**: failing test first, then code. Repo **public**, push **only when asked**. Nothing personal in commits.
- **Gmail = app password now**, OAuth is later (Phase 3). Proton via Bridge. Tutanota unsupported.
- Never force-add `data/*.json` / `*.jsonl`.

## 6. Next work (priority order)

1. **Daily-driver gate**: user confirms real Gmail fetch reads clean + one real Confirm send works end-to-end **from the installed app**.
2. **Shrink the sidecar**: 89MB is Node's runtime, not our code (86KB). Porting the ~20 API routes into the Tauri Rust process drops the installer from 25MB to ~8MB and removes Node entirely. Biggest single win available.
3. **OAuth** (Gmail/Microsoft) — work/school tenants block app passwords.
4. **SQLite store**: overnight UI still reads `data/mail.json`; `crates/mail-store` is ready.
5. Later/ideas (NOT now): Obsidian export, terminal nano-client, template marketplace, Aether+ billing.

## 7. Boot / verify

```bash
cd /c/Users/Sumo/Documents/aether-mail
export PATH="$HOME/.cargo/bin:$PATH"
scripts/start-mvp.bat            # API :8787 + Vite :5173
cargo build -p aether-cli        # REQUIRED before real fetch/send
npm run test -w @aether/api      # vitest
npm run build -w @aether/web     # tsc + vite

npm run sidecar:build            # API -> self-contained .exe (needed before a desktop build)
cargo tauri build --config apps/desktop/tauri.conf.json   # -> target/release/bundle/nsis/*.exe
cd target/release && ./aether-desktop.exe                 # run the built app
```
Ports already in use = already running; don't start a second. UI blank = Vite down, restart + Ctrl+F5.

## 8. Known bugs / debt

- Inline `cid:` + attachment paths are unit-tested (mutation-verified) but **no real message in the
  test mailbox had one** — all 40 live newsletters use remote images. Needs one real attachment to confirm.
- Attachment bytes stream through the Node API; a >2MB inline part is refused by the CLI on purpose.
- Rust store (SQLite) exists but overnight UI still uses `data/mail.json` — migration pending.
- No OAuth. Node RAM secret fallback if CLI unbuilt.
- Installer is **unsigned** — SmartScreen warns. Mitigated with GitHub build provenance + SHA256SUMS + portable zip; see `docs/SIGNING.md`. Buy Azure Trusted Signing first when funds allow.
- Sidecar is 89MB (Node runtime). Our API is 86KB of it. See Next work #2.
- `imap-proto 0.10.2` future-incompat warning (upstream, harmless).
