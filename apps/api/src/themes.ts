export const THEMES = [
  { id: "filament", label: "Filament", note: "Near-black, one amber line." },
  { id: "retro", label: "Retro", note: "Night-olive + copper. The original operate skin." },
  { id: "modern", label: "Modern", note: "Slate + steel, denser chrome." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}
