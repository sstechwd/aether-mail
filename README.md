# Aether Mail

Local-first Thunderbird-shaped mail client with a Hermes-shaped agent.

**Overnight MVP (2026-08-13):** a 3-pane web UI + local API + Ollama `mistral`. Fixture inbox, not live IMAP yet. Long-term stack is still Tauri/Rust (`docs/CONVENTIONS.md`). We did **not** fork Thunderbird source.

## Run it

See [HOWTO-MORNING.md](HOWTO-MORNING.md). Short version:

```bash
cd C:\Users\Sumo\Documents\aether-mail
npm run start -w @aether/api
npm run dev -w @aether/web
```

Open http://127.0.0.1:5173/

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
