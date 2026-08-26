# What to implement first

Order is daily-driver mail, then agentic. Not themes.

1. **Drag mail onto a folder** — pointer-based, not HTML5. Tauri/WebView2 eats HTML5 drag.
2. **Move / file this / always file this sender** — chat + a visible button. Already in this build.
3. **Rules you can see and undo** — Rules sidebar, Run on Inbox, undo toast after a move.
4. **Short command chains** — “file this to Receipts and always do that for this sender”.
5. **Search that finds mail** — FTS5 exists; the box has to feel like Outlook, not a debug field.
6. **Incoming without Fetch** — IMAP IDLE + UI refresh. In this build.
7. **Gmail/Outlook OAuth** — app passwords are a stopgap.
8. **Only then** — richer calendar, more models, polish.

Do not: desktop filesystem tools (Hermes), auto-send, forking Thunderbird.
