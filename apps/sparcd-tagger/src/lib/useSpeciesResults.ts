import { useMemo } from 'react';
import Fuse from 'fuse.js';
import type { Species } from './species';

/** One result list shared by the visible panel and the filter's Enter action. */
export function useSpeciesResults(species: Species[], filter: string, recent: string[], sortByRecent: boolean): Species[] {
  const fuse = useMemo(
    () =>
      new Fuse(species, {
        keys: ['commonName', 'scientificName'],
        threshold: 0.34,
        ignoreLocation: true,
      }),
    [species],
  );

  return useMemo(() => {
    // An active search ranks by text relevance regardless of the setting below
    // — overriding what someone's actively typing to find with alphabetical
    // order would fight the search, not help it.
    if (filter.trim()) return fuse.search(filter.trim()).map((r) => r.item);
    const base = sortByRecent
      ? species
      : [...species].sort((a, b) => a.commonName.localeCompare(b.commonName));
    if (!sortByRecent || !recent.length) return base;
    const rank = new Map(recent.map((s, i) => [s, i]));
    // Stable float: recents to the top in recency order, everything else as-is.
    return [...base].sort((a, b) => {
      const ra = rank.has(a.scientificName) ? rank.get(a.scientificName)! : Infinity;
      const rb = rank.has(b.scientificName) ? rank.get(b.scientificName)! : Infinity;
      return ra - rb;
    });
  }, [species, filter, fuse, recent, sortByRecent]);
}
