# Mobile web — Aether Mail 3-pane on a phone browser

CSS + the existing `.has-mail` / `.back-phone` switch. Same React app. **Not** a React Native / Capacitor / Flutter rewrite, not a store app, not a PWA install campaign.

Product v1 is a desktop client (`PRODUCT.md`: mobile apps are a non-goal). This note is only: if someone opens the existing Vite UI in Mobile Safari or Chrome, how do we stop the 3-pane from being unusable — and why a phone on Wi-Fi still cannot talk to the API until they **opt in**.

Theme stays night-olive copper (`NOTES.md`). No new palette, no webfonts, no CSS framework.

## Honest blocker: loopback

A phone on the same Wi-Fi **cannot reach Aether today.** That is intentional.

| Process | Bind today | File |
|---|---|---|
| Vite UI | `127.0.0.1:5173` (`--host 127.0.0.1`) | `apps/web/package.json` |
| Node API | `server.listen(PORT, "127.0.0.1")` (8787) | `apps/api/src/index.ts` |
| CORS | `http://127.0.0.1:5173`, `http://localhost:5173` only | `apps/api/src/security.ts` |

`127.0.0.1` on the phone is the *phone*, not the PC. The mailbox-password surface stays on loopback on purpose (`docs/SECURITY.md`: do not expose the API on the LAN; skill `localhost-api-security`: never `0.0.0.0` by default).

CSS will not fix this. Do the layout work anyway — it also helps a narrow desktop window and the future Tauri webview — but do not claim “open it on your phone” until LAN opt-in exists.

### Opt-in LAN (dev only, explicit)

Keep the **API on `127.0.0.1`**. The browser never talks to :8787; Vite already proxies `/api` → `http://127.0.0.1:8787`. Binding the password API to the LAN is the wrong knob.

1. Human sets an env or script flag. Default stays loopback.
2. Vite: `--host 0.0.0.0` (or the PC’s LAN IP). Phone loads `http://192.168.x.x:5173`.
3. Add that origin to `ALLOWED_ORIGINS` (not `*`). Phone `fetch` sends `Origin: http://192.168.x.x:5173`; anything else is 403.
4. Windows Firewall will prompt; say so.
5. Still HTTP on the LAN. Fine for a fixture on a trusted home net. Not fine for a real mailbox password. Say that in the UI if the flag is on.
6. Turn it off. Do not ship LAN bind in the Tauri `.exe`.

Ollama stays on the PC (`127.0.0.1:11434`). The phone only sees the already-proxied `/api/agent/*`.

## What the UI is today

`App.tsx` mounts one `.shell` grid (`styles.css`):

```
topbar (48px)     brand + search + 8 shortcut-labeled buttons
folders (196px)   accounts, add-account form, folder list
list    (300px)   rows, already `min-height: 44px`
read    (1fr)     headers, `<pre class="body">`, `.agent` skills, compose draft, `.agent-chat`
statusbar (22px)
```

Overlays (desk): `.compose` is a 360px card pinned bottom-right; `.settings` is `inset: 9vh 16vw`.

`styles.css` already has three width queries. Keep these numbers — do not invent a fourth scale.

| Query | What it does now | Gap |
|---|---|---|
| `max-width: 900px` | Squeeze 3-pane to `148px 240px 1fr`. Hide `.brand em`. Shrink search. Settings `4vh 4vw`. Compose `min(360px, 100vw - 24px)`. | Toolbar still 8 tiny shortcut buttons. |
| `max-width: 720px` | Folders **off**. List + read (`minmax(200px, 42%) 1fr`). | No ☰ to get folders back. Add-account is unreachable. |
| `max-width: 520px` | One column. Default = list. `.shell.has-mail` swaps to read; `.back-phone` clears selection. Topbar wraps. Compose full-bleed. Settings `inset: 0`. | Folders still gone (inherited from 720). Toolbar still 8 buttons. Thumb targets still desk-sized. |

Keyboard shortcuts (`c s e # u r f j k` in `App.tsx`) do nothing useful on a phone. Do not build a mobile UX that assumes them.

## Breakpoints

Measure CSS pixels, not device pixels. Match the queries already in `styles.css`. Phone portrait sits under 520; phone landscape / small tablet hits 720; a narrow desktop window hits 900.

