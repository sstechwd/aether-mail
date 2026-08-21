# Is Aether Mail a daily driver yet?

Written 2026-08-21 against the shipped app, answering two direct questions.

---

## Question 1: how close to a daily driver?

**Close for a second mailbox. Not yet for your only mailbox.**

The distinction matters. Reading, searching, filing, and replying all work on a
real account today. What is missing is the set of things you only notice when
the app is the *only* way you get your mail — and when it fails, you have no
fallback.

### What genuinely works

Verified against a live 259-message Gmail account, not fixtures:

- IMAP sync across INBOX / Sent / Drafts / Trash / Spam
- SQLite + FTS5 — search returns 146 hits in 7ms
- Real MIME: multipart, quoted-printable, RFC 2047, attachments in and out
- Send, with two-click confirm; scheduled send survives closing the app
- Rich-text compose → multipart/alternative
- Threading, multi-select, right-click, undo, drag-to-folder
- Rules, snooze, mute — running on sync, not just on demand
- Backup that opens in `sqlite3` with no Aether installed
- Automatic sync every 5 minutes

### The four things that stop it being a daily driver

**1. No OAuth. App passwords only.**
Google and Microsoft are actively removing app passwords. Anyone with 2FA
enforced by an employer cannot connect at all today, and everyone else is on
a countdown. This is the single largest adoption blocker and it is not small
work: OAuth2 device flow, token refresh, and keyring storage per provider.

**2. Sync is coarse.**
Every cycle re-fetches the newest 40 per folder rather than asking IMAP what
changed since last time (UIDVALIDITY / MODSEQ). It works and it is idempotent,
but it is wasteful and it will not scale to a large mailbox on a slow link.

**3. No push.**
Five-minute polling means mail can be five minutes late. IMAP IDLE is the fix
and is a well-understood piece of work.

**4. Unsigned binary.**
Windows SmartScreen warns on first run. A certificate costs money the project
does not have yet. Mitigated by build provenance and checksums, not solved.

### Verdict

Use it as a **companion client on a real account you already have elsewhere**.
Today. It will not lose your mail — the server keeps it, and there is now a
backup button.

Do not yet make it the only way you read mail, mainly because of OAuth. When
OAuth and IDLE land, that recommendation changes.

---

## Question 2: is it actually agentic, like Hermes?

**It was not. As of today it is starting to be. Here is the honest gap.**

### What it was

Four skills — summarize, draft-reply, triage, action-items — all
text-in-text-out. `agent.ts` had **zero references to app state**. The model
could say "you should file these newsletters" and then *you* went and built the
rule by hand.

That is a chatbot bolted to a mailbox, not an agent. Hermes is agentic because
it can *call tools that change the world*.

### What it does now

`⚡ Automate this` on any message: the model proposes a rule or a template, you
see it in plain language, one click creates it.

The architecture matters more than the feature:

    model → structured proposal → validate against allow-list
          → describe in plain words → HUMAN CLICK → execute

The model never touches the store. **Mail is attacker-controlled input**, so a
model that can act on mail can be told to act by whoever wrote the message.
Every "give the LLM tools" design has to answer that, and most answer it with a
system prompt, which is not an answer.

There is no send or delete action in the schema at all. Verified live:

    REFUSED 400  send_email
    REFUSED 400  delete_messages
    REFUSED 400  run_shell
    REFUSED 400  empty pattern (would file everything)
    created 201  a legitimate rule

### Where it is still behind Hermes

| | Hermes | Aether today |
|---|---|---|
| Tool calls | many, composable | 2 (rule, template) |
| Multi-step plans | yes | no — one proposal at a time |
| Acts across a whole mailbox | yes | one open message |
| Memory across sessions | yes | 8-turn window |
| Model | cloud-scale | whatever Ollama runs on your CPU |

The last row is the real constraint, and it shapes everything. A 7B model on a
CPU is not going to plan a multi-step mailbox reorganisation reliably. Asking
it for **one small structured suggestion about one message** is a task it can
actually do — which is exactly why the surface is scoped that way, rather than
because it was easier.

### What would move the needle next

1. **Propose from a folder, not one message.** "These 40 newsletters share a
   sender — one rule files them all." The single highest-value step.
2. **More proposal types**: mute this thread, snooze until Monday, unsubscribe.
   Each is an entry in the same allow-list, so each is cheap and equally safe.
3. **Batch approval.** Show five proposals, tick the ones you want.
4. **Let a rule call the agent** — "summarize anything from my manager" — with
   the same no-send guarantee.

None of these need a bigger model. They need more verbs in the allow-list and a
better place to put them, which is the useful shape of this design: adding a
capability is adding a validated entry, not widening what the model may touch.

---

## Summary

- **Daily driver: not quite.** OAuth is the blocker; IDLE and incremental sync
  are the polish. Companion client: yes, today.
- **Agentic: starting.** The plumbing is right and provably safe. The surface
  is small — two verbs, one message at a time — and that is a deliberate match
  to what a local model can do well, not a placeholder.
