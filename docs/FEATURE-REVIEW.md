# Feature review — where Aether Mail stands

Updated 2026-08-20 against the shipped app.

**Note on method:** web search is not configured in this environment, so this is
a review against domain knowledge of Thunderbird / Outlook / Gmail / Apple Mail
rather than freshly cited sources. Treat the competitive claims as "what these
clients have shipped for years", not as researched citations.

## Have

| Feature | State |
|---|---|
| IMAP fetch, multi-folder | INBOX / Sent / Drafts / Trash / Spam |
| Real MIME parsing | multipart, quoted-printable, RFC 2047 subjects |
| HTML mail, sandboxed | no scripts, no same-origin, CSP `default-src 'none'` |
| Remote image control | ask / always / never + per-sender trust |
| Attachments | receive and send, multipart/mixed, 24MB cap |
| Reply / reply-all / forward | correct recipients, quoted body |
| **Rich-text compose** | bold/italic/lists/links → multipart/alternative |
| Send | two-click confirm + token; agent structurally cannot send |
| Outbox | scheduled send, survives app close, exponential backoff |
| Threading | References/In-Reply-To with subject fallback |
| **Multi-select** | ctrl/shift-click, bulk actions in one request |
| **Right-click menu** | read/unread, flag, move, snooze, mute, delete |
| **Undo** | 12s window after any move or delete |
| **Filing rules** | user-editable, run on demand and on sync |
| **Snooze** | later/tomorrow/weekend/next week, survives app close |
| **Mute thread** | new replies arrive read and archived |
| **Unified inbox** | all accounts merged; hidden when only one exists |
| Search | local, across the store |
| Calendar | month/week/day, local events, invite detection |
| Contacts | harvested, prunable, people-vs-bulk ranking |
| Signatures | per account, applied at confirm time |
| Drag to folder | message → folder in the sidebar |
| Resizable panes | draggable, persisted, keyboard accessible |
| Pop-out window | message in its own window |
| Themes | five, user-selectable |
| Keyboard shortcuts | grouped cheat sheet on `?` |
| Agent | summarize / draft / triage, never sends or deletes |
| Threat + header inspect | SPF/DKIM/DMARC, local only |

## Missing

### 1. Local search index — **the one that matters now**
Search scans the store linearly and the whole mailbox is resident in RAM.
Measured: **8.0 MB for 246 messages → ~325 MB at 10,000**. Fine today, wrong
before anyone connects a real archive. The SQLite FTS5 migration in
`crates/mail-store` is the fix and is already scoped.

### 2. Conversation view polish
Threading groups correctly but the reading pane still shows one message. A real
conversation view stacks the thread with collapsed quotes.

### 3. Attachment previews
Attachments download. Viewing a PDF or image without leaving the client is a
convenience most clients have.

### 4. Multiple signatures per account
One signature per account today. Per-identity signatures matter to anyone using
aliases.

### 5. Server-side search
IMAP SEARCH for mail older than what has been synced locally.

## Deliberately not doing

- **CalDAV / CardDAV sync.** The calendar hands events to the OS. Becoming a
  sync engine is a different product.
- **Server-side rules.** Local-first means the rules run here.
- **A plugin API.** The real extension surface is agent skills; that should
  stabilise before it gets a compatibility promise.
- **A scripting terminal.** Dropped at the user's request — and it is the one
  feature that could hand the agent a send path, so it needs a deliberate
  design decision rather than a bolt-on.

## Suggested order

1. SQLite + FTS5 in `crates/mail-store` — unblocks large mailboxes and search
2. Conversation view in the reading pane
3. Attachment previews
