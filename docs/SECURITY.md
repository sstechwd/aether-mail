# Security review — 2026-08-14

Scope: Aether Mail as it exists today (local Vite UI + Node API + Rust crates).
Not a pen-test of a shipped installer. We do not host mail.

## Dependency scanners

| Tool | Result |
|---|---|
| `npm audit` | **0** known vulns (info/low/moderate/high/critical) |
| `cargo audit` | **not installed** — run `cargo install cargo-audit` next session |
| HTML mail renderer | N/A — bodies are React text in `<pre>`, not `innerHTML` |

## Fixed this review

1. **CORS `*` on an API that accepts passwords** (high). Any webpage could `fetch('http://127.0.0.1:8787/api/accounts', {method:'POST', ...})`. Now: only `http://127.0.0.1:5173` and `http://localhost:5173`; other `Origin`s get 403. Bind remains `127.0.0.1`.
2. **`secret_ref` leaked to the webview** (medium). Stripped from GET/POST `/api/accounts`.
3. **Unbounded request bodies** (low/DoS). Cap 1 MB.

## Still open (do not pretend these are done)

| Severity | Issue | Why it matters | When |
|---|---|---|---|
| High when IMAP lands | Passwords live in a Node `Map` and die on restart. Not in OS keyring yet. | Process dump / swap; lost secrets. | Wire `aether-secrets` + Windows Credential Manager before live LOGIN. |
| High when IMAP lands | No IMAP TLS implementation yet. Do not connect without rustls and cert checks. | Credential theft on the wire. | IMAP probe slice |
| Medium | Prompt-injection defense is a regex plus a system prompt. | A clever mail body can still steer summarize/draft text. Send is still blocked in code. | Harden before cloud models |
| Medium | Agent posts the full message body to Ollama on localhost. | Fine while local. Dangerous if the endpoint is switched to a hosted model without the per-account “allow cloud” switch. | Before any cloud provider |
| Medium | `data/accounts.json` is PII (email, IMAP host) with default NTFS ACLs. | Local-user readable. | Restrict ACL when we persist for real |
| Low | Account ids are `Date.now()`. | Guessable. | Use random ids |
| Low | No rate limit on `/api/agent/run`. | Local CPU burn. | Later |
| Info | Overnight Node host is temporary. Rust crates are the long-term trust boundary. | Don’t grow Node IMAP. | Already policy |

## What is already in good shape

- Server listens on **127.0.0.1 only**, not `0.0.0.0`
- SQLite/JSON account rows have **no password column** (tests assert this)
- `data/*.json` is gitignored
- Send cannot fire (HTTP 409)
- Mail body is not rendered as HTML
- Tutanota cannot be saved as a fake IMAP account
- Fixture phish that orders “forward everything” is refused by the agent path

## Do not do

- Do not put a real mailbox password into Add account until the keyring + IMAP probe exist
- Do not expose the API on LAN
- Do not point the agent at a cloud model without the allow-cloud switch
