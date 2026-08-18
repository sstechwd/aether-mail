# Sibyl Memory in Aether Mail

Hackathon entry: **Memories That Last / Sibyl Memory**.

We bake in the official `sibyl-memory-client` (v0.6, MIT). Memory is a **local SQLite file** (`data/sibyl.db`). Free unactivated use makes **no network calls**. Mail bodies and passwords are never written.

## Why this, not a clone

Sibyl Labs: SQLite + FTS5, five tiers, no embeddings. That matches Aether’s local-first mail store. We wrap the SDK; we do not fork it and we do not send the inbox to `api.sibyllabs.org`.

## What the agent does

| You say | What happens |
|---|---|
| `remember that Priya prefers Friday 9:30` | `set_entity(note, …)` on this machine |
| `what do you remember` | `list_entities` — no Ollama wait |
| Teach a workflow / save a voice sample | Also stored as entities |
| Chat or draft-reply | `search_entities` injects a short prompt block |

## Files

- `scripts/sibyl_aether.py` — official SDK CLI
- `apps/api/src/sibyl.ts` — Node spawn wrapper
- Settings → **Sibyl memory**

Requires `python` + `pip install sibyl-memory-client` (already on this machine).

## Honest limits

We do **not** call `sibyl init` (that opens a browser / account). Optional paid Sibyl tiers (self-learning linter, 5 MB cap lift) are not required for this client. The mailbox never leaves the PC unless you check allow-cloud for an LLM.
