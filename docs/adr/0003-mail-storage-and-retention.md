# ADR 0003 — Mail storage, cache mode, and owning your data

**Status:** accepted · 2026-08-20

## The questions

From the user, verbatim:

> How are we storing the mail? I would like people to eventually back up their
> profiles and what not and own their data similar to how you would back up a
> pst or ost, is it needed? Maybe have an optin like cache mode and not cached
> similar to Outlook since most people will be using a service and most likely
> not hosting their own email and since its IMAP is this even an issue?

Three separate questions, and they have different answers.

## 1. How mail is stored today

`data/mail.db` — SQLite, with an FTS5 index over subject, sender and body.
One file, plus the `-wal` and `-shm` sidecars SQLite keeps while running.

This replaced a single `mail.json` that held every message in memory and
rewrote itself on any change: 7.9 MB for 246 messages, so roughly 325 MB at
10,000.

Alongside it, in the same `data/` directory: `outbox.json`, `calendar.json`,
`rules.json`, `snooze.json`, `mute.json`, `signatures.json`, `images.json`,
`hidden-contacts.json`, `audit.jsonl`, `accounts.json`.

**Passwords are not in any of them.** Credentials live in the OS keyring and are
referenced by a `secret-ref` string. That is deliberate and it changes the
backup story completely: a copy of `data/` is not a copy of your credentials.

## 2. Is a PST/OST-style backup needed?

**Yes, and we are closer to it than Outlook ever was.**

A PST is a proprietary container you need Outlook to open. Our equivalent is a
directory of a SQLite database and some JSON. That is better in three ways:

- **Any tool can read it.** `sqlite3 data/mail.db` works today, on any OS, with
  no Aether installed.
- **Copying the folder is the backup.** No export wizard, no format version.
- **It is auditable.** A user can see exactly what we keep. "Own your data" is
  only true if you can inspect it without our permission.

What is still missing is the *ergonomics*: a single "Back up my mail" button
that produces one timestamped archive, and a matching restore. That is a small
piece of work and it is now on the roadmap.

The one real caveat: SQLite must be copied while the app is closed, or copied
via `VACUUM INTO`, otherwise the `-wal` file matters and a naive copy can be
inconsistent. A backup command should use `VACUUM INTO` for exactly this
reason. **Do not tell users to copy the file while the app is running.**

## 3. Cache mode vs online mode — do we need Outlook's toggle?

**Not as a toggle, and the IMAP question the user asked is the reason.**

Outlook's cached/online distinction exists because Exchange offered a fast
server-side experience over a corporate LAN, and cached mode was the
concession for laptops. The trade-off was real in 2003.

For an IMAP client in 2026, "online mode" would mean: search by asking the
server, open a message by fetching it every time, show the folder list from the
server on every render. That produces a client that is slower, breaks entirely
on a plane, and leaks a request to the provider for every action the user
takes. It is strictly worse for a local-first product.

**But the user's instinct is right about the underlying problem**, which is not
online-vs-cached. It is *how much* we cache, and there we currently have no
answer at all: we sync everything we fetch and never age anything out. That is
fine at 246 messages and wrong at 200,000.

So the decision is:

- **No online mode.** Local-first is the product. Adding a mode that makes the
  app worse in order to feel familiar is cargo-culting Outlook.
- **Yes to a retention setting**, which is the useful half of what cached mode
  actually gives you:
  - keep everything (default, correct for most people)
  - keep the last N days of bodies, envelopes forever
  - keep envelopes only, fetch bodies on demand

  The third option is genuinely "online mode" for anyone who wants it, without
  making it the default or calling it that.

Note the asymmetry that makes this safe: **envelopes are cheap and bodies are
expensive.** On the live mailbox, envelopes are a few hundred KB while bodies
and HTML are ~7 MB of the 7.9 MB total. Keeping every envelope forever and
ageing out bodies gives a complete, searchable-by-header mailbox for almost no
disk, and re-fetching a five-year-old message body over IMAP takes a moment.

## Consequences

- The next storage work is **backup/restore using `VACUUM INTO`**, not a cache
  mode toggle.
- A **retention setting** follows, defaulting to "keep everything".
- IMAP remains the source of truth for anything we have aged out. We are a
  client; the server already has the mail. That is what makes retention safe
  here and is the direct answer to "since it's IMAP is this even an issue?" —
  the risk of deleting a local copy is low precisely because we never had the
  only copy.
- We should document the `data/` layout in the README so "own your data" is
  verifiable rather than a claim.
