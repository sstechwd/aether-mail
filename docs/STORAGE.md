# How mail is stored

Outlook keeps a proprietary **OST** (cached Exchange) or **PST** (archive/export). Thunderbird keeps **MBOX** files plus a profile. We do **not** read those, and we will not become a PST editor.

## Aether (now and the product)

| What | Where | Format |
|---|---|---|
| Fixture / overnight UI | `data/mail.json` | JSON, gitignored |
| Product engine | SQLite (`mail-store`) | envelopes + FTS5; body on open |
| Password | Windows Credential Manager | via `aether-cli`, never in SQLite |
| Settings / templates / audit | `data/*.json` + `data/audit.jsonl` | gitignored |
| Sibyl memory | `data/sibyl.db` | official SDK SQLite |

On disk later (Tauri): one app-data folder, one SQLite file per profile. Not OST. Not a second Outlook.

We copy **headers first**. Full bodies when you open or fetch. That is why RAM stays bounded.

## Real account test (what is left)

1. `cargo build -p aether-cli`  
2. Settings → Gmail/custom → **app password** → Save (LOGIN+LIST)  
3. **Fetch INBOX**  
4. Reply to junk → Confirm send twice  

OAuth is still Phase 3. Work/school Microsoft often blocks app passwords.

## Templates

**This week:** local snippets in `data/templates.json` (Templates button).  
**Not this week:** importing Outlook/Thunderbird stationery, a public marketplace, or payments. That is a store + ToS + money. After the client is a daily driver.
