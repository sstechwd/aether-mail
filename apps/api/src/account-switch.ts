export function resolveAccountSwitch(input: {
  requested: string;
  fixtureId: string;
  savedIds: string[];
}): string | null {
  const id = input.requested.trim();
  if (!id) return null;
  if (id === input.fixtureId) return id;
  return input.savedIds.includes(id) ? id : null;
}