| Name | Query | Panes | Why this number |
|---|---|---|---|
| Phone | `@media (max-width: 520px)` | **One** at a time (`.has-mail`) | Covers ~390–430 phone portrait. Current CSS already uses 520 — keep it. |
| Tablet | `521px – 720px` | **List + read**; folders drawer | Landed. Hide folders, not read. Landscape phones live here. |
| Narrow desk | `721px – 900px` | Squeezed 3-pane | Landed. 148 + 240 still fits a letter in the read column. |
| Desk | `min-width: 901px` | Full 3-pane (`196 / 300 / 1fr`) | Default tokens. |

Do **not** raise the single-pane cutoff to 719px — that would collapse landscape phones into one column and fight the CSS that already landed.

Optional: `@media (pointer: coarse)` to grow hit targets on a wide touch laptop, without changing pane count.

Use `100dvh` (not `100%` / `100vh`) for `.shell` under 900px so the mobile browser chrome does not clip the status row. Keep `prefers-reduced-motion` as-is.

## Pane model (phone)

List ↔ read is **already wired**. Do not invent a second switch.

```tsx
<div className={selected ? "shell has-mail" : "shell"}>
```

```tsx
<button className="back-phone" onClick={() => setSelectedId(null)}>← Inbox</button>
```

At 520px, `.has-mail` puts `read` in the only column and hides `.list`. `.back-phone` is `display: none` on desk and shows in that query. Keep this.

Still missing: **folders**. Under 720px `.folders { display: none }` with no ☰. Add `folders-open` on `.shell` (or `data-pane="folders"`) as a left drawer — do not replace `.has-mail`.

```
default (no has-mail)
  [ ☰ folders ]  INBOX · 3     [ search ] [ ✎ ]
  ─────────────────────────────────────────────
  ★ From                    4:12
  Subject line…

.has-mail (tap a .row)
  [ ← folder ]   subject truncated        [ ⋯ ]
  ─────────────────────────────────────────────
  headers + .body
  Aether ▸  (collapsed)
  ─────────────────────────────────────────────
  [ ★ ] [ Archive ] [ Trash ] [ Reply ]   ← 44px bar
```

`.folders-open` is a left drawer (~80vw, max 280px) over the list, not a second column. Dim with the same wash as `.settings` (`rgba(8, 10, 7, 0.62)`).

Wiring left:

- ☰ / backdrop / Escape: toggle `folders-open`.
- Folder button: already clears `selectedId`; also close the drawer.
- Back label: use the current folder name, not hard-coded “Inbox” (Drafts / Trash / Archive).
- New (`c` on desk): compose sheet; do not change pane.

Tablet (`max-width: 720px`): `folders-open` only. List and read stay side by side (already `minmax(200px, 42%) 1fr`). `.has-mail` must not hide the list here.

Narrow desk / desk: ignore both classes for layout.

```css
@media (max-width: 720px) {
  .shell.folders-open .folders {
    display: block;
    position: fixed;
    inset: var(--top-h) auto var(--status-h) 0;
    width: min(80vw, 280px);
    z-index: 4;
  }
}
```

Do not add a new wrapper around `.list` / `.read`.

## What to hide (phone)

Hide or collapse. Do not delete from `App.tsx`.

| Chrome | Phone | Why |
|---|---|---|
| `.brand em` (fixture / model line) | hide | **Done** at 900px |
| `.brand` min-width 220px | drop; allow shrink to Æ mark | **Done** at 900px |
| Shortcut suffixes `(c) (s) (e) (#) (f) (u)` | hide | Wrap in `<span class="kbd">` when TSX is open; until then live with the noise |
| Top `.toolbar` as 8 separate buttons | hide the bar | Replace with ☰ + search + compose in the topbar, and a **bottom action bar** on the read pane |
| Add-account form in `.folders` | hide | Settings already has the same form; 196px column + password field on a phone is hostile |
| `.counts i` (folder totals) | hide | Keep unread `<b>` only |
| Status second span (“Agent cannot send”) | hide under 420px | One muted line is enough |
| `.agent` skill chips + `.agent-chat` | collapsed `<details>` / `.agent[data-open]` | Product rule: agent is a drawer, not the home screen. Default closed. |
| `.agent header span` (“local model · cannot send…”) | hide | Repeats the status bar |
| Compose 360px card | full-bleed sheet | **Done** at 520px (`left/right: 8px`). Still not `inset: 0` / keyboard-safe. |
| Settings `9vh 16vw` inset | `inset: 0` | **Done** at 520px; 900px still uses `4vh 4vw` |

