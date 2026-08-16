# Efficiency notes

Goal: stay a thin client. Do not keep a mailbox-sized working set in the UI or in the agent prompt.

## Done this pass

| Issue | Fix |
|---|---|
| Folder/search APIs returned full bodies | List/search return empty `body`; open-by-id still loads the body |
| Keyboard listener re-bound every React render | One listener, refs for current selection |
| Unbounded in-process password Map | `SecretVault` LRU, max 8 |
| Chat turns up to 4k chars × ∞ | Already 8 turns; now 1500 chars each |
| LLM generate unbounded | `num_predict: 256` |

## Still true

- Node fixture store still holds full bodies **on disk/in the Map** (needed for open/search). Fine for fixtures; when IMAP lands, persist SQLite and page the list.
- Ollama is the heavy process, not this UI. We do not spawn Hermes.
- OS keyring (Rust `keyring`) is the next secret home. Vault is a bounded stopgap.

## Rules

- Never send the mailbox to the model. Open message ≤ 2000 chars + 8 turns.
- Never put HTML mail into the React tree as HTML.
- Do not add Electron.
