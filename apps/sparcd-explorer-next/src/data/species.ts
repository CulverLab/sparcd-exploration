// The species list, copied from the Tagger's `lib/species.ts`: the
// collection's `species.json` when it has entries, then `Settings/species.json`,
// then the list bundled with the app when no settings bucket can be read.
//
// Shape (from the upstream Java writer): a flat JSON array of
//   { name, scientificName, speciesIconURL, keyBinding }
// where `name` is the common name and `scientificName` the natural key.

import raw from '../assets/defaultSpecies.json?raw';
import { NoSettingsBucketError, readCollectionOrSettings, type RegistrySource } from './settings';
import type { ReadClient } from './s3';

export type Species = {
  key: string; // scientificName
  commonName: string;
  scientificName: string;
  iconUrl: string;
  keyBinding: string | null;
};

export type SkippedSpecies = { raw: unknown; reason: string };
export type SpeciesParse = { species: Species[]; skipped: SkippedSpecies[] };

export class SpeciesShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeciesShapeError';
  }
}

/**
 * Parse a species list. Throws `SpeciesShapeError` only when the document is
 * not a JSON array; bad entries and repeated scientific names (first wins)
 * land in `skipped`.
 */
export function parseSpecies(text: string): SpeciesParse {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new SpeciesShapeError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc)) throw new SpeciesShapeError('Expected a JSON array of species');

  const species: Species[] = [];
  const skipped: SkippedSpecies[] = [];
  const seen = new Set<string>();
  for (const entry of doc) {
    if (typeof entry !== 'object' || entry === null) {
      skipped.push({ raw: entry, reason: 'not an object' });
      continue;
    }
    const o = entry as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const scientificName = typeof o.scientificName === 'string' ? o.scientificName.trim() : '';
    if (!name || !scientificName) {
      skipped.push({ raw: entry, reason: `${!name ? 'name' : 'scientificName'} is missing or empty` });
      continue;
    }
    if (seen.has(scientificName)) {
      skipped.push({ raw: entry, reason: 'duplicate scientificName' });
      continue;
    }
    seen.add(scientificName);
    species.push({
      key: scientificName,
      commonName: name,
      scientificName,
      iconUrl: typeof o.speciesIconURL === 'string' ? o.speciesIconURL.trim() : '',
      keyBinding: typeof o.keyBinding === 'string' ? o.keyBinding : null,
    });
  }
  species.sort((a, b) => a.commonName.localeCompare(b.commonName));
  return { species, skipped };
}

/** SPARC'd's own list, shipped with the app. */
export const DEFAULT_SPECIES: Species[] = parseSpecies(raw).species;

export type SpeciesResult = SpeciesParse & (RegistrySource | { source: 'default' });

export async function fetchSpecies(
  client: ReadClient,
  collection: { bucket: string; uuid: string } | null,
): Promise<SpeciesResult> {
  try {
    const { parsed, ...source } = await readCollectionOrSettings(
      client,
      collection,
      'species.json',
      parseSpecies,
      (p) => p.species.length === 0,
    );
    return { ...parsed, ...source };
  } catch (err) {
    if (err instanceof NoSettingsBucketError) return { species: DEFAULT_SPECIES, skipped: [], source: 'default' };
    throw err;
  }
}

// --- Naming --------------------------------------------------------------------

export type SpeciesName = { key: string; scientificName: string; commonName: string; name: string };

/**
 * Names an observation's species: the species list's common name first, then
 * the row's `[COMMONNAME:…]` marker, then the scientific name. A row naming
 * neither is a placeholder, not a species, and gets null.
 *
 * `lists` merge in order; the first list to name a scientific name wins.
 */
export function speciesNamer(...lists: Species[][]) {
  const bySci = new Map<string, Species>();
  const byCommon = new Map<string, Species>();
  for (const s of lists.flat()) {
    if (!bySci.has(s.scientificName)) bySci.set(s.scientificName, s);
    const common = s.commonName.toLowerCase();
    if (!byCommon.has(common)) byCommon.set(common, s);
  }
  return (scientificName: string, commonMarker: string | null): SpeciesName | null => {
    const sci = scientificName.trim();
    const common = (commonMarker ?? '').trim();
    if (!sci && !common) return null;
    // A row with only a common name joins the listed species of that name.
    const listed = sci ? bySci.get(sci) : byCommon.get(common.toLowerCase());
    const key = listed?.scientificName ?? (sci || common);
    return {
      key,
      scientificName: listed?.scientificName ?? sci,
      commonName: listed?.commonName ?? common,
      name: listed?.commonName || common || sci,
    };
  };
}
