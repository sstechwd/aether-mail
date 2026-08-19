# STATUS.md — morning briefing

**Updated:** 2026-08-19 (MIME session) · private repo · **local commits waiting, not pushed** — say the word.

For full technical state, read **`CHECKPOINT.md`** first. This file is the human-facing "what to click" version.

## How to start

```
scripts\start-mvp.bat
```
→ http://127.0.0.1:5173/ — hard-refresh after restart. `cargo build -p aether-cli` first if you changed Rust.

## What works

3-pane client, fixture + real Gmail/IMAP accounts (isolated, switchable). Fetch pulls the newest 40 messages,
sorted correctly, HTML rendered in a sandboxed iframe (remote images blocked until you click Load).
Header inspect (SPF/DKIM/From-vs-Return-Path) auto-opens on suspect mail. Spoken workflows compile locally
(star/archive/keep-unread/file). Sibyl memory (`remember that…`). Two-click Confirm send. Themes
(Filament/Retro/Modern) work even if the API is down. Onboarding screen on first run with no account.

**New this session — mail actually reads like mail.** Subjects were showing as
`=?utf-8?b?UGVyZmVjdCBQeXRob24...?=` and bodies leaked MIME boundaries and `=E2=80=99`. Real MIME
parsing now runs in Rust (Stalwart `mail-parser`): proper plain/HTML parts, quoted-printable and
base64 decoded, accented and emoji subjects correct. Checked against your live inbox: **80 messages,
0 garbled subjects, 0 MIME leaks.** Attachments now show as a strip under the header and download on
click; inline `cid:` images are pulled from the message's own bytes (no network, no tracker risk).

Tests: **vitest 71/71**, **cargo green + clippy clean**, web build ok.

## What to click

1. Click your Gmail account in the sidebar → **Fetch INBOX**.
2. Open a message with images → **Load images** if you trust the sender.
3. Open something suspicious-looking → header inspect should auto-open.
4. Chat: `what's in my inbox`, `inspect headers`, `remember that …` — all local, no Ollama wait.
5. Reply to something → **Confirm send** twice.

## Still not a daily driver

- No OAuth (app password only — some work/school tenants block this)
- No Tauri `.exe` yet — still the Vite tab
- Attachments/inline images work in tests, but **none of your 40 fetched newsletters actually had one** —
  send yourself a mail with a PDF and an inline logo to confirm it on real mail
- Overnight store is still `data/mail.json`, not the Rust SQLite store yet
- Public GitHub: no

Money (honest, not a pitch): `docs/INCOME.md` — free MIT client, optional Aether+ later.
