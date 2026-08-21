# Is Aether Mail a daily driver yet?

Updated 2026-08-21 against the shipped app. Supersedes the 2026-08-20 version,
which listed four blockers — three are now closed.

---

## Question 1: how close to a daily driver?

**Yes for a companion mailbox. Yes for your only mailbox once you register an
OAuth client id — which takes about five minutes and is free.**

That is a real change from yesterday, when the answer was "not for your only
mailbox" and the reason was OAuth.

### What works, verified against a live 259-message account

Not fixtures. Every number below came from the real mailbox.

| | |
|---|---|
| IMAP sync | INBOX / Sent / Drafts / Trash / Spam |
| **Push (IMAP IDLE)** | mail arrives instantly; connection held open, verified `ESTABLISHED` to Gmail |
| **Incremental sync** | 2.2 MB → 0 KB when nothing changed; 3273ms → 947ms |
| **OAuth2 + XOAUTH2** | PKCE loopback, IMAP and SMTP, refresh on every sync |
| Storage | SQLite + FTS5; search returns 146 hits in 7ms |
| MIME | multipart, quoted-printable, RFC 2047, attachments both ways |
| Send | two-click confirm; scheduled send survives app close |
| Rich text | bold/italic/lists/links → multipart/alternative |
| Organising | threading, multi-select, right-click, 12s undo, drag-to-folder |
| Automation | rules, snooze, mute — running on sync, not just on demand |
| **Backup** | one button; archive opens in `sqlite3` with Aether uninstalled |
| Agent | summarize / draft / triage / action-items, plus **automation proposals** |

### The one blocker left

**Unsigned binary.** Windows SmartScreen warns on first run. A certificate
costs money the project does not have. Mitigated by build provenance and
SHA-256 checksums, not solved. This is the only remaining item that is not
fixable with code.

### What still needs you, not me

**An OAuth client id.** Free, about five minutes, steps in `docs/OAUTH.md`.
Until then Aether falls back to app passwords, which Google and Microsoft are
actively removing. The protocol work is done and unit-verified; it has never
been exercised against a live Google account because that requires the id.

### Honest caveats

- **OAuth is implemented but not proven end-to-end.** Every piece is verified
  in isolation and against the real Google authorisation endpoint. Nobody has
  completed an actual sign-in yet.
- **IDLE watches INBOX only.** Other folders still rely on the interval.
- **Sync is per-folder sequential**, so a cold sync of five folders takes ~18s.
  Warm is ~11s and mostly connection overhead now, not data.

### Verdict

Use it. The failure modes that made "companion only" the honest answer —
mail arriving late, app passwords dying, a mailbox that grows without bound —
are fixed. It will not lose your mail: the server keeps it, and there is a
backup button that produces something any tool can read.

---

## Question 2: is it actually agentic, like Hermes?

**Partly, and the honest version of that is worth stating precisely.**

### What changed

It used to be four skills — summarize, draft-reply, triage, action-items — all
text-in-text-out, with **zero references to app state**. It could say "you
should file these newsletters" and then you built the rule by hand. That is a
chatbot bolted to a mailbox.

Now: `⚡ Automate this` on any message. The model proposes a rule or template,
you see it in plain language, one click creates it.

### The architecture matters more than the feature

    model → structured proposal → validate against allow-list
          → describe in plain words → HUMAN CLICK → execute

The model never touches the store. **Mail is attacker-controlled input**, so a
model that can act on mail can be told to act by whoever wrote the message.
Every "give the LLM tools" design has to answer that; most answer with a system
prompt, which is not an answer.

There is no send or delete action in the schema at all. Verified against the
running app:

    REFUSED 400  send_email
    REFUSED 400  delete_messages
    REFUSED 400  run_shell
    REFUSED 400  empty pattern (would file the whole mailbox)
    created 201  a legitimate rule

### Where it still sits behind Hermes

| | Hermes | Aether |
|---|---|---|
| Tool calls | many, composable | 2 (rule, template) |
| Multi-step plans | yes | one proposal at a time |
| Scope | anything | one open message |
| Memory | persistent | 8-turn window |
| Model | cloud-scale | Ollama on your CPU |

The last row shapes everything else. A 7B model on a CPU will not reliably plan
a mailbox reorganisation. It *will* reliably produce one structured suggestion
about one message. The scope is a deliberate match to that, not a placeholder.

### What moves the needle next

1. **Propose from a folder, not one message.** "These 40 newsletters share a
   sender — one rule files them all." Highest value by far.
2. **More proposal types**: mute, snooze, unsubscribe. Each is one validated
   entry in the same allow-list, so each is cheap and equally safe.
3. **Batch approval** — show five, tick the ones you want.
4. **Let a rule call the agent** — "summarize anything from my manager" — with
   the same no-send guarantee.

None of these need a bigger model. They need more verbs in the allow-list,
which is the useful shape of this design: adding a capability means adding a
validated entry, not widening what the model may touch.

---

## Summary

- **Daily driver: yes**, once you register an OAuth client id. The only
  remaining code-side gap is a signing certificate, which is money.
- **Agentic: partly.** The plumbing is right and provably safe; the surface is
  small and deliberately matched to what a local model does well.

## Test coverage behind these claims

402 API · 47 web · 24 Rust suites. Every performance number above was measured
against a real mailbox, not a fixture.
