# Aether Mail

A local-first desktop email client with an optional on-device agent.
Thunderbird-shaped mail, and an assistant that can read and draft but **cannot send**.

Your mailbox stays on your machine. Passwords live in the OS keyring. The agent runs
against a local model by default, so nothing has to leave the building.

> **Status: early.** Reading real mail works well. It is not yet a daily driver for
> everyone — no OAuth yet, so work/school accounts that block app passwords will not
> connect. See [Limitations](#limitations) before you download.

---

## Install (Windows)

Grab the latest [Release](https://github.com/sstechwd/aether-mail/releases):

- `Aether Mail_x.y.z_x64-setup.exe` — normal installer
- `aether-mail-portable-x64.zip` — unzip and run, installs nothing

### Windows will warn you, and here is why

This build is **not code-signed**. A certificate is a recurring cost this project
cannot cover yet, so SmartScreen shows "Windows protected your PC — unknown publisher."

That warning means **unsigned**, not **unsafe**. Click **More info → Run anyway**.

You should be skeptical of a stranger's email client, so don't trust that paragraph —
verify it instead:

```powershell
# Does the file match what was published?
Get-FileHash .\aether-mail-setup.exe -Algorithm SHA256
# compare against SHA256SUMS.txt on the release

# Did GitHub build it from this source, on their servers, from a known commit?
gh attestation verify .\aether-mail-setup.exe --repo sstechwd/aether-mail
```

Every release is built by GitHub Actions from a tagged commit and carries a
cryptographic [build provenance attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations).
Nobody uploads a binary from a laptop. If you would still rather compile it yourself,
that is four commands — see [Build from source](#build-from-source).

---

## What it does today

- **3-pane mail** — folders, message list, reading pane
- **Real IMAP/SMTP** via a Rust CLI (`async-imap`, `lettre`, `mail-parser`).
  JavaScript never speaks a mail protocol.
- **Proper MIME** — multipart, quoted-printable, base64, RFC 2047 subjects,
  attachments, inline `cid:` images resolved from the message itself (no network)
- **HTML mail rendered in a sandboxed iframe**, remote images blocked until you
  click Load, so tracking pixels stay dark
- **Header inspection** — SPF/DKIM/DMARC, From vs Return-Path, opens automatically
  on suspicious mail
- **Spoken workflows** — "star anything from my landlord" compiles locally, no LLM
- **Agent (BYOK or local Ollama)** — summarize, draft a reply, triage.
  It proposes; **sending always takes two human clicks.**
- **Local memory + 30-day audit log**, no message bodies stored in either

## What it deliberately does not do

- **Host your mail.** There is no Aether inbox. It is a client for accounts you
  already have.
- **Send on its own.** No auto-reply, no scheduled sends. The model cannot click
  Confirm — that is enforced in code, not in a prompt.
- **Phone home.** No telemetry. Cloud models require an explicit per-account opt-in.

---

## Limitations

| | |
|---|---|
| **No OAuth yet** | Gmail/Outlook need an [app password](https://support.google.com/accounts/answer/185833). Many work/school tenants block those — you will not be able to connect. OAuth is the next major feature. |
| **Unsigned installer** | SmartScreen warning, see above. |
| **Windows only for now** | The stack is cross-platform; nobody has built and tested the macOS/Linux bundles yet. |
| **Large download** | ~25MB, most of which is a bundled Node runtime for the temporary API layer. Porting it to Rust will cut this to ~8MB. |
| **Proton** | Works only through [Proton Bridge](https://proton.me/mail/bridge). Tutanota is not supported — it has no IMAP. |

---

## Build from source

Needs [Rust](https://rustup.rs) and [Node 22+](https://nodejs.org).

```bash
git clone https://github.com/sstechwd/aether-mail
cd aether-mail
npm ci
cargo build --release -p aether-cli     # mail I/O
npm run sidecar:build                   # API -> self-contained binary
cargo tauri build --config apps/desktop/tauri.conf.json
```

The installer lands in `target/release/bundle/`.

For the dev loop instead: `scripts\start-mvp.bat`, then http://127.0.0.1:5173/

---

## Architecture, briefly

```
Tauri 2 window (Rust)
  └─ React 19 UI
       └─ localhost API  ← temporary; being ported into Rust
            └─ aether-cli (Rust): IMAP, SMTP, OS keyring
```

Passwords cross localhost once, then live in Windows Credential Manager — never in
a config file, never on a command line, never in a log. Details in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/SECURITY.md`](docs/SECURITY.md),
and the binding conventions in [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## Money

The client is MIT and stays free. There is no paid tier of your own mailbox, no ads,
no pay-to-send. If hosted models ever ship, they will be an optional add-on for people
who do not want to run one locally — see [`docs/INCOME.md`](docs/INCOME.md).

## Security

It is an email client, so please report anything you find:
[`SECURITY.md`](SECURITY.md).

## License

MIT — see [`LICENSE`](LICENSE).
