# UI agent — second visual pass

CSS-only. Keep every existing class (`shell`, `folders`, `list`, `read`, `agent-chat`, `settings`, `toolbar`, `compose`, `statusbar`, `sb-*`). No new framework, no webfonts, no TS / API / Rust. Palette and tokens stay as in `NOTES.md` (night-olive, copper filament).

Olive/copper landed. This pass is five density/instrument tweaks, not a restyle.

**File:** `apps/web/src/styles.css` only.

---

### 1. Status bar as an instrument — **applied**

Live `App.tsx` already mounts `<footer class="statusbar">` with two unlabeled `<span>`s (`Local client · …`, `Agent cannot send`). It does **not** yet emit `sb-sync` / `sb-unread` / `sb-agent`. Style the live children; leave the `sb-*` hooks in place for a later App fill.

- `.statusbar` is a locked 22px row: `height` + `max-height` = `--status-h`, `overflow: hidden`, `white-space: nowrap`.
- `.statusbar > span` ellipsizes (`min-width: 0`).
- Adjacent spans get a faint mid-dot via `span + span::before` (no extra DOM).
- Last span `margin-left: auto` so the policy/agent cell sits on the right.
- Keep `.sb-unread` copper and `.sb-agent[data-state="thinking"]` warm.

Do not invent a `status` class. Do not grow the bar when copy is long.

---

### 2. Narrow-window operate — **applied**

The first-pass `@media (max-width: 900px)` hid `.read`. Wrong for an Operate surface: the letter disappeared while folders stayed.

| Width | Layout |
|---|---|
| > 900 | folders \| list \| read (unchanged) |
| ≤ 900 | Keep 3-pane; shrink folder/list; drop brand subtitle; tighten search |
| ≤ 720 | Hide **folders** (not read); list \| read |
| ≤ 520 | List-first (hide read — no TS pane switcher yet); wrap topbar; compose inset; settings full-bleed |

Compose stays above the status bar (`bottom: calc(var(--status-h) + …)`). `--status-h` does not grow.

A real mobile pane switcher (folders ↔ list ↔ read) needs `App.tsx`. Out of scope here.

---

### 3. Unread pip gutter — **not applied**

`.row.unread .from::before` is a 6px copper pip that shifts the from-line vs read rows. Reserve a 12px left gutter on every `.row` and absolutely position the pip so columns do not jump. Not an accent rail (see slop audit in `NOTES.md`).

```css
.row { position: relative; padding-left: 20px; }
.row.unread .from::before {
  position: absolute;
  left: 8px;
  top: 12px;
  margin: 0;
}
```

---

### 4. Selected moss tick — **not applied**

`.folder.on` / `.row.on` share `--select` with hover-adjacent moss and can vanish on cheap panels. Add a 2px **inset** tick, lichen not copper:

```css
.folder.on,
.row.on {
  box-shadow: inset 2px 0 0 var(--ok);
}
```

Unread stays pip-on-from. Selected is the only left edge. Do not wash the row in `--accent`.

---

### 5. Focus rings + compose collision — **not applied**

- `:focus-visible` on `.row` / `.folder` / `.toolbar button`: `outline-offset: -2px` so the copper ring is not clipped by `overflow: auto` panes.
- `.brand { min-width: 0 }` (first pass pins 220px and crushes the toolbar before the 900px query).
- `.compose` at ≤400px: `left/right: 8px; width: auto` so 360px does not hang off a narrow window. Already partly covered by tweak 2 at 520px; this is the remaining desktop-narrow case.

---

## Do not

- New CSS framework, Tailwind, or webfonts.
- Rename or add classes (except using selectors that already exist).
- Touch `App.tsx`, `AgentChat.tsx`, Settings, API, or Rust.
- Restore hiding `.read` at 900px.
- Turn the agent log back into bubbles / button blobs.
- Commit unless asked.

## Verify

Resize the Vite tab through 1100 / 800 / 640 / 480. Status bar stays one 22px row. Read pane visible until 520. Compose and settings stay on-canvas. `prefers-reduced-motion` still kills animation.
