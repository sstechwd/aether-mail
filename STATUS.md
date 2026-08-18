# STATUS.md — morning briefing

**Updated:** 2026-08-17 21:16 PDT  
**Do not push.** Repo is private. Branch even with origin.

## How to start

`scripts\start-mvp.bat` → http://127.0.0.1:5173/  
Hard-refresh after restart. Mail works without Ollama.

## What works

3-pane client on a local Node host. Fixture inbox is usable. Real IMAP is **app-password + Fetch INBOX**, password in Windows Credential Manager, never on disk.

- Star / archive / trash / unread / compose / reply / forward
- Spam folder, **!** files there, threat banner can **Move to Spam**
- Spoken workflows (`move newsletters to spam`, `keep invoices unread`) compile locally — no Ollama
- Chat lists those rules without calling the model
- Settings: Your voice (max 8 samples), Workflows + Forget, Audit (30 days, no bodies), Remove account (also drops the keyring entry)
- Phone: narrow the window — list → tap mail → ← Inbox, **Folders** drawer
- Last folder remembered. **?** keys. Esc closes overlays.

Tests just now: **cargo 16** / **vitest 45** / web build green.

## What to click

1. Open the phish fixture. Threat score + Move to Spam.
2. Reply → Confirm send should name the **sender**, not you.
3. Chat: `what are my workflows` (local, no wait). Then `keep invoices unread`.
4. Settings → Remove an account if you saved one to try. Password should leave the machine.
5. After a real app-password account: **Fetch INBOX** on the toolbar.

## Still not a daily Gmail driver

- No Google/Microsoft **OAuth** (app password only; many work tenants will refuse)
- Fixture SMTP still honest-fails until a real account
- No Tauri `.exe` — this is still the Vite tab
- Phone is **responsive browser**, not a store app. API stays `127.0.0.1`
- No auto-reply / auto-send. Agent never confirms send.
- Tutanota unsupported. Proton only via Bridge.
- Public GitHub: no

Income (honest, not a pitch): `docs/INCOME.md` — free MIT client, money later as optional Aether+.
