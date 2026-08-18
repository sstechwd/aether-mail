# How mail is stored

Outlook **OST/PST** and Thunderbird **MBOX** are not our format. We do not import them.

## Now (overnight UI)

| What | Where |
|---|---|
| Messages | `data/mail.json` — **per `accountId`**. Fixture and Gmail are separate rows. |
| Account last used | `data/meta.json` (`activeAccountId`) |
| Passwords | Windows Credential Manager only |
| Templates / audit / Sibyl | `data/` gitignored |

List payloads have **empty bodies**. Open-by-id loads the body. That is the RAM cap.

## Product (Tauri)

One app-data folder, one **SQLite + FTS5** file per profile (`crates/mail-store`). Backup = copy that folder. Optional later: encrypted zip export the user keeps. **No cloud mailbox. No Aether-hosted inbox.**

## Pictures

HTML mail is hostile. We strip tags and **do not show remote images**. A count of hidden `<img>` is shown. Inline `cid:` attachments are a later slice (save to disk, not `innerHTML`).

## What is not this week

Obsidian plugin, terminal nano-client, marketplace, investor CRM. OSS MIT client first. Money path is still `docs/INCOME.md` (optional Aether+), not a seed deck.
