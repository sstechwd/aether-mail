# STATUS.md — overnight MVP log

**Owner:** Aether (autonomous). Human is away. Do not wait for the human.
**Started:** 2026-08-13 23:00 local
**Target:** clickable MVP by morning 2026-08-14
**Remote:** local only. Do not `git push`.

## Say “status” tomorrow — read this file

### What works right now (23:07)

- UI: http://127.0.0.1:5173/  (Vite, running)
- API: http://127.0.0.1:8787/api/health
- 3-pane Thunderbird-shaped client with fixture INBOX + Sent
- Local Ollama `mistral` summarize + draft-reply
- Prompt-injection fixture is refused (verified: phish mail asked to forward everything; agent flagged it and listed a refuse reason)
- Confirm send is honest: SMTP not wired (HTTP 409)
- Tests: `npm run test -w @aether/api` — 2 passed
- Start: `scripts/start-mvp.bat` or [HOWTO-MORNING.md](HOWTO-MORNING.md)

### What is not done

- Not a Thunderbird source fork (would burn the night)
- No live IMAP (Thunderbird on this machine has a local IMAP account; credentials were not read)
- No Tauri/Rust — rustc is not installed
- No GitHub push
- Root `AGENTS.md` still desktop-gated

## Overnight contract

A window that looks like Thunderbird (3-pane) and has a Hermes-shaped agent drawer:

1. Launch without extra installs if possible.
2. Fixture inbox if no credentials.
3. Folders + list + read.
4. Summarize + draft via local model.
5. Send is confirm-only and honest if unwired.

## Constraint 23:00

Rust missing. Node 24 / Ollama 0.9.6 / VS 2019 BuildTools present. Overnight path = Vite/React + Node sidecar. Same UI later drops into Tauri.

## Log

| Time | Batch | Result |
|---|---|---|
| 23:00 | Human: stay local, MVP by morning | started |
| 23:00 | Toolchain | Node/npm/Python/Ollama yes. rustc no. TB installed. |
| 23:02 | Decision: do not fork TB source | logged |
| 23:04 | MailStore + fixture + API + 3-pane UI | written |
| 23:06 | `npm install`, store tests | 2 passed |
| 23:07 | Servers up; agent summarize on injection mail | HTTP 200, refuse recorded, mistral named the phish |

## Next batches (no human needed)

1. Persist fixture + drafts to `data/`
2. Search hits the API, not just the open folder
3. Optional IMAP connect form (password stays in process memory)
4. rustup install if winget will do it unattended
5. Keep STATUS.md current
