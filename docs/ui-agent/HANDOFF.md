# UI agent handoff — Aether Mail

**Read this before restyling.** Functional work is on `dev`. Do not relitigate the stack. CSS tokens and class names stay (`shell`, `folders`, `list`, `read`, `agent-chat`, `compose`, `settings`, `statusbar`). Theme in CSS variables, not a rewrite of mail.

Repo: `C:\\Users\\Sumo\\Documents\\aether-mail` · public MIT · `sstechwd/aether-mail`.

**Last code:** 2026-08-25 evening. Branch `dev`. User will daily-drive and note quirks.

---

## What the product is

Thunderbird-shaped **desktop mail client** + Hermes-shaped **agent**. Not a host. Not Electron. Agent cannot send. Confirm-to-send is two human clicks.

Money later: free MIT client, optional **Aether+** hosted models (Hermes/Nous shape). Not a $29 exe. Not ads. Not hosting mail.

## Done (do not redo)

- 3-pane mail, IMAP/SMTP via `aether-cli`, sandboxed HTML, remote images off until Load
- SuperGrok OAuth for the **model**; Claude/ChatGPT stay API-key (vendor policy)
- Drag mail onto folders (**pointer** drag, not HTML5 — Tauri/WebView2 eats HTML5)
- Chat: make a folder, make a rule, move this to X, always file this sender
- Inbox **watch**: IDLE + 2 min poll; list refreshes without Fetch. Button is “Sync now”
- Rules page, File this sender, undo toast
- Themes: retro / modern / filament — user wants a **modern overhaul later**, features first

## User-reported (this session) — fix in code, then restyle

| Quirk | Intent |
|---|---|
| Links in mail do not click | Open https/mailto in **system browser** (Firefox). Sandbox currently blocks all navigation. |
| Images that are links ditto | Same. Click `<a><img>` should open the href, not load a tracker blindly. |
| List always shows grab hand | Default cursor is pointer. Grabbing **only while holding** a drag. |
| Headers auto-open | Off by default. Setting already exists: Settings → Header inspect. |
| Reply box clipped / static | Compose is a 380px corner sheet; overflows the window. Needs a real pop-out/overlay. |
| App passwords | Barrier. Want **Sign in with Google / Microsoft** walkthrough. Backend PKCE exists; needs client id + UI that opens the **system** browser (not `window.open`). |
| First run | Weak overlay. Want mailbox + model (or local Ollama) walkthrough. |
| Rules too few fields | from / to / subject only. Add body, maybe domain. Never add send/reply as a rule action. |

## Do not

- Fork Thunderbird
- `innerHTML` for mail
- Auto-send, auto-reply
- Inline social-media browser (phishing + cookie jar in a mail client)
- Pack a 1GB GGUF into the NSIS until the daily driver is boring
- Restyle IMAP/OAuth

## Ideas parking lot (not this sprint)

See `docs/IDEAS.md`. Inline browser, social, packaged tiny model, Aether+ Stripe — review later.

## How to prove a visual change

Vite `http://127.0.0.1:5173/` plus API `:8787`. If Vite is down they see an old build. Change a visible string, then CSS.
