# ADR 0001 — Do not fork Thunderbird

**Status:** accepted  
**Date:** 2026-08-14  
**Deciders:** product owner (accepted “make the backend solid”)

## Context

The original idea was “Hermes mixed with Thunderbird.” A reasonable reading is: fork `comm-central` so we do not reinvent IMAP, MIME, HTML mail, or a 3-pane UI.

## Decision

**We will not fork Thunderbird.**

We clone Thunderbird’s *product shape* (3-pane client, human sends, folders, search) and Hermes’s *agent shape* (skills, tool loop, confirm-before-send). The mail engine is our Rust crates using existing protocol libraries.

## Why a fork is the wrong wheel

- Thunderbird is a Mozilla product: Gecko, build system, release cadence, add-on model. A fork means we maintain a browser-mail suite, not an agentic client.
- Overnight we already confirmed `rustc` was missing and `comm-central` would burn a night for zero UI.
- An agent that can only live as a MailExtension is stuck behind WebExtension APIs. Dangerous tools and a local store we own need a host we control.
- “Don’t reinvent IMAP/MIME” is solved by **libraries**, not by inheriting 20 years of XUL.

## What we reuse instead (the actual wheels)

| Problem | Wheel |
|---|---|
| IMAP | `async-imap` / `imap-proto` |
| SMTP | `lettre` |
| MIME parse/build | Stalwart `mail-parser` / `mail-builder` |
| Local index | SQLite + FTS5 |
| Secrets | OS keyring (`keyring`) |
| HTML hostility | sandboxed render surface (later, in the Tauri host) |
| Local models | Ollama / llama.cpp via a provider trait |

The overnight Node API + JSON fixture is a **temporary host** so the React UI can run. It is not the mail core. Node `imapflow` / `nodemailer` stay rejected as the long-term engine (`docs/CONVENTIONS.md`).

## Consequences

- Backend work goes in `crates/mail-store`, `crates/mail-core`, `crates/agent-runtime`, `crates/aether-secrets`.
- The Vite UI may keep talking to `apps/api` until Tauri exists. That API must shrink toward calling the crates (FFI/CLI) or go away.
- A Thunderbird *extension* that drives our agent remains allowed later as an optional companion — that is reuse, not a fork.
