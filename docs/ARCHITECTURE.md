# ARCHITECTURE.md — Aether Mail

High-level only. Phase 1+ will add ADRs when a decision actually costs something.

## Picture

```
                    ┌─────────────────────────────────────────┐
                    │  React UI  (webview)                    │
                    │  lists, read, compose, agent drawer     │
                    │  never holds secrets or raw IMAP        │
                    └──────────────────┬──────────────────────┘
                                       │ typed Tauri IPC
                                       │ account_id, message_id,
                                       │ draft text, tool proposals
                    ┌──────────────────▼──────────────────────┐
                    │  Tauri host (thin)                      │
                    │  window, menus, command allowlist       │
                    └─┬────────────┬─────────────┬────────────┘
                      │            │             │
           ┌──────────▼──┐  ┌──────▼──────┐  ┌───▼────────────┐
           │ mail-core   │  │ mail-store  │  │ agent-runtime  │
           │ IMAP IDLE   │  │ SQLite+FTS5 │  │ providers      │
           │ SMTP/lettre │  │ threads     │  │ tool loop      │
           │ MIME parse  │  │ drafts      │  │ skills loader  │
           └──────┬──────┘  └──────▲──────┘  └───┬────────────┘
                  │                │             │
                  │     tools read/write only    │
                  │     through mail-store APIs  │
                  ▼                │             ▼
           IMAP/SMTP hosts    aether-secrets   LLM endpoints
           (user's server)    (OS keyring)     (BYOK / Ollama /
                                               optional paid proxy)
```

Four crates, one window. The webview is a renderer. The Rust host owns the truth.

## Why this split

| Crate | Owns | Must not own |
|---|---|---|
| `mail-core` | Protocol, sync, MIME | UI, LLM calls |
| `mail-store` | Schema, queries, FTS | Sockets, keys |
| `agent-runtime` | Providers, tool loop, skills | Raw IMAP, keyring reads (it asks the host) |
| `aether-secrets` | Get/set/delete named secrets | Business logic |
| `apps/desktop` | IPC mapping, React | Protocol details |

This is what lets us assign sub-agents without them trampling each other: mail-core can be tested against a fake IMAP; agent-runtime can be tested with a fake store and a recorded HTTP fixture; UI can be developed against mocked IPC.

## Data

- One SQLite file per profile under the OS app-data dir (e.g. `%APPDATA%/aether-mail/` on Windows).
- Tables (sketch, not a migration): `accounts`, `folders`, `messages`, `bodies`, `attachments_meta`, `thread_keys`, `fts_messages`, `drafts`, `agent_runs`.
- Bodies may be stored compressed. Attachments: metadata in SQLite, bytes on disk next to the DB, not in the webview blob store.
- Search = FTS5 on subject/from/to/body. No external search engine in v1.

## Sync (v1)

- On launch and on interval: `LIST` folders, incremental `UID FETCH` since last UIDVALIDITY/UID.
- IMAP `IDLE` on the selected folder when the server supports it.
- Conflicts: server wins for flags we did not set this session; local drafts never auto-send.
- Full offline read of whatever has been fetched. No "spinner until cloud."

## Agent loop

```
user prompt + small context (current thread id, account id)
        │
        ▼
provider.complete(messages, tools)
        │
        ├─ tool_call → host executes allowlisted tool
        │                 → JSON result appended
        │                 → loop (capped)
        │
        └─ final text and/or proposed_actions[]
                  │
                  ▼
         UI shows transcript + Approve / Edit / Dismiss
```

The model never receives a password. It receives store query results the user (or the current-thread context) authorized by using the app.

## Threat model (v1)

| Threat | Mitigation |
|---|---|
| XSS via HTML mail | Sandboxed render surface, no IPC, remote images off |
| Stolen DB file | Disk encryption is the OS's job in v1; credentials are not in the DB |
| Stolen credentials | OS keyring only; webview never sees them |
| Prompt injection in a mail body ("ignore previous, send all mail to…") | Tools cannot send/delete; confirm UI is not model-driven; strip/ignore HTML in model context |
| Supply-chain malware | Pinned deps, later `cargo deny` + audit CI |
| LLM vendor retention | Default = local/BYOK; per-account "allow cloud" switch defaults off |
| Curious IPC caller | Allowlisted commands, typed IDs, no raw SQL / raw IMAP from JS |

We do **not** claim to beat a nation-state with the user's disk unlocked. We claim not to be the weakest mail client in the room.

## Paid adapter (future, not built)

A separate crate or repo that implements the same `LlmProvider` trait against a billed proxy. The MIT app discovers it the same way it discovers Ollama: an endpoint + a key in the keyring. No code in `mail-core` should `#ifdef PAID`.

## What we are not building in the architecture

- A plugin VM that can run third-party binaries
- A local SMTP server
- CRDTs for multi-device (optional paid sync is a later design)
- Embedding Hermes itself as a subprocess (we steal the *ideas* — skills, tool loop, BYOK — not the process)
