# STATUS — Aether Mail

**Updated:** 2026-08-20 · `main` and `dev` at `7d31c0d` · repo is **PUBLIC** (MIT)

## Run it

Double-click `scriptsun-app.bat`. Rebuild after code changes with
`scriptsuild-app.bat` (it closes the running app first).

## What works right now

Mail: IMAP fetch across INBOX/Sent/Drafts/Trash/Spam, real MIME parsing,
attachments in and out, reply/reply-all/forward, threading, local search.

Sending: two human clicks + a token. **The agent cannot send or delete** — not
by policy, but because `agent.ts` has no import path to the send code.

Writing: rich-text compose (bold, italic, lists, links). Formatted mail goes as
multipart/alternative so plain-text readers still get a readable part.

Organising: multi-select (ctrl/shift-click), right-click menu, 12-second undo,
drag mail onto folders, filing rules, snooze, mute thread, Outbox with scheduled
send that survives closing the app.

Views: Calendar (month/week/day), Contacts, Rules, Assistant, All inboxes
(hidden until you add a second account). Resizable panes. Five themes.

Press `?` for the shortcut sheet.

## Known limits

- **Storage does not scale yet.** `data/mail.json` is 8.0 MB for 246 messages,
  fully resident in RAM — about 325 MB at 10,000. Fine for one mailbox, wrong
  before anyone connects a large archive. SQLite + FTS5 is the fix.
- CI cannot run: the GitHub token lacks the `workflow` scope. One command fixes
  it, and it needs a browser so only you can run it:
  `gh auth refresh -h github.com -s workflow`
- No code-signing certificate, so Windows SmartScreen warns on first run.
  `docs/SIGNING.md` is honest that there is no technical way around this.

## Next

1. SQLite + FTS5 in `crates/mail-store` — the only remaining item that changes
   what the app can do
2. Conversation view in the reading pane (threading groups; the pane still
   shows one message)
3. Attachment previews

## Tests

292 API · 47 web · 24 Rust suites. `npm run test` and `cargo test --workspace`.
