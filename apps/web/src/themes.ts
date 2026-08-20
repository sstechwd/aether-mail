export const THEMES = [
  { id: "modern", label: "Modern", note: "Slate and steel. Soft depth, roomy rows. Default." },
  { id: "filament", label: "Filament", note: "Near-black with a single amber line. Focused." },
  { id: "retro", label: "Classic", note: "Night-olive and copper. The old-school terminal skin." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/**
 * Modern is the default.
 *
 * It used to be `filament`, which meant a first-time user saw the darkest,
 * most terminal-looking skin and had to go hunting in Settings to find
 * anything else. The classic looks are still one click away for anyone who
 * wants them.
 */
const DEFAULT_THEME: ThemeId = "modern";

export function readTheme(): ThemeId {
  try {
    const raw = localStorage.getItem("aether.theme");
    if (!raw) return DEFAULT_THEME;

    // One-time migration: everyone who used the app before Modern became the
    // default has "filament" saved from the old default, not from choosing it.
    // Move them across once; if they pick a theme afterwards it sticks.
    const migrated = localStorage.getItem("aether.theme.migrated");
    if (!migrated && raw === "filament") {
      localStorage.setItem("aether.theme.migrated", "1");
      localStorage.setItem("aether.theme", DEFAULT_THEME);
      return DEFAULT_THEME;
    }

    return THEMES.some((t) => t.id === raw) ? (raw as ThemeId) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem("aether.theme", id);
  } catch {
    /* ignore */
  }
}
