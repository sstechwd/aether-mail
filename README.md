# Aether Mail

A local-first desktop email client with an optional on-device agent.
Thunderbird-shaped mail, and an assistant that can read and draft but **cannot send**.

Your mailbox stays on your machine. Passwords live in the OS keyring. The agent
can run on a local model, or you can sign in with SuperGrok / paste a BYOK key.
Cloud models stay off until you opt in.

> **Status: early.** Reading real mail works well. It is not yet a daily driver for
> everyone — Gmail/Outlook **mail** login is still app-password, not OAuth, so some
> work/school accounts will not connect. See [Limitations](#limitations).

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
- **Spoken workflows and rules** — “star invoices”, “make a folder called Receipts”,
  “always file this sender to Receipts”. Compiles locally. Rules never send.
- **Drag a message onto a folder** — pointer drag (HTML5 DnD does not work in the
  Windows webview). Toolbar **Move to…** and **File this sender…** if you prefer clicks.
- **Agent (local Ollama, SuperGrok sign-in, or BYOK Claude/OpenAI)** — summarize,
  draft, triage. It can file mail you asked it to. **Sending always takes two human clicks.**
- **Local memory + 30-day audit log**, no message bodies stored in either

## What it deliberately does not do

- **Host your mail.** There is no Aether inbox. It is a client for accounts you
  already have.
- **Send on its own.** No auto-reply. You can queue “send later”; the model still
  cannot click Confirm — that is enforced in code, not in a prompt.
- **Phone home.** No telemetry. Cloud models require an explicit per-account opt-in.

---

## Limitations

| | |
|---|---|
| **No mail OAuth yet** | Gmail/Outlook **accounts** still need an [app password](https://support.google.com/accounts/answer/185833). SuperGrok (the **model**, not the mailbox) can sign in with X Premium+. |
| **Unsigned installer** | SmartScreen warning, see above. |
| **Windows installer today** | macOS and Linux build from source **on that OS** — see [`docs/PACKAGING.md`](docs/PACKAGING.md). |
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

## Security

It is an email client, so please report anything you find:
[`SECURITY.md`](SECURITY.md).

## License

MIT — see [`LICENSE`](LICENSE).
