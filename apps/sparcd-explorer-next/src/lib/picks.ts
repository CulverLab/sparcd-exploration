// The chooser's picks: collection keys, and the rows a search leaves showing.

/** The collections whose name holds `query`, ignoring case; all of them for an empty one. */
export function matching<T>(all: T[], query: string, name: (c: T) => string): T[] {
  const q = query.trim().toLowerCase();
  return q ? all.filter((c) => name(c).toLowerCase().includes(q)) : all;
}

/** `picks` with every one of `keys` added after them. */
export const pickAll = (picks: string[], keys: string[]): string[] => [...picks, ...keys.filter((k) => !picks.includes(k))];

/** `picks` without any of `keys`. */
export const unpickAll = (picks: string[], keys: string[]): string[] => picks.filter((k) => !keys.includes(k));
