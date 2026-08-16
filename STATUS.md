# STATUS.md — overnight log

**Updated:** 2026-08-15 02:40  
**Remote:** local only. Do not `git push`.

## Morning check

1. `scripts\start-mvp.bat` if http://127.0.0.1:5173/ is down  
2. **Settings** (toolbar) — add mail account + set LLM (Ollama `mistral` default)  
3. Open a message — pane 3 has **Aether chat** (Enter to send). Lean: 8 turns, 256-token cap. Not a Hermes process.

## MVP

Demoable local client + chat agent. **Not** a daily-driver for live Gmail yet.

## This burst

- Settings: mail + LLM (`data/llm.json` has no key)
- `POST /api/agent/chat` multi-turn
- Tests: vitest **17**, web build clean, commit `see git log`

## Next bursts (still tonight)

- Rust IMAP LOGIN probe (no real password)
- Wire keyring crate
- Keep refining chat
