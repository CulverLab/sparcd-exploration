// The species vocabulary is read from the selected collection's
// `Collections/<UUID>/species.json` when that file is non-empty, with the
// SPARC'd settings bucket's `Settings/species.json` as the fallback.
//
// Shape confirmed against the upstream Java writer (`model/species/Species.java`
// + `resources/species.json`): a flat JSON array of
//   { name: string, scientificName: string, speciesIconURL: string,
//     keyBinding: string | null }
// `name` is the common name; `keyBinding` is a Java KeyCode string (e.g. "D",
// "DIGIT1") or null. There is no genus/species tree and no `id` field, so the
// natural key is `scientificName`. Live-bucket presence still needs to be
// verified once credentials are available (see plan P0 notes); the *shape* is
// pinned here from the tool that writes the file.

import type { S3Config } from '@sparcd/types';
import { getClient, parseCollectionKey, translateReadError } from './s3';

export const SPECIES_KEY = 'Settings/species.json';

/** One entry exactly as it appears on disk. */
export type RawSpecies = {
  name: string;
  scientificName: string;
  speciesIconURL: string;
  keyBinding: string | null;
};

/** A validated species, normalized for the tagger. `key` is the natural key. */
export type Species = {
  key: string; // scientificName (the natural key — see the id-uniqueness note)
  commonName: string;
  scientificName: string;
  iconUrl: string;
  keyBinding: string | null;
};

export type SkippedSpecies = { raw: unknown; reason: string };

export type SpeciesParse = {
  species: Species[];
  skipped: SkippedSpecies[];
};

export class SpeciesShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeciesShapeError';
  }
}

function coerce(entry: unknown): { ok: true; value: RawSpecies } | { ok: false; reason: string } {
  if (typeof entry !== 'object' || entry === null) return { ok: false, reason: 'not an object' };
  const o = entry as Record<string, unknown>;
  for (const k of ['name', 'scientificName'] as const) {
    if (typeof o[k] !== 'string' || !(o[k] as string).trim())
      return { ok: false, reason: `${k} is missing or empty` };
  }
  return {
    ok: true,
    value: {
      name: o.name as string,
      scientificName: o.scientificName as string,
      speciesIconURL: typeof o.speciesIconURL === 'string' ? o.speciesIconURL : '',
      keyBinding: typeof o.keyBinding === 'string' ? o.keyBinding : null,
    },
  };
}

/**
 * Parse the species registry. Throws `SpeciesShapeError` only when the document
 * is not a JSON array; malformed entries are partitioned into `skipped`.
 * Duplicate scientific names are collapsed (first wins) and recorded — keying
 * on `scientificName` mirrors the `locations.json` id-is-not-unique caution
 * until the live registry proves names are unique.
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
    const c = coerce(entry);
    if (!c.ok) {
      skipped.push({ raw: entry, reason: c.reason });
      continue;
    }
    const key = c.value.scientificName.trim();
    if (seen.has(key)) {
      skipped.push({ raw: entry, reason: 'duplicate scientificName' });
      continue;
    }
    seen.add(key);
    species.push({
      key,
      commonName: c.value.name.trim(),
      scientificName: key,
      iconUrl: c.value.speciesIconURL.trim(),
      keyBinding: c.value.keyBinding,
    });
  }
  species.sort((a, b) => a.commonName.localeCompare(b.commonName));
  return { species, skipped };
}

/** Discover the settings bucket by probing visible buckets for `species.json`. */
async function discoverSettingsBucket(cfg: S3Config, client = getClient(cfg)): Promise<string> {
  const buckets = await client.listBuckets();
  const found: string[] = [];
  await Promise.all(
    buckets.map(async (bucket) => {
      try {
        await client.statObject(bucket, SPECIES_KEY);
        found.push(bucket);
      } catch {
        // Not a settings bucket, unreadable, or CORS-blocked.
      }
    }),
  );
  // Prefer the official settings bucket name, then the legacy `sparcd` bucket.
  const ranked = found.sort(
    (a, b) => settingsRank(a) - settingsRank(b) || a.localeCompare(b),
  );
  if (ranked[0]) return ranked[0];
  throw new Error(
    `No readable settings bucket found. The connected credentials must be able to ` +
      `HEAD/GET "${SPECIES_KEY}" in one visible bucket, and that bucket must allow this origin via CORS.`,
  );
}

function settingsRank(bucket: string): number {
  if (bucket.startsWith('sparcd-settings-')) return 0;
  if (bucket === 'sparcd') return 1;
  return 2;
}

export type SpeciesResult = SpeciesParse & {
  /** Settings bucket when the fallback registry was used; null for collection data. */
  settingsBucket: string | null;
  sourceBucket: string;
  sourceKey: string;
};

function isMissingObjectError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound';
}

/** Read + parse the species registry from the discovered settings bucket. */
export async function fetchSpecies(
  cfg: S3Config,
  collectionKey?: string | null,
  client = getClient(cfg),
): Promise<SpeciesResult> {
  if (collectionKey) {
    const { bucket, uuid } = parseCollectionKey(collectionKey);
    const collectionKeyPath = `Collections/${uuid}/species.json`;
    let collectionBytes: Uint8Array | undefined;
    try {
      collectionBytes = await client.getObject(bucket, collectionKeyPath);
    } catch (err) {
      if (!isMissingObjectError(err)) {
        throw translateReadError(err, `"${collectionKeyPath}" in bucket "${bucket}"`);
      }
      // A missing collection assignment falls back to settings.
    }
    if (collectionBytes) {
      const collectionParsed = parseSpecies(new TextDecoder().decode(collectionBytes));
      if (collectionParsed.species.length > 0) {
        return { ...collectionParsed, settingsBucket: null, sourceBucket: bucket, sourceKey: collectionKeyPath };
      }
    }
  }
  const settingsBucket = await discoverSettingsBucket(cfg, client);
  let bytes: Uint8Array;
  try {
    bytes = await client.getObject(settingsBucket, SPECIES_KEY);
  } catch (err) {
    throw translateReadError(err, `"${SPECIES_KEY}"`);
  }
  return { ...parseSpecies(new TextDecoder().decode(bytes)), settingsBucket, sourceBucket: settingsBucket, sourceKey: SPECIES_KEY };
}
