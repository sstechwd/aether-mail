# Security Policy

Aether Mail handles credentials and private correspondence. Reports are welcome and
taken seriously.

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

Use GitHub's [private vulnerability reporting](https://github.com/sstechwd/aether-mail/security/advisories/new)
(Security → Report a vulnerability). It is private until we publish an advisory.

Please include what you did, what happened, and what you expected. A proof of concept
helps enormously. This is a solo project — expect a first response within a week.

If you would rather not use GitHub, open a public issue titled "security contact
request" with **no details**, and a private channel will be arranged.

## Scope

In scope, and interesting:

- Anything that leaks a password out of the OS keyring, into a log, a config file,
  a command line, or over the network
- Escaping the sandboxed HTML mail iframe, or executing script from a message
- Getting the agent to send, delete, or exfiltrate mail without the two-click
  human confirmation — **prompt injection via message content is explicitly in scope**
- Path traversal via attachment filenames
- Anything that makes the local API reachable off `127.0.0.1`
- Certificate/TLS validation weaknesses in IMAP or SMTP

Out of scope:

- The unsigned installer / SmartScreen warning. Known, documented, and a funding
  problem rather than a code problem — see [`docs/SIGNING.md`](docs/SIGNING.md).
- Vulnerabilities in a user's own mail provider
- Attacks requiring an already-compromised machine (if malware is running as you,
  it can read your mailbox regardless of this app)
- Missing hardening on a build you compiled with modified source

## Design commitments

These are enforced in code and covered by tests. If you find a way around one, that
is a vulnerability:

1. **The agent cannot send.** Sending requires two human clicks and a short-lived
   token. No model output can trigger it.
2. **Secrets never touch disk in plaintext.** They go to the OS keyring via stdin —
   never argv, never a config file, never a log line.
3. **Mail HTML is hostile input.** Rendered in a sandboxed iframe under CSP, with
   remote images blocked until the user opts in per message.
4. **No telemetry.** The client does not report usage anywhere.
5. **Cloud models are opt-in per account.** Local by default.

## Supported versions

Pre-1.0: only the latest release is supported. Please reproduce on the newest build
before reporting.
