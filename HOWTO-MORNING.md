# Morning runbook

Ollama optional (`ollama serve`, model `mistral`) — mail works without it.

```
C:\Users\Sumo\Documents\aether-mail\scripts\start-mvp.bat
```

Open http://127.0.0.1:5173/  (hard-refresh after a pull/restart)

## Click through

- 3-pane + olive/copper theme. Narrow the window for phone panes (← Inbox).
- Phish fixture: threat score + **Move to Spam**. `!` also files to Spam.
- **Reply** / Draft reply → Confirm send names the **sender**. Fixture SMTP still honest-fails until a real account.
- Chat/Settings: `move newsletters to spam`, `keep invoices unread`, Forget a rule
- **?** shortcut list. Esc closes overlays. Phone **Folders** drawer.
- **Fetch INBOX** on the toolbar after you save an account.
- Settings: Your voice, Workflows, Audit (30 days)
- **+ New folder**, **Move to…**, Unread only

## Real mail

`cargo build -p aether-cli` first. App password only. Fetch INBOX. Do not LAN-bind the API.

## Not this build

Native iOS/Android, OAuth, auto-reply, public GitHub, Tauri `.exe`.
