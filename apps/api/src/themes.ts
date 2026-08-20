export const THEMES = [
  { id: "modern", label: "Modern", note: "Slate and steel. Soft depth, roomy rows. The default." },
  { id: "filament", label: "Filament", note: "Near-black with a single amber line. Focused." },
  { id: "retro", label: "Classic", note: "Night-olive and copper. The old-school terminal skin." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}
