# PRODUCT.md — Aether Mail

Working name: **Aether Mail**. Rename later if we find something better; do not bikeshed it in Phase 0.

## One sentence

A local-first desktop email client (Thunderbird-shaped) with an on-device agent (Hermes-shaped) that can search, triage, and draft — BYOK / local models first, paid hosted inference optional.

## Surfaces (v1)

```
+------------------+------------------------+------------------+
| Folder / account | Thread list            | Reading pane     |
|                  | (virtualized)          | + compose        |
+------------------+------------------------+------------------+
| Agent drawer (collapsed by default)                          |
| transcript, proposed actions, [Approve send] [Edit draft]    |
+--------------------------------------------------------------+
```

The agent is a **drawer**, not the home screen. A user who never opens it still has a complete mail client.

## User jobs

| Job | Must work without any LLM |
|---|---|
| Add an IMAP/SMTP account (app password or user/pass) | Yes |
| Fetch folders and mail, read HTML/plain, download attachments to disk | Yes |
| Search locally (from, to, subject, body) | Yes |
| Compose, reply, forward, send via SMTP | Yes |
| Offline read of cached mail + local drafts | Yes |
| Triage: archive, delete (confirm), star, move, mark read | Yes |
| Agent: summarize thread, draft reply, propose filing | No — needs a configured provider |
| Agent: send / delete | Never autonomous — UI confirm |

## Accounts (v1)

- Generic IMAP + SMTP with username/password or app password.
- Multiple accounts, one local SQLite store, per-account credentials in the OS keyring.
- **OAuth for Gmail / Microsoft is Phase 3**, not Phase 1. v1 is honest: "app password or real IMAP." Google's verification gauntlet is a product risk; we do not pretend otherwise.
- JMAP (Fastmail-native) is a later adapter, not the first protocol.

## Agent product rules

1. Default tools: `search_mail`, `read_thread`, `list_folders`, `draft_reply`, `propose_label`, `propose_move`, `summarize_thread`.
2. Dangerous tools (`send`, `delete`, `forward`, account mutation) exist only as **proposals**. The UI renders a confirm. The model cannot confirm.
3. Settings: provider = `{none, openai-compatible, anthropic, ollama, llama.cpp, paid-proxy}`. `none` is a valid, first-run default.
4. Per-account switch: "allow cloud models to see this account" — default **off** for any account that is not using a local model.
5. Show the tool transcript. Power users will not trust a black box that touched their mail.

## Non-goals for v1

- Mobile apps
- Being an email *host* (we are a client)
- Calendar, contacts as a platform (read address-book later; do not build a PIM)
- Built-in model weights in the installer
- Required signup
- Pixel-perfect clone of Gmail or Superhuman

## Monetization (not in v1 binary)

Documented now so we do not paint ourselves into a corner:

- OSS client is complete.
- Later optional account for: hosted inference, premium skills, priority support, optional e2e sync.
- Implementation pattern when we get there: a thin paid adapter crate that the MIT build does not need to compile.

## Naming, license, distribution

- Repo: `aether-mail`
- License: MIT (core)
- Distribution: GitHub Releases via Tauri bundler (Phase 7)
- First audience: people who will build from source and file issues. Store listings are not a v1 problem.

## Acceptance for "this is a real product"

A daily-driver loop on one IMAP account:

1. Launch, unlock OS keyring, see unread.
2. Read a thread, reply, send.
3. Search last month and find it offline.
4. Open the agent drawer, draft a reply with a local or BYOK model, edit, send yourself.
