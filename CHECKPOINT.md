# CHECKPOINT — Aether Mail

**Read this first in a new chat. It replaces re-reading the codebase.**
Last updated: 2026-08-19 · HEAD `8d7fc06` · branch `main` (pushed, private `sstechwd/aether-mail`).
Green: **vitest 55 / 30 files**, **cargo all pass**, `hermes verify --json` ok. ~6,400 LOC.

---

## 1. What this is (one paragraph)

A local-first, downloadable desktop **email client** (not a host) with a Thunderbird-shaped
3-pane UI plus a lean in-process agent. User brings their own IMAP/SMTP account. Privacy-first:
mailbox never leaves the machine, passwords in OS keyring, agent can propose but never sends.
MIT core; money later = optional hosted models (Aether+), never paywalling mail.

## 2. Stack (LOCKED — do not relitigate)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell (target) | **Tauri 2** | `.exe`, not Electron. NOT scaffolded yet — still Vite tab. |
| Frontend | **React 19 + TS + Vite + Tailwind-ish CSS vars** | `apps/web` |
| UI host (temporary) | **Node HTTP API** `apps/api` (port 8787) | Scaffold. Product backend is Rust. JS never speaks IMAP/SMTP. |
| Mail I/O | **Rust `aether-cli`** (async-imap, lettre, mail-parser) | spawned by Node. Password via stdin→keyring, never argv. |
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
crates/           aether-cli (mail I/O), mail-store (SQLite), mail-core, aether-secrets
docs/             ARCHITECTURE, ROADMAP, SECURITY, STORAGE, INCOME, SIBYL, CONVENTIONS (binding), adr/
data/             *.json + *.jsonl (gitignored). mail.json, accounts.json, sibyl.db, meta.json
scripts/          start-mvp.bat (boot API+Vite), sibyl_aether.py
```

## 4. Working features (verified)

3-pane mail · account switcher (fixture vs Gmail, isolated) · newest/oldest sort · fetch newest-40 IMAP
· readable body + sandboxed HTML iframe · remote-image blocking w/ Load button · header inspect (auto-open on suspect)
· threat score · spoken workflows (star/archive/keep-unread/file — compile locally, no LLM) · two-click Confirm send (agent can't send)
· Sibyl memory (remember/recall) · persona voice · 30-day audit · themes (Filament/Retro/Modern, offline picker) · splash · onboarding screen
· token bar + wait dots · phone responsive panes · keyring account remove.

## 5. Hard rules (violating = wrong)

- **Client only.** No hosted inbox. Not a Thunderbird fork (ADR 0001).
- **Agent never sends/deletes.** Confirm = 2 human clicks + 5-min token. No auto-reply.
- **Password**: stdin→keyring. Never in accounts.json / argv / logs / git.
- **HTML mail**: sandboxed iframe, no innerHTML, images off until Load.
- **Cloud LLM** needs explicit `allowCloud`. Default local.
- **TDD**: failing test first, then code. Repo **private**, push **only when asked**.
- **Gmail = app password now**, OAuth is later (Phase 3). Proton via Bridge. Tutanota unsupported.
- Never force-add `data/*.json` / `*.jsonl`.

## 6. Next work (priority order)

1. **Daily-driver gate**: user confirms real Gmail fetch reads clean + one real Confirm send works end-to-end.
2. **MIME parsing** in Rust: real plain/html parts + inline `cid:` images (currently first 4k of body, cid not downloaded).
3. **Tauri shell**: scaffold the `.exe`, drop the Node+browser tax. Move store to SQLite for real.
4. **OAuth** (Gmail/Microsoft) — work/school tenants block app passwords.
5. Later/ideas (NOT now): Obsidian export, terminal nano-client, template marketplace, Aether+ billing.

## 7. Boot / verify

```bash
cd /c/Users/Sumo/Documents/aether-mail
export PATH="$HOME/.cargo/bin:$PATH"
scripts/start-mvp.bat            # API :8787 + Vite :5173
cargo build -p aether-cli        # REQUIRED before real fetch/send
npm run test -w @aether/api      # vitest
npm run build -w @aether/web     # tsc + vite
```
Ports already in use = already running; don't start a second. UI blank = Vite down, restart + Ctrl+F5.

## 8. Known bugs / debt

- Inline `cid:` images not downloaded (shows placeholder).
- Rust store (SQLite) exists but overnight UI still uses `data/mail.json` — migration pending.
- No OAuth. No Tauri. Node RAM secret fallback if CLI unbuilt.
- `imap-proto 0.10.2` future-incompat warning (upstream, harmless).
