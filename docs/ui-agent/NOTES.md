# UI notes — Aether Mail theme

CSS-only pass. Existing class names kept (`shell`, `folders`, `list`, `read`, `agent-chat`, `settings`, `toolbar`, `compose`). No API / Rust / secrets / TSX changes.

## Surface

This is an **Operate** surface (Thunderbird 3-pane inbox), with a secondary **Inspect** strip in the read pane for the agent. Density and selection state win. It is not a chatbot that ate the mail client, and not a Decide/Learn landing page.

## Palette

Night-olive desk, copper filament. Warm, analog, slightly botanical. Deliberately not Linear/Superhuman purple and not Vercel black-and-white.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#10140f` | App ground — almost-black with olive, not `#000` |
| `--bg-raised` | `#161b14` | Folder column, agent chrome |
| `--panel` | `#1b2118` | Message body, fields |
| `--chrome` | `#0c0f0b` | Top bar + status bar |
| `--ink` | `#e8e2d2` | Primary text (warm paper) |
| `--ink-soft` | `#c9c2b0` | Secondary text |
| `--muted` | `#8b8676` | Meta, hints |
| `--faint` | `#5c5a4e` | Labels, totals |
| `--line` | `#2a3126` | Hairline dividers |
| `--accent` | `#c4784a` | Copper — brand mark, unread pip, danger-adjacent warmth |
| `--accent-soft` | `#d4a574` | Unread-adjacent, user-turn label, notes |
| `--unread` | `#e0b47a` | Unread subject |
| `--select` | `#24301c` | Selected folder / row (moss, not a tinted accent wash) |
| `--danger` | `#c45a3a` | Confirm-send |
| `--ok` | `#7a9a64` | Agent-turn label (lichen) |
| `--focus` | `#d4a574` | `:focus-visible` ring |

Contrast: ink on `--bg` / `--panel` is well above 7:1. Muted on `--bg` is ~4.6:1 — used only for meta, not body copy.

## Type

No webfonts (local-first; no extra network). Stacks pick what Windows already has.

- **UI:** Segoe UI Variable / Segoe UI / IBM Plex Sans
- **Reading body:** Iowan / Palatino / Cambria — a real letter, not a card
- **Log + status + timestamps:** Cascadia Mono / Consolas

13px UI, 15.5px serif body, 11–12.5px mono log. Tight, not marketing-scale.

## Layout

Grid is still folders | list | read, plus a 22px status row:

```
top    top    top
folders list  read
status status status
```

List is denser (6px vertical padding, 44px min row for hit target, single-line ellipsis subject). Unread is weight + copper pip on the from-line, not a left accent rail.

## Status bar

Class: **`statusbar`** (not `status`). App can mount:

```html
<footer class="statusbar">
  <span class="sb-sync">Last sync 2m ago</span>
  <span class="sb-unread">3 unread</span>
  <span class="sb-agent">agent idle</span>
</footer>
```

Until that exists, `.shell::after` paints the same chrome with placeholder copy so the 3-pane already sits on a bar. `:has(.statusbar)` hides the fallback. Optional `data-state="thinking"` on `.sb-agent` warms the copper.

## Agent as a log

`.agent-chat` is a three-row instrument: header / turns / input. Turns are two-column mono lines (`You` / `Aether`), not bubbles. Skill buttons in `.agent .actions` are quiet text chips, not a button blob. While the chat textarea is disabled, `.turns::after` draws a `thinking…` line — no extra DOM.

## Settings

Fixed overlay, 2px radius, full-viewport dimmer via `box-shadow: 0 0 0 100vmax …` so we do not need a backdrop node. Sections are hairline-separated; headings are small-caps labels, not hero titles.

## Focus + motion

`:focus-visible` copper ring on buttons, fields, rows. Hover on folders/rows is a moss wash. `prefers-reduced-motion` kills animation/transition. Compose sits above the status bar.

## Slop audit

Score **1 / 10** after the pass.

- Not fired: tech gradient, generic purple hue, feature-tile grid, accent-rail cards, glass, monument stats, icon toppers, center stack, Inter, wrong surface.
- Residual: unread pip is a functional scan mark, not a card rail.

## Out of scope

Did not touch `App.tsx` / `AgentChat.tsx` / Settings logic. The bar is styled and reserved; live last-sync / unread / agent-state still need a later App fill. No Electron, no CSS framework, mail body stays in `<pre>` (no `innerHTML`).
