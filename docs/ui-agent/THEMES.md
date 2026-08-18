# Themes

`document.documentElement.dataset.theme` is `retro` or `modern`, restored from `localStorage aether.theme`. Settings → Theme is the picker (`/api/themes`).

**Retro** (default) is the night-olive operate desk: copper filament, 2px accent bar, 56×24 chrome, 2px corners, serif letter body, stepped `· · ·` wait.

**Modern** is a denser slate instrument: arctic-steel accent (not indigo SaaS), 42×20 chrome, 6px corners, sans everywhere, 160ms hover ease.

Tokens live in `:root[data-theme="…"]` in `apps/web/src/styles.css`. New skins = a new `data-theme` plus the same classes (`shell`, `folders`, `list`, `read`, `agent-chat`, `settings`, `toolbar`, `compose`, `statusbar`, `threat`).

Chat wait is `.chat-wait .dots`. Retro steps three middots; Modern pulses three steel pips. `.token-bar` fill is 0–100% from `/api/usage` (`i` width, `em` label).

Custom themes are CSS variables only. No webfonts, no purple, no `innerHTML` for mail. Keep the `.has-mail` phone swap.

Do not start a second Vite on 5173. Prove a switch by `data-theme` changing in Settings.
