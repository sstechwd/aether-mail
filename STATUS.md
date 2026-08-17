# STATUS.md — morning briefing

**Updated:** 2026-08-16  
**HEAD:** about to push `main` to https://github.com/sstechwd/aether-mail  
**Live right now:** start `scripts\start-mvp.bat` after `cargo build -p aether-cli`

## What changed (this session)

- OS keyring via Rust `aether-cli` (Windows Credential Manager). Password never in git, never on argv.
- IMAP LOGIN+LIST + fetch, SMTP send — **Rust only**, TLS required.
- BYOK OpenAI-compatible models. Cloud requires **allowCloud** in Settings.
- Two-click Confirm send. Agent cannot confirm.

## How to connect a real account

1. `export PATH="$HOME/.cargo/bin:$PATH" && cargo build -p aether-cli`
2. Start Ollama if you want local chat; skip if you only test mail.
3. `scripts\start-mvp.bat` → http://127.0.0.1:5173/
4. Settings → pick Gmail/Outlook/custom → **app password** (not your main login).
5. Save. Probe should say IMAP LOGIN+LIST ok.
6. **Fetch INBOX**.
7. To send: compose/reply → Confirm send **twice**.

Gmail: Google Account → Security → App passwords.  
Outlook work tenants often block app passwords (OAuth later).  
Proton: Proton Bridge only.

## Do not

- Put your real password in if `aether-cli` is not built.
- Check allow-cloud unless you want the open message sent to that API.
- Expect OAuth. App password only.

## Tests last run

- `cargo test` including OS keyring + TLS policy
- `vitest` 26 passed
- web build clean
