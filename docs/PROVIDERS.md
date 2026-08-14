# Account providers — we are a client, not a host

Aether Mail never stores other people’s mail on our servers. There is no Aether inbox address. The user brings an account they already have. We speak **IMAP + SMTP** (and later Graph/JMAP as adapters).

## What works how

| Provider | How the user connects | Auth | Notes |
|---|---|---|---|
| **Custom domain** (cPanel, Fastmail-generic, university, self-host) | IMAP + SMTP hosts the user already knows | Password or app password | **v1 path.** This is the honest default. |
| **Gmail / Google Workspace** | `imap.gmail.com:993` / `smtp.gmail.com:587` | **App password** now. **OAuth2 (XOAUTH2)** required for a polished product — Google is killing password logins. | We do not become a Gmail host. Google app verification is a later product risk, not a protocol problem. |
| **Outlook / Microsoft 365** | `outlook.office365.com:993` / `smtp.office365.com:587` | App password on some consumer accounts. **OAuth2** for most work tenants (basic IMAP auth is often off). | Graph API is a later adapter, not v1. |
| **iCloud** | `imap.mail.me.com:993` / `smtp.mail.me.com:587` | Apple **app-specific password** | Same IMAP client. |
| **Fastmail** | `imap.fastmail.com:993` / `smtp.fastmail.com:587` | Password or app password | JMAP later if we care. |
| **Yahoo** | `imap.mail.yahoo.com:993` | App password | Same IMAP client. |
| **Proton Mail** | **Proton Bridge** on localhost, then IMAP `127.0.0.1:1143` (typical) | Bridge password | We will **not** speak Proton’s native encrypted API. Without Bridge, Proton is not IMAP. That is Proton’s design, not a missing feature we should fake. |
| **Tutanota / similar** | — | — | No standard IMAP. We do not pretend. Show “not supported” instead of a dead form. |

## Auth rules

1. The webview never receives a password, app password, refresh token, or OAuth secret. It sends them **once** over localhost IPC/HTTP to the host, which puts them in the OS keyring and returns an `account_id`.
2. SQLite stores hostnames, ports, username, `secret_ref`. Never the secret.
3. OAuth for Google/Microsoft is a dedicated slice (browser redirect, PKCE, store refresh token in keyring). Do not half-implement it inside the password form.
4. “Test connection” = IMAP `LOGIN`/`AUTHENTICATE` + `LIST`. If that fails, we do not save the account as working.

## Out of scope

- Hosting mailboxes
- Catch-all / disposable Aether addresses
- Being a Proton or Tutanota replacement
- Reading Thunderbird’s saved passwords off disk
