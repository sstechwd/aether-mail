# UI agent handoff — Aether Mail

**Read `docs/TECHNICAL.md` first.** This file is only the visual brief.

Work in the **UI clone**: `C:\Users\Sumo\Documents\aether-mail-ui` on branch
`ui-design`. Do not commit to `dev` unless the human asks. Do not push.

---

## Job

Modernize chrome. Thunderbird 3-pane stays. CSS tokens, not a rewrite of mail.

Keep classes: `shell`, `folders`, `list`, `read`, `agent-chat`, `compose`,
`compose-veil`, `settings`, `toolbar`, `statusbar`, `threat`, `mail-frame`.

Themes live as `:root[data-theme="retro" | "modern" | "filament"]`. User wants
**modern** to become the one they live in. Retro can stay as an option.

Persona: calm operate surface. Not purple SaaS. No webfonts.

## Do

1. Read `apps/web/src/styles.css` tokens and `docs/ui-agent/PERSONA.md`.
2. Change CSS + small picker markup. Do not touch `apps/api` or Rust.
3. Prove it on Vite `http://127.0.0.1:5173/` (API `:8787`). Packaged exe will lie.
4. Note the palette in `docs/ui-agent/THEMES.md`.

## Don’t

- Electron, new CSS framework, `innerHTML` for mail
- IMAP / OAuth / keyring / sidecar
- HTML5 drag-and-drop (broken in this webview — pointer drag already works)
- Inline social browser
- Monetization copy, pricing, “Aether+”, donation widgets

## Already fixed in product (do not “fix” again)

Links and linked images open in Firefox. Compose is a centered overlay.
List cursor is a pointer until you drag. Headers are off by default.

## Prove a visual change

Change a visible string, then CSS. Resize ~1100 / 640 / 480. Retro still selectable.
