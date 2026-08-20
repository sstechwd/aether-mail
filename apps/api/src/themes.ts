export const THEMES = [
  { id: "midnight", label: "Midnight", note: "Deep navy, blue accent. Modern product feel." },
  { id: "paper", label: "Paper", note: "Warm light, deep green. Quiet and editorial." },
  { id: "modern", label: "Slate", note: "Slate and steel. Neutral dark." },
  { id: "filament", label: "Filament", note: "Near-black with a single amber line. Focused." },
  { id: "retro", label: "Classic", note: "Night-olive and copper. The old-school terminal skin." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}
