# STATUS.md — overnight MVP log

**Owner:** Aether (autonomous). Human is away. Do not wait for the human.
**Updated:** 2026-08-15 ~02:33 local
**Remote:** local only. Do not `git push`.

## Say “status” — this file

### MVP verdict

**Close for a demoable local client + agent. Not close for daily-driving real Gmail/Outlook.**

You can: read fixture mail, search, star/archive/trash/unread, compose drafts, keyboard shortcuts, summarize / draft / triage / action-items via local Mistral.  
You cannot: fetch a live inbox or send SMTP. Do not save a real password until keyring + IMAP probe exist.

Comparison: `docs/COMPETITIVE.md`

### What works

- UI: http://127.0.0.1:5173/  — restart with `scripts/start-mvp.bat` if down
- 3-pane + toolbar: New, Star, Archive, Trash, Unread
- Shortcuts: `c` new, `s` star, `e` archive, `#` trash, `u` unread, `r` draft, `j`/`k` next/prev
- Agent: Summarize, Draft reply, **Triage** (propose star/archive, you apply), **Action items**
- Security: CORS locked, `docs/SECURITY.md`

### Not done

- Live IMAP / OAuth / keyring
- SMTP send (honest 409)
- Thunderbird fork (ADR 0001)
- Calendar / contacts / Exchange
- GitHub push

### Tests this batch

- `cargo test` — 9 passed (incl. star/archive/unread)
- `npm run test -w @aether/api` — 15 passed
- web production build clean

### Next when you return

1. Rust IMAP LOGIN probe + OS keyring (then real accounts)
2. SMTP send behind confirm
3. Tauri window now that rustc exists
