# STATUS.md — unattended stretch (running until 21:00)

**Updated:** 2026-08-17 18:57  
**Do not push.** Private. Ahead of origin.

## Click after restart + hard refresh

`scripts\start-mvp.bat` → http://127.0.0.1:5173/

- Theme polish (folder drawer, keys card, threat banner)
- Settings: **Remove** account — also drops the Windows keyring entry
- **Fetch INBOX** on the toolbar
- **?** keys, Esc closes overlays, phone Folders
- `keep invoices unread`, Forget a workflow
- Reply Confirm send names the sender

## Tests

cargo + aether-cli build green. vitest **44+**. web build clean.

## Still not

OAuth, auto-reply, store app, Tauri `.exe`, public GitHub.

Income: `docs/INCOME.md`
