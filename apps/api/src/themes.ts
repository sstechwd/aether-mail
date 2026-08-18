export const THEMES = [
  { id: "retro", label: "Retro", note: "Night-olive + copper. The original operate skin." },
  { id: "modern", label: "Modern", note: "Cleaner chrome, quieter type. Library slot — CSS fills it." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}
