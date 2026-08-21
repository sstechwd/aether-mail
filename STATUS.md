# STATUS — Aether Mail

**Updated:** 2026-08-21 · `main` and `dev` at `3a488ed` · repo is **PUBLIC** (MIT)

## Run it

Double-click `scripts\run-app.bat`. Rebuild after code changes with
`scripts\build-app.bat` (it closes the running app first).

## The one thing that needs you

**Register a Google OAuth client id — free, about five minutes.**
Steps are in `docs/OAUTH.md`. Then:

```
setx AETHER_OAUTH_CLIENT_GMAIL "your-id.apps.googleusercontent.com"
```

Google and Microsoft are removing app passwords, so this is the path that keeps
working. Everything else on the OAuth side is built; it has just never been run
against a live account, because that needs the id.

## What works

**Mail** — IMAP across INBOX/Sent/Drafts/Trash/Spam. Real MIME, attachments
both ways, reply/reply-all/forward, threading, search.

**It arrives on its own now.** IMAP IDLE holds a connection open, so mail shows
up the moment it lands rather than on a timer. A five-minute poll runs
underneath as a safety net.

**And it syncs cheaply.** The client remembers where it got to per folder and
asks only for what is new — 2.2 MB down to nothing when the mailbox has not
changed.

**Sending** — two human clicks plus a token. The agent cannot send or delete;
`agent.ts` has no import path to the send code, so it is not a rule it follows
but a capability it lacks.

**Writing** — rich text (bold, italic, lists, links), sent as
multipart/alternative so plain-text readers still get something readable.

**Organising** — multi-select, right-click menu, 12-second undo, drag mail onto
folders, filing rules, snooze, mute thread, an Outbox with scheduled send that
survives closing the app. Right-click a folder you made to remove it.

**Reading a thread reads as a thread.** The reading pane shows the whole
conversation, oldest first — the order it happened in. The list stays newest
first, because there you are scanning rather than reading.

**Attachments open in-app.** Images, PDFs and text preview inline in a
sandboxed frame; everything else downloads as before. What may be previewed is
decided server-side from an allow-list, and a file whose name disagrees with
its declared type never previews.

**Newsletters can be stopped, not just filed.** ⊘ Unsubscribe appears on any
message whose sender advertised a safe https unsubscribe. A sender who only
accepts unsubscribe by email is deliberately NOT actioned — that would mean
sending mail on your behalf.

**The agent can build things.** ⚡ Automate this on any message: it proposes a
rule or template, you see it in plain English, one click creates it. The Rules
page also shows what it noticed across the whole inbox — "19 messages from
Amazon, one rule files them all" — and, separately, what it deliberately did
NOT suggest and why. It physically cannot propose sending or deleting.

**Your data is yours** — Settings → Your data → Back up now. The archive is a
SQLite file plus JSON; `sqlite3 mail.db` opens it with Aether uninstalled.
Passwords are never in it; they live in the OS keyring.

Press `?` for the shortcut sheet. Five themes in Settings.

## Known limits

- **No code-signing certificate**, so Windows SmartScreen warns on first run.
  `docs/SIGNING.md` is honest that there is no technical way around this —
  it needs money, not code.
- **IDLE watches INBOX only**; other folders use the interval.
- **CI cannot run**: the GitHub token lacks the `workflow` scope. One command,
  needs a browser so only you can run it:
  `gh auth refresh -h github.com -s workflow`

## Next

1. More agent proposal types: mute and snooze (unsubscribe already ships as a
   button, and each new one is a single validated entry in the same allow-list)
2. Batch approval — show five suggestions, tick the ones you want
3. IDLE on more than just INBOX

## Tests

495 API · 47 web · 24 Rust suites. `npm run test` and `cargo test --workspace`.
Every performance claim above was measured against the real mailbox.
