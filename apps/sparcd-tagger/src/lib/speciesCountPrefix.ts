export const MAX_PREFIXED_SPECIES_COUNT = 20;

export function appendSpeciesCountDigit(current: string, digit: string): string {
  if (!/^\d$/.test(digit)) return current;
  const next = Number(`${current}${digit}`);
  if (next < 1) return current;
  return String(Math.min(next, MAX_PREFIXED_SPECIES_COUNT));
}

export function removeSpeciesCountDigit(current: string): string {
  return current.slice(0, -1);
}

export function speciesCountFromPrefix(current: string): number | null {
  return current ? Number(current) : null;
}
