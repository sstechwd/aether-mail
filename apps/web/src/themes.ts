export const THEMES = [
  { id: "filament", label: "Filament", note: "Near-black, one amber line. Default." },
  { id: "retro", label: "Retro", note: "Night-olive + copper desk." },
  { id: "modern", label: "Modern", note: "Slate + steel, denser chrome." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function readTheme(): ThemeId {
  try {
    const raw = localStorage.getItem("aether.theme") || "filament";
    return THEMES.some((t) => t.id === raw) ? (raw as ThemeId) : "filament";
  } catch {
    return "filament";
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
