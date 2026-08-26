# Ideas parking lot

Not a roadmap. Things said in passing. Review before building. None of these
are promised.

## Money / distribution

- **Aether+** — optional hosted models, ~$12/mo, resell OpenRouter. Mail stays
  free. Same shape as Hermes. Do not bill until IMAP is a daily driver.
- GitHub Sponsors after ~10 people besides Sumo live in the app.
- Packaged tiny local GGUF (Phi / Qwen 0.5B): differentiates “works on a plane
  with no key”. Cost: installer jumps from ~25MB to 1GB+, RAM, weak drafts.
  Better: optional download + llama.cpp, or “install Ollama” in first-run.
  Do **not** ship a model in v1 NSIS.
- OS-agnostic installers: code is cross-platform; produce `.dmg` / `.deb` **on
  those machines**. See `docs/PACKAGING.md`.

## Product maybe

- Inline browser / social inside the mail app — **lean no**. A mail client that
  also holds Facebook cookies is a phishing magnet. Links already should open
  in the user’s Firefox.
- Command chains: “file this and always do that for this sender”
- Gmail/Outlook **mail** OAuth (in progress) — this is the real adoption unlock
- IMAP IDLE is on; keep poll as fallback
- Calendar as a first-class Outlook-like surface (month/week/day) — later
- Search that feels like Outlook (`from: priya invoice march`)

## Explicitly out

- Hosted mailbox / `@aether` address
- Ads, pay-to-send, Electron
- Auto-send
- Native App Store / Play in v1
