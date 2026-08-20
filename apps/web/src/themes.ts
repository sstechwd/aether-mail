export const THEMES = [
  { id: "midnight", label: "Midnight", note: "Deep navy, blue accent. Modern product feel." },
  { id: "paper", label: "Paper", note: "Warm light, deep green. Quiet and editorial." },
  { id: "modern", label: "Slate", note: "Slate and steel. Neutral dark." },
  { id: "filament", label: "Filament", note: "Near-black with a single amber line. Focused." },
  { id: "retro", label: "Classic", note: "Night-olive and copper. The old-school terminal skin." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/**
 * Midnight is the default.
 *
 * It used to be `filament`, the darkest and most terminal-looking skin, which
 * is why the app read as old-school on first run. Every other look is one
 * click away in Settings — the point is agency, not a single right answer.
 */
const DEFAULT_THEME: ThemeId = "midnight";

export function readTheme(): ThemeId {
  try {
    const raw = localStorage.getItem("aether.theme");
    if (!raw) return DEFAULT_THEME;

    // One-time migration for installs that never explicitly chose a theme and
    // are still carrying an old default.
    const migrated = localStorage.getItem("aether.theme.migrated2");
    if (!migrated && (raw === "filament" || raw === "modern")) {
      localStorage.setItem("aether.theme.migrated2", "1");
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
