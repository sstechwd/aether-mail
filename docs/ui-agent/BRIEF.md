# UI agent brief

Work only under `C:\Users\Sumo\Documents\aether-mail`.
Do **not** change IMAP/SMTP/secrets. Theme the existing 3-pane React UI.

## Product

Thunderbird-shaped mail: folders | list | read+agent. Dark, calm, dense. Not a chatbot that ate the inbox.

## Do

1. Rewrite `apps/web/src/styles.css` into a clean modern dark theme (good type, spacing, focus rings, status bar).
2. Add a slim **status bar** at the bottom: last sync, unread, “agent idle/thinking”.
3. Make the agent pane look like a log (turns + a “thinking” line), not a blob of buttons.
4. Write `docs/ui-agent/NOTES.md` with the palette and why.

## Don’t

Electron, new CSS framework, innerHTML for mail, pastel SaaS landing page, commit unless asked.

Read `apps/web/src/App.tsx` and `AgentChat.tsx` first.
