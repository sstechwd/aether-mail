# STATUS.md — morning briefing

**Updated:** 2026-08-20 (folders, outbox, calendar, contacts, threading) · repo is **PUBLIC** and pushed.

For full technical state, read **`CHECKPOINT.md`** first. This file is the human-facing "what to click" version.

## How to start

**It's a real app now.** Double-click the installer, or run the built exe:

```
target\release\bundle\nsis\Aether Mail_0.1.0_x64-setup.exe    <- install it
target\release\aether-desktop.exe                             <- or just run it
```
No terminal, no browser tab, no Node install. Windows will warn that it's from an
unknown publisher — that's the missing code-signing cert, not a problem with the app.

Still want the dev loop? `scripts\start-mvp.bat` → http://127.0.0.1:5173/

## What works

Run it: double-click `scripts/run-app.bat`. Rebuild: `scripts/build-app.bat`.

- **Folders** — INBOX, Sent, Drafts, Trash, Spam with live counts.
- **Conversations** — toggle in the toolbar. Your inbox collapses 149 rows to 102.
- **Outbox + Send later** — pick a date/time in compose; it goes out even if you close the app.
  Cancel or retry anything queued.
- **Calendar invites** — a meeting invite shows a card with the time and an Add to calendar button.
- **Signatures** — set one in Settings; it is added when you confirm a send.
- **Contacts** — start typing in To and it suggests people you already email.
- **Assistant** — the sidebar has a standalone chat. It still cannot send or delete.



- **Folders** — INBOX, Sent, Drafts, Trash, Spam sync from your real mailbox with live counts.
- **Outbox + Send later** — pick a date/time in compose and the mail waits in the Outbox.
  It goes out even if you close the app. Cancel or retry anything queued.
- **Assistant** — click "✦ Assistant" in the sidebar to chat without opening a message.
  It still cannot send or delete; that is always your click.


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

**Also new — Aether Mail is a downloadable desktop app.** Tauri 2 shell, 11MB exe, 25MB installer.
It opens its own window, starts its own backend, and shuts it down when you close it. Verified the
way a stranger would get it: I dropped the backend alone into an empty folder with no repo and no
Node installed, and it booted and served mail.

Tests: **vitest 75/75**, **cargo green + clippy clean**, installer builds.

## What to click

1. Click your Gmail account in the sidebar → **Fetch INBOX**.
2. Open a message with images → **Load images** if you trust the sender.
3. Open something suspicious-looking → header inspect should auto-open.
4. Chat: `what's in my inbox`, `inspect headers`, `remember that …` — all local, no Ollama wait.
5. Reply to something → **Confirm send** twice.

## Still not a daily driver

- No OAuth (app password only — some work/school tenants block this)
- Installer is unsigned (SmartScreen warning). We ship build provenance + checksums + a portable zip instead,
  which is what OSS projects do before they can afford a cert. Path to signing: `docs/SIGNING.md`
- The bundled backend is 89MB because it carries Node's runtime; our code is 86KB of that. Porting it to
  Rust would cut the installer to ~8MB — that's the next big win
- Attachments/inline images work in tests, but **none of your 40 fetched newsletters actually had one** —
  send yourself a mail with a PDF and an inline logo to confirm it on real mail
- Overnight store is still `data/mail.json`, not the Rust SQLite store yet
- Public GitHub: no

Money (honest, not a pitch): `docs/INCOME.md` — free MIT client, optional Aether+ later.
