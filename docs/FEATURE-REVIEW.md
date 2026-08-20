# Feature review — where Aether Mail stands

Written 2026-08-20 against the shipped app, not the roadmap.

**Note on method:** web search is not configured in this environment, so this is
a review against domain knowledge of Thunderbird / Outlook / Gmail / Apple Mail
rather than freshly cited sources. Treat the competitive claims as "what these
clients have shipped for years", not as researched citations. Where a number or
a specific behaviour matters, verify before relying on it.

## Have

| Feature | State |
|---|---|
| IMAP fetch, multi-folder | INBOX / Sent / Drafts / Trash / Spam |
| Real MIME parsing | multipart, quoted-printable, RFC 2047 subjects |
| HTML mail, sandboxed | no scripts, no same-origin, CSP `default-src 'none'` |
| Remote image control | ask / always / never + per-sender trust |
| Attachments | receive and send, multipart/mixed, 24MB cap |
| Reply / reply-all / forward | correct recipients, quoted body |
| Send | two-click confirm + token; agent structurally cannot send |
| Outbox | scheduled send, survives app close, backoff on failure |
| Threading | References/In-Reply-To with subject fallback |
| Search | local, across the store |
| Calendar | month/week/day, local events, invite detection |
| Contacts | harvested, prunable, people-vs-bulk ranking |
| Signatures | per account, applied at confirm time |
| Drag to folder | message → folder in the sidebar |
| Resizable panes | draggable, persisted, keyboard accessible |
| Pop-out window | message in its own window |
| Themes | five, user-selectable |
| Agent | summarize / draft / triage, never sends or deletes |
| Threat + header inspect | SPF/DKIM/DMARC, local only |

## Missing, ranked by how often a real user hits it

### 1. Mark as read/unread and flag from the list — **daily**
Right now reading is implicit and there is no right-click. Every client has a
context menu on a row: mark read/unread, flag, move, delete. This is the single
biggest gap between "works" and "usable".

### 2. Multi-select — **daily**
Shift-click and ctrl-click to act on many messages at once. Deleting 40
newsletters one at a time is why people abandon a client.

### 3. Undo — **weekly, but the one that builds trust**
A short undo window after move/delete/archive. Gmail's undo-send is the most
copied feature in email for a reason: it converts anxiety into confidence.

### 4. Rules / filters — **set once, used forever**
"From X → move to Y", "subject contains Z → mark read". We have spoken
workflows, which are close, but they are agent-driven rather than a plain
deterministic rule list the user can read and edit.

### 5. Snooze — **weekly**
Hide a message until a chosen time. Modern clients treat this as core; it is
also a natural fit with the Outbox scheduler already built.

### 6. Unified inbox — **daily for multi-account users**
Accounts exist and are isolated; there is no combined view.

### 7. Rich-text compose — **whenever a link or bold is needed**
Compose is plain text only. Sending a formatted reply to a formatted thread is
a normal expectation.

### 8. Keyboard shortcuts, discoverable — **power users leave without them**
Some exist. There is no cheat sheet and no customisation.

### 9. Conversation actions — **mute a noisy thread**
Mute / always-move for a whole thread rather than per message.

### 10. Local search index — **degrades with mailbox size**
Search scans the store linearly. Fine at 250 messages, not at 50,000. The
SQLite FTS5 migration in `crates/mail-store` is the fix and is already planned.

## Deliberately not doing

- **CalDAV / CardDAV sync.** The calendar hands events to the OS. Becoming a
  sync engine is a different product.
- **Server-side rules.** Local-first means the rules run here.
- **A plugin API.** The real extension surface is agent skills; that should
  stabilise before it gets a compatibility promise.

## Suggested order

1. Right-click context menu + mark read/unread + flag (unblocks 1 and 2)
2. Multi-select with shift/ctrl
3. Undo for move/delete
4. Rules the user can read and edit
5. Snooze, reusing the Outbox scheduler
6. Rich-text compose
7. SQLite/FTS5 before anyone with a large archive arrives
