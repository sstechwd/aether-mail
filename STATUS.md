# STATUS.md — unattended stretch (still running until 21:00)

**Updated:** 2026-08-17 ~18:41  
**Do not push.** Private repo.

## Works now (restart MVP + hard refresh)

- Reply send uses **sender** as To
- Chat teaches folder/file/spam rules (no LLM)
- Persona samples, threat score, Spam, Move to…, `!` = Spam
- Audit 30 days in Settings
- Phone: list ↔ read, ← Inbox
- Unread only, Mark folder read, `n` next unread
- Status bar: unread / last fetch / agent idle
- Income: `docs/INCOME.md`

## Launch

`scripts\start-mvp.bat` → http://127.0.0.1:5173/

## Still not daily-driver Gmail

Need app password + Fetch. No OAuth. No store app. No auto-reply.

Tests: cargo green, vitest 41, web build clean.
