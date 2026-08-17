# Aether Mail

Local-first Thunderbird-shaped mail client with a Hermes-shaped agent.

**Now:** 3-pane UI + local API + Rust `aether-cli` for IMAP/SMTP/keyring. Fixture inbox still works. Real accounts use an app password stored in Windows Credential Manager. Long-term stack is Tauri/Rust (`docs/CONVENTIONS.md`). We did **not** fork Thunderbird source.

## Run it

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build -p aether-cli
# then scripts\start-mvp.bat  or:
npm run start -w @aether/api
npm run dev -w @aether/web
```

Open http://127.0.0.1:5173/ — Settings to add a mail account (app password) or a BYOK model. Cloud models need the allow-cloud checkbox.

Ask **“status”** tomorrow — answer is [STATUS.md](STATUS.md).

## Docs

| Doc | What it is |
|---|---|
| [STATUS.md](STATUS.md) | Overnight log / morning briefing |
| [VISION.md](VISION.md) | Why this exists |
| [PRODUCT.md](PRODUCT.md) | What v1 is and is not |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Locked long-term stack |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Target crates / threat model |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 0–8 |

## License

MIT.
