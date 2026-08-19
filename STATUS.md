# STATUS.md — morning briefing

**Updated:** 2026-08-19 (MIME + Tauri session) · private repo · **local commits waiting, not pushed** — say the word.

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
- Installer is unsigned (SmartScreen warning). Needs a code-signing cert (~$100-400/yr) before public release
- The bundled backend is 89MB because it carries Node's runtime; our code is 86KB of that. Porting it to
  Rust would cut the installer to ~8MB — that's the next big win
- Attachments/inline images work in tests, but **none of your 40 fetched newsletters actually had one** —
  send yourself a mail with a PDF and an inline logo to confirm it on real mail
- Overnight store is still `data/mail.json`, not the Rust SQLite store yet
- Public GitHub: no

Money (honest, not a pitch): `docs/INCOME.md` — free MIT client, optional Aether+ later.
