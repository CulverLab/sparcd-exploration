// Species vocabulary — `Settings/species.json` in the SPARC'd settings bucket.
// Copied from sparcd-tagger; the only change is the s3 import path.

import type { S3Config } from '@sparcd/types';
import { translateReadError } from '@sparcd/s3-safe';
import { getClient } from './s3';

export const SPECIES_KEY = 'Settings/species.json';

export type RawSpecies = {
  name: string;
  scientificName: string;
  speciesIconURL: string;
  keyBinding: string | null;
};

export type Species = {
  key: string; // scientificName
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

async function discoverSettingsBucket(cfg: S3Config): Promise<string> {
  const client = getClient(cfg);
  const buckets = await client.listBuckets();
  const found: string[] = [];
  await Promise.all(
    buckets.map(async (bucket) => {
      try {
        await client.statObject(bucket, SPECIES_KEY);
        found.push(bucket);
      } catch {
        // not a settings bucket
      }
    }),
  );
  const ranked = found.sort((a, b) => settingsRank(a) - settingsRank(b) || a.localeCompare(b));
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

export type SpeciesResult = SpeciesParse & { settingsBucket: string };

export async function fetchSpecies(cfg: S3Config): Promise<SpeciesResult> {
  const client = getClient(cfg);
  const settingsBucket = await discoverSettingsBucket(cfg);
  let bytes: Uint8Array;
  try {
    bytes = await client.getObject(settingsBucket, SPECIES_KEY);
  } catch (err) {
    throw translateReadError(err, `"${SPECIES_KEY}"`);
  }
  return { ...parseSpecies(new TextDecoder().decode(bytes)), settingsBucket };
}
