# Popular clients vs Aether — overnight cut

Sources: 2026 client roundups (Thunderbird, Outlook, Gmail web, Spark, Mailbird). We are a **client**, not a host.

| Feature | Thunderbird / Gmail / Outlook | Aether now | Tonight |
|---|---|---|---|
| 3-pane folders / list / read | Yes | Yes | keep |
| Multi-account | Yes | Form only, no fetch | later (IMAP) |
| Search | Yes | Local FTS / API | keep |
| Compose / reply | Yes | Draft box, no New | **New + persist draft** |
| Star / flag | Yes | No | **Yes** |
| Archive | Yes | No | **Yes (local folder)** |
| Trash / delete | Yes | No | **Yes (local folder)** |
| Mark unread | Yes | Read-only mark | **Toggle** |
| Keyboard shortcuts | Gmail/TB | No | **j k e # s r c** |
| HTML mail sandbox | Yes | Plain `<pre>` (safer) | keep |
| Calendar / contacts | Yes | No | **out of scope** |
| Exchange / EWS | TB 145+, Outlook | No | later |
| Agentic summarize / draft | Superhuman-ish / add-ons | Yes (local model) | keep |
| Inbox triage / action items | Mostly human or SaaS AI | No | **Yes** |
| Live IMAP send | Yes | Honest 409 | after keyring |

**MVP verdict:** close for a **demoable local client + agent**. Not close for daily-driving a real Gmail/Outlook inbox. Do not pretend otherwise.
