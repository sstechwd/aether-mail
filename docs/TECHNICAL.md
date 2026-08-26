# TECHNICAL.md — Aether Mail now

**Read this in a UI-design chat.** Stack is locked. Do not relitigate it.
**Date:** 2026-08-25 · branch `dev` · version **0.1.1** · public MIT `sstechwd/aether-mail`

Coding repo: `C:\Users\Sumo\Documents\aether-mail`
UI clone: `C:\Users\Sumo\Documents\aether-mail-ui` (branch `ui-design`)

---

## What it is

A **desktop mail client** (not a host) with a Thunderbird 3-pane and a small
in-process agent. The user brings IMAP/SMTP. Mail stays on disk. The agent can
file and draft. **It cannot send.** Confirm-to-send is two human clicks.

Not Electron. Not a Thunderbird fork.

## Stack (do not change)

| Layer | Choice |
|---|---|
| Window | Tauri 2 (`apps/desktop`) |
| UI | React 19 + TypeScript + Vite (`apps/web`) |
| Look | CSS variables in `apps/web/src/styles.css` — not a new CSS framework |
| API (temporary) | Node on `127.0.0.1:8787` (`apps/api`), shipped as a Node SEA sidecar |
| Mail I/O | Rust `aether-cli` — IMAP, SMTP, OS keyring |
| Store | SQLite + FTS5 (`crates/mail-store`); overnight UI still uses JSON in `%APPDATA%\Aether Mail` |
| Secrets | Windows Credential Manager / OS keyring. Never JSON, argv, or logs |

Details: `docs/CONVENTIONS.md`. ADR to change the stack.

## Layout the UI agent actually touches

```
apps/web/src/App.tsx          3-pane + compose overlay + drag + onboard
apps/web/src/styles.css       tokens + themes (retro / modern / filament)
apps/web/src/Settings.tsx     accounts, models, header-inspect prefs
apps/web/src/AgentChat.tsx    agent pane
apps/web/src/drag.ts          pointer drag (not HTML5)
```

Keep class names: `shell`, `folders`, `list`, `read`, `agent-chat`,
`compose`, `compose-veil`, `settings`, `toolbar`, `statusbar`, `threat`,
`mail-frame`, `row`, `folder`.

Theme via `document.documentElement.dataset.theme` and
`localStorage aether.theme`.

## Working (do not reimplement)

- 3-pane mail, sandboxed HTML, remote images off until Load
- Pointer-drag message onto any mail folder; undo toast
- Chat: make a folder / rule / move this / always file this sender — runs now
- Inbox watch: IMAP IDLE + 2 min poll; list redraws; button is **Sync now**
- Reply / New is a centered overlay (not a clipped corner sheet)
- Mail links and linked (even blocked) images open in the **system browser**
- List cursor is a pointer; grabbing only while dragging
- Headers stay closed unless Settings → Header inspect
- Rules: from / to / subject / **body**. Never send/reply as an action
- SuperGrok OAuth for the **model**. Claude/ChatGPT stay API key
- Gmail/Outlook **mail** OAuth is implemented (PKCE, system browser) but
  needs `AETHER_OAUTH_CLIENT_GMAIL` / `_OUTLOOK` — until then app password
- Fresh install finds `aether-cli` next to the exe (0.1.1)

## Hard rules

- No `innerHTML` for mail. Sandboxed iframe only.
- Agent never sends or deletes. The model cannot click Confirm.
- No auto-reply, no auto-send.
- Do not bind the API to the LAN.
- Do not restyle IMAP, OAuth, or keyring.
- HTML5 drag-and-drop does **not** work in Tauri/WebView2 on Windows.
  Pointer events only.

## How to see UI changes

1. API on `:8787`, Vite on `http://127.0.0.1:5173/`
2. If Vite is down you are looking at a **packaged** build — CSS edits are invisible
3. Change a visible string first, then tokens
4. `npm run build -w @aether/web` before claiming it ships

Dev loop from the coding repo: `scripts\start-mvp.bat`

## Packaging

Windows NSIS: `target/release/bundle/nsis/Aether Mail_0.1.1_x64-setup.exe`
Install dir: `%LOCALAPPDATA%\Aether Mail`
User data: `%APPDATA%\Aether Mail`

Mac/Linux: build **on that OS**. `docs/PACKAGING.md`.

## What UI work is for

A modern overhaul of chrome (Outlook-calm, not purple SaaS). Keep the 3-pane.
Do not invent an inline social browser. Do not pack a model into the installer.
