# VISION.md — Aether Mail

Aether Mail is a **local-first, privacy-first desktop email client** with an **optional agent** that can read, search, triage, and draft against *your* mail store — not a copy of it in someone else's cloud.

The first idea was blunt and correct: **Thunderbird mixed with Hermes**. A real mail client you can live in, plus an autonomous agent that is allowed to use tools against that mail — with the human still holding the send key.

## The bet

Inbox apps got worse by becoming SaaS. Agents got worse by requiring you to upload the corpus they need. The opening is a client that:

1. Speaks ordinary IMAP/SMTP so it works with the account you already have.
2. Keeps the corpus, credentials, and index on the machine.
3. Lets an agent work *on that local store* with an allowlisted tool set.
4. Treats hosted models and cloud sync as optional paid conveniences, never as the product.

If the company disappeared tomorrow, the open-source client would still fetch, send, search, and draft with the user's own keys or a local model.

## Who it is for

- People who want agentic help **without** giving a startup their mailbox.
- People who already run Ollama / llama.cpp, or who will paste their own API key.
- People who still need Gmail, Fastmail, a university IMAP box, or a cheap VPS — not a new email address.
- Contributors who will only trust a mail client they can read.

It is **not** for: replacing Gmail on the web, being a mobile-first client in v1, or being "ChatGPT but it has your email."

## Product principles

1. **The open-source core is the product.** Paid features are value-add, not a hostage situation.
2. **Local-first, offline-capable.** Reading cached mail and drafting works in airplane mode. Sync catches up later.
3. **The human sends.** The agent drafts, labels, files, and explains. Sending, deleting, and forwarding require an explicit click.
4. **Least data leaves the machine.** BYOK and local models are the default story. When a cloud model is used, we send retrieved snippets, not the mailbox.
5. **Progressive disclosure.** A competent Thunderbird-class client on day one. Agent features appear as a side panel and confirmable actions, not a chatbot that ate the inbox.
6. **Boring reliability over fashion.** Correct MIME, correct sync, correct search. No crypto-wallet, no "AI-native rewrite of email."

## What "agentic" means here

The agent is a **tool loop against the mail store**, not a personality that lives in the cloud.

It can: search, read a thread, summarize, draft a reply in your voice, propose labels and filing, and (later) run scheduled skills ("every morning, surface unread that look like invoices").

It cannot: send, delete, or change account settings without a UI confirm the model cannot press.

## Paid tier (optional, later)

Honest and separate:

| OSS (always) | Paid (optional) |
|---|---|
| IMAP/SMTP client, local store, search | Hosted model access with metering |
| BYOK + Ollama + llama.cpp | Curated stronger models |
| Built-in skills | Premium skill/template packs |
| Community support | Priority support |
| | Optional end-to-end encrypted cloud sync / multi-device |

On model reselling: either (a) proxy through OpenRouter (or similar) with a disclosed markup/subscription, or (b) our own billed endpoint. Transparent ToS. The paid path is never required to read or send mail.

## Success

A stranger can clone this repo, build it, connect IMAP, and use it as their daily client *without creating an account with us*. A second stranger can plug in Ollama and get useful drafts. That is the bar. Everything else is additive.
