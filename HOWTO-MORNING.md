# Morning runbook

Ollama should already be running (`ollama serve`). Model: `mistral`.

From `C:\Users\Sumo\Documents\aether-mail`:

```bash
npm run test -w @aether/api
npm run start -w @aether/api     # http://127.0.0.1:8787
npm run dev -w @aether/web       # http://127.0.0.1:5173
```

Or double-click `scripts/start-mvp.bat`.

Open http://127.0.0.1:5173/

What you should see:
- INBOX with 4 fixture messages (one is a prompt-injection phish)
- Summarize / Draft reply via local Mistral
- Confirm send… tells you SMTP is not wired (honest)

Not in this build: real IMAP login, Thunderbird source fork, GitHub push.
