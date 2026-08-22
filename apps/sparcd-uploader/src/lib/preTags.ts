// Pre-upload species tags: in-memory draft state for the Tag wizard step.
// Types and pure transforms copied from the tagger — no Dexie persistence,
// no upload-context keying. Keyed by FileEntry.id in the uploader store.

export type DraftObservation = {
  scientificName: string; // species or non-animal label; never '' once stored
  commonName: string; // '' when none / requested-only
  count: number; // ≥1 always
  requestedSpecies: string; // free-text request; '' otherwise
  freeTags: string; // extra raw markers, preserved verbatim
};

/** The species a UI action applies to an image (add-only; one species). */
export type AppliedTag = {
  scientificName: string;
  commonName: string;
  count: number; // floored to ≥1
  requestedSpecies?: string;
  freeTags?: string;
};

/** The built-in non-animal label. Mutually exclusive with real species. */
export const GHOST = { label: 'Casper', commonName: 'Ghost' } as const;
export const GHOST_KEY = 'G';

export const isGhostObs = (o: DraftObservation): boolean => o.scientificName === GHOST.label;

const isGhost = isGhostObs;

/** Add-only: already-present species is a NO-OP. Ghost replaces all; a real
 *  species clears Ghost. */
export function addObservation(obs: DraftObservation[], tag: AppliedTag): DraftObservation[] {
  const next: DraftObservation = {
    scientificName: tag.scientificName,
    commonName: tag.commonName,
    count: Math.max(1, tag.count),
    requestedSpecies: tag.requestedSpecies ?? '',
    freeTags: tag.freeTags ?? '',
  };
  if (isGhost(next)) return [next];
  const withoutGhost = obs.filter((o) => !isGhost(o));
  if (withoutGhost.some((o) => o.scientificName === next.scientificName)) return withoutGhost;
  return [...withoutGhost, next];
}

/** Remove exactly the named species. */
export function removeObservation(obs: DraftObservation[], scientificName: string): DraftObservation[] {
  return obs.filter((o) => o.scientificName !== scientificName);
}

/** Set one species' count (floored to ≥1). */
export function setObservationCount(obs: DraftObservation[], scientificName: string, count: number): DraftObservation[] {
  return obs.map((o) =>
    o.scientificName === scientificName ? { ...o, count: Math.max(1, count) } : o,
  );
}