Keep on phone: folder names + unread, search, compose, star/archive/trash/reply on an open message, confirm-send (two-step, still human), Close on settings.

## Thumb targets

Apple HIG / WCAG 2.5.5: **44×44 CSS px** minimum. WCAG 2.5.8 AA is 24×24 — we already miss that on folders and toolbar. `.row` is the only control that already meets 44px (`NOTES.md`).

Under `max-width: 520px` and/or `(pointer: coarse)`:

| Control | Now | Target |
|---|---|---|
| `.folder` | padding 5×8 ≈ 26px tall | `min-height: 44px`; padding 12×12 |
| `.toolbar button` / new icon buttons | 4×8, 12px type | 44×44; icon or short word, no shortcut |
| `.row` | 44px / 6px pad | 48–52px; keep two-line from+subject |
| `.agent .actions button` | 3×7 chips | 44px tall, wrap; or only show inside the expanded agent |
| `.chat-input textarea` | min-height 44px | keep; **font-size: 16px** (iOS zooms focused inputs under 16px) |
| `.chat-input button` | ~32px | 44px min |
| `button.danger` (Confirm send) | compact | 48px tall, full width of the read pane |
| Compose Save / Cancel | compact | 44px; full-width stack |
| Bottom read actions | n/a | 48px bar + `padding-bottom: env(safe-area-inset-bottom)` |
| Settings Close | compact | 44px |

Spacing between adjacent 44px targets: 8px. No hover-only affordance — `:hover` moss wash stays for desk; selected state (`.on`, `.row.on`) is the phone signal.

`viewport` is already in `apps/web/index.html`. When safe-area padding lands, add `viewport-fit=cover`. Do not disable pinch-zoom (`user-scalable=no`).

## Overlays

**Compose.** `position: fixed; inset: 0; width: auto; bottom: 0` on phone. Top row: Cancel / “New message” / Save draft. Fields 16px. Sit above the keyboard with `dvh`, not a 360px card over the home indicator.

**Settings.** Full viewport. Section headings stay small-caps labels (`NOTES.md`). 16px inputs. The allow-cloud checkbox must remain a real 44px row, not a 13px label.

**Confirm send.** Stays a second tap on the same danger button (5-minute `confirmId`). On phone make the button full width and keep `.note` (“To alice@…”) on the line above it so the thumb does not cover the preview.

**Agent.** One disclosure at the bottom of the read pane: “Aether”. Closed, it is a single 44px row. Open, skills + transcript + chat. Do not auto-open on message select. Do not put chat on the list pane (today `AgentChat` also mounts when nothing is selected — hide that empty-state chat on phone).

## Tokens to add (CSS only)

Keep the existing names. Add next to `--top-h` / `--folder-w`:

```css
--touch: 44px;
--touch-bar: 48px;
```

On phone: `--top-h: 52px` (clear the notch with `env(safe-area-inset-top)`), `--status-h: 20px` or hide. Do not change desk values.

## Implementation order

1. **Done:** 900 / 720 / 520 queries, `.has-mail` list↔read, `.back-phone`.
2. `folders-open` drawer + ☰ so folders exist under 720px. Back label = current folder. Hide empty-state `AgentChat` on phone.
3. Grow `.folder`, compose, settings, inputs to 44px / 16px under 520px. Safe-area + `100dvh`.
4. Bottom action bar for star / archive / trash / reply; hide the eight-button top toolbar on phone.
5. Collapse `.agent` / `.agent-chat`.
6. Only then: documented LAN opt-in for Vite + CORS. Not in the same PR as a real password.

Do not start a second app. Do not add React Router unless hash/path back-button support is needed; `.has-mail` + `history.pushState` is enough if someone cares later.

## Out of scope

- React Native, Expo, Capacitor, PWA “Add to Home Screen” as a product
- Binding `aether-api` to `0.0.0.0`
- Swipe-to-archive as v1 (nice; not required to read mail)
- Virtualized lists, new icon font, new color tokens
- Changing IMAP / secrets / confirm-send rules
- Pretending the Tauri `.exe` is a phone app
