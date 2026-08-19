# AGENTS.md — start here

This repo is **Aether Mail** — a local-first, downloadable desktop email client (not a host),
with an in-process agent. Private repo, MIT-intent core.

## Read in this order

1. **`CHECKPOINT.md`** (repo root) — current state: stack, repo map, working features, hard rules,
   next work, boot commands. Updated every session. **Start here, not the source tree.**
2. **`docs/CONVENTIONS.md`** — the binding stack lock and coding/security conventions. Do not
   relitigate the stack without writing an ADR in `docs/adr/`.
3. `STATUS.md` — human-facing morning briefing (what to click, what's not done yet).

## Non-negotiables (also in CONVENTIONS.md, repeated because they matter)

- Client only. No hosted mailbox. Not a Thunderbird fork.
- Agent never sends or deletes. Confirm-to-send is two human clicks + a token. The model cannot click it.
- Secrets live in the OS keyring via `aether-cli`. Never in JSON, argv, logs, or git.
- HTML mail renders in a sandboxed iframe. No `innerHTML`. Remote images off until the user opts in.
- TDD: write the failing test first.
- Repo is **private**. Push only when the human asks.

## If you are a fresh session with no other context

Say so, then read `CHECKPOINT.md` end to end before touching code. It is short on purpose.
