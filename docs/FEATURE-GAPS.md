# Feature gaps vs Thunderbird / Gmail / Outlook

Written 2026-08-19 after the attachment bug ("no button to attach a file").
The point of this document is to be honest about what a person switching from
another mail client will immediately miss, and to rank it by *how often the gap
is hit* rather than by how interesting it is to build.

## Now shipping

| Feature | State |
|---|---|
| Read mail (IMAP, real MIME, HTML sandbox) | Works |
| Send mail (SMTP, two-click confirm) | Works |
| **Attachments — send** | **Works (this change)** |
| Attachments — receive, download, inline images | Works |
| Multi-account, switcher, per-account isolation | Works |
| Search | Works (substring; not FTS yet) |
| Star, archive, mark unread, file to folder | Works |
| Spoken workflows (rules compiled locally) | Works |
| Agent: summarize, draft, triage — never sends | Works |
| Themes, onboarding, phone-responsive panes | Works |

## The gaps, ranked by how often a normal user hits them

### 1. Reply / Reply-all / Forward buttons — **DONE**
Reply exists through the agent draft flow, but there is no plain Reply button on
an open message, and no Reply-all or Forward at all. This is the single most
embarrassing gap: it is the most-used control in any mail client. Cheap to build.

### 2. Delete / Trash — **DONE**
There is archive and file-to-folder, but no delete. IMAP delete is a flag plus an
expunge, and the agent must never be able to trigger it. Small, and its absence
makes the client feel like a demo.

### 3. Calendar / invitations — **DONE (invite detection)**
No calendar at all. The realistic first slice is not building a calendar app: it
is detecting `text/calendar` parts and `.ics` attachments in mail, showing
"Tuesday 3:00 PM — Design review", and offering *Add to calendar* (write an .ics
the OS handles) . A full calendar with CalDAV sync is a much larger project and
should not be attempted before reply/delete exist.

### 4. Contacts / address book / autocomplete — **DONE (harvested)**
Typing a full address every time is painful. The cheap version writes itself:
harvest addresses from mail already in the store and autocomplete the To field.
No CardDAV needed for v1.

### 5. Threading / conversation view — **DONE (toggle in the toolbar)**
Messages are a flat list. Real mailboxes are conversations. `References` and
`In-Reply-To` are already fetched, so grouping is mostly a UI problem.

### 6. Rich text compose — **hit when a user wants bold or a link**
Plain text only. Most people expect basic formatting. Requires generating a
`multipart/alternative` with an HTML part; the outgoing builder now added here
is the right place for it.

### 7. Signatures — **DONE**
No signature support at all. Trivial to add, disproportionately missed.

### 8. Unified inbox — **hit by anyone with two accounts**
Accounts are isolated (correct default), but there is no "all mail" view.

### 9. Offline queue / outbox — **DONE (scheduled send)**
A send with no connection fails rather than queueing. The store is local, so this
is achievable, but it needs care to never double-send.

### 10. Plugin / extension area — **hit by power users, and by us**
Requested explicitly. Worth doing *after* the basics, because the interesting
plugin surface is agent skills, and the skills system should stabilise first.
The honest v1 is a folder of `SKILL.md` files that appear in a picker — already
sketched in ROADMAP Phase 6.

## Deliberately not doing

- **Full CalDAV/CardDAV sync.** Large, and only valuable once calendar and
  contacts exist as real features.
- **Web version.** The product is a downloadable client.
- **Encryption (PGP/S-MIME).** Users who need it have strong opinions; doing it
  badly is worse than not doing it.

## Suggested order

Reply/Forward → Delete/Trash → Signatures → Contacts autocomplete → Threading →
Calendar (.ics detection) → Rich compose → Unified inbox → Outbox → Plugins.

The first three are a single short session and remove most of the "this is a
demo" feeling. Calendar is the first genuinely new *capability* rather than a
missing basic.


## Known scaling limit (measured 2026-08-20)

`data/mail.json` holds every synced message and is read into RAM at startup.
Measured on a real mailbox: **246 messages = 8.0 MB** (1.2 MB plain text, 5.6 MB
HTML). That projects to roughly **325 MB at 10,000 messages**, all resident.

This is fine for the current mailbox and untenable for a heavy one. The fix is
the SQLite migration already planned in `crates/mail-store` — bodies on disk,
envelopes in memory, FTS5 for search. Do that before inviting anyone with a
large archive, not after.

Not a bug today. Recorded so it is a decision rather than a surprise.
