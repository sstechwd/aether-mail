# Security review — 2026-08-16

Scope: local Vite UI + Node API + Rust `aether-cli` (IMAP/SMTP/keyring).
We do not host mail. JS never speaks IMAP/SMTP.

## Must-do before a real mailbox password

1. `cargo build -p aether-cli` so Windows Credential Manager works.
2. Use a **provider app password**, not the account login (Gmail: Google Account → App passwords. Outlook: app password or it will fail on modern tenants).
3. Proton only via **Proton Bridge** (`127.0.0.1` STARTTLS).
4. Cloud LLM: check **Allow a non-localhost model** or the API refuses. Open message (≤2k) will leave the machine.

## What is in place

| Control | Status |
|---|---|
| Bind `127.0.0.1` only | yes |
| CORS allowlist, not `*` | yes |
| Password never in `accounts.json` / git | yes (`data/*.json` gitignored) |
| Password never in argv | yes — stdin to `aether-cli secret-put` |
| OS keyring (`aether-mail` service) | yes, via `aether-cli` |
| IMAP/SMTP TLS required | rust `require_transport`; port 25 forbidden |
| Cert checks | `native-tls` / SChannel; no invalid certs |
| `secret_ref` stripped from webview | yes |
| Agent cannot send | two-step human confirm; 5-minute token |
| Cloud model gated | `allowCloud` default false |
| Account remove deletes keyring | yes — `aether-cli secret-delete` |
| Audit log 30 days, no bodies | yes |
| HTML mail | still `<pre>`, not innerHTML |

## Still honest limits

- Node still holds a bounded RAM copy of the last 8 secrets as fallback if the CLI is not built.
- Gmail/Microsoft **OAuth is not implemented**. App password only.
- Prompt-injection defense is still regex + system prompt.
- Do not expose the API on the LAN.
