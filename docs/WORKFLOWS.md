# Mail automations vs Aether workflows

What 2026 clients actually ship, and what we will **not** copy blindly.

| App | Automation | Our take |
|---|---|---|
| Thunderbird / Outlook / Gmail | Manual **filters/rules**: if from/subject/contains → move/star/forward/delete | Deterministic core stays. UI for "if field X then Y" can wait. |
| Spark | Smart Inbox (People / Notifications / Newsletters), Gatekeeper for new senders | Useful *shape*. We will not upload the mailbox to classify. |
| Gmail | Categories + server filters | Server-side is their host. We are a client. |
| Superhuman / Copilot / Gemini | Draft and summarize in the thread | We already do this locally / BYOK. |

## Agentic workflow (what you asked for)

You say: **"star invoices and archive newsletters."**  
We compile that to local rules. On fetch/ingest we apply **safe** actions.

**Auto-allowed:** star, archive (local folder), keep, propose a draft.  
**Never auto:** send, delete, forward, change accounts.

No LLM required to compile or apply v1 rules (cheap, offline, testable). The chat pane can later add a rule from a sentence.

## Out of this slice

Calendar, server-side Gmail filters, Gatekeeper UI, Exchange rules.
