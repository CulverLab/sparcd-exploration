// The camera-location registry — the selected collection's
// `Collections/<UUID>/locations.json` when that file is non-empty, with the
// SPARC'd settings bucket's `Settings/locations.json` as the fallback. Pure
// parsing/validation ported from the uploader's `locations.ts` verbatim (both
// apps read the same registry, independently, per CLAUDE.md's per-feature-
// optimization-over-shared-abstraction guidance); the S3 read below mirrors
// `species.ts`'s collection-first + discovery + fetch pattern.
//
// Shape verified against the live registry (250 entries) and the upstream
// `Location.java` model: a JSON array of objects, each with exactly
//   { nameProperty: string, idProperty: string,
//     latProperty: number, lngProperty: number, elevationProperty: number }
// Validity rules mirror Location.java: name/id non-empty, lat ∈ [-85, 85],
// lng ∈ [-180, 180], elevation ≠ the -20000 "unset" sentinel.

import type { S3Config } from '@sparcd/types';
import type { Deployment } from '@sparcd/camtrap';
import { getClient, parseCollectionKey, translateReadError } from './s3';

/** Exact object key, relative to the settings bucket. */
export const LOCATIONS_KEY = 'Settings/locations.json';

/** One entry as it appears on disk. */
export type RawLocation = {
  nameProperty: string;
  idProperty: string;
  latProperty: number;
  lngProperty: number;
  elevationProperty: number;
};

/**
 * A validated location, normalized to friendlier field names. `id` is *not*
 * unique in the registry — 15 ids repeat with different coordinates/names
 * (e.g. a "*DO NOT USE*" variant), and upstream keys records by id + coords.
 * `key` is that composite identity, used for selection and exact-dup collapse.
 */
export type Location = {
  key: string;
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
};

export type SkippedLocation = { raw: unknown; reason: string };

export type LocationsParse = {
  locations: Location[];
  skipped: SkippedLocation[];
};

/** Thrown when the document itself is the wrong shape (not the entries). */
export class LocationsShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationsShapeError';
  }
}

const ELEVATION_UNSET = -20000;

// Returns null when valid, or a human reason when not. Mirrors Location.java.
function invalidReason(o: Location): string | null {
  if (!o.name) return 'empty name';
  if (!o.id) return 'empty id';
  if (!(o.latitude >= -85 && o.latitude <= 85)) return `latitude ${o.latitude} out of [-85, 85]`;
  if (!(o.longitude >= -180 && o.longitude <= 180))
    return `longitude ${o.longitude} out of [-180, 180]`;
  if (o.elevation === ELEVATION_UNSET) return 'elevation unset';
  return null;
}

function coerce(entry: unknown): { ok: true; value: RawLocation } | { ok: false; reason: string } {
  if (typeof entry !== 'object' || entry === null) return { ok: false, reason: 'not an object' };
  const o = entry as Record<string, unknown>;
  for (const k of ['nameProperty', 'idProperty'] as const) {
    if (typeof o[k] !== 'string') return { ok: false, reason: `${k} is not a string` };
  }
  for (const k of ['latProperty', 'lngProperty', 'elevationProperty'] as const) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k]))
      return { ok: false, reason: `${k} is not a finite number` };
  }
  return {
    ok: true,
    value: {
      nameProperty: o.nameProperty as string,
      idProperty: o.idProperty as string,
      latProperty: o.latProperty as number,
      lngProperty: o.lngProperty as number,
      elevationProperty: o.elevationProperty as number,
    },
  };
}

/**
 * Parse the registry text. Throws `LocationsShapeError` only when the document
 * is not a JSON array. Individual malformed/invalid entries are partitioned
 * into `skipped` with a reason, so one bad row never sinks the whole picker.
 */
export function parseLocations(text: string): LocationsParse {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new LocationsShapeError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc)) {
    throw new LocationsShapeError('Expected a JSON array of locations');
  }

  const locations: Location[] = [];
  const skipped: SkippedLocation[] = [];
  const seenKeys = new Set<string>();

  for (const entry of doc) {
    const c = coerce(entry);
    if (!c.ok) {
      skipped.push({ raw: entry, reason: c.reason });
      continue;
    }
    const id = c.value.idProperty.trim();
    const loc: Location = {
      key: `${id}|${c.value.latProperty},${c.value.lngProperty}`,
      id,
      name: c.value.nameProperty.trim(),
      latitude: c.value.latProperty,
      longitude: c.value.lngProperty,
      elevation: c.value.elevationProperty,
    };
    const reason = invalidReason(loc);
    if (reason) {
      skipped.push({ raw: entry, reason });
      continue;
    }
    // Collapse only exact duplicates (same id AND coordinates). Same-id /
    // different-coords records are distinct locations and both kept.
    if (seenKeys.has(loc.key)) {
      skipped.push({ raw: entry, reason: 'duplicate (same id and coordinates)' });
      continue;
    }
    seenKeys.add(loc.key);
    locations.push(loc);
  }

  // Sort by name, then id, for a stable order among same-named variants.
  locations.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { locations, skipped };
}

/**
 * Map a chosen location to the single `deployments.csv` row for an upload.
 * `deploymentId` is `<collection-uuid>:<location-id>`, matching the existing
 * convention (verified against the live `…:SAN15` deployment).
 */
export function locationToDeployment(loc: Location, collectionUuid: string): Deployment {
  return {
    deploymentId: `${collectionUuid}:${loc.id}`,
    locationId: loc.id,
    locationName: loc.name,
    latitude: loc.latitude,
    longitude: loc.longitude,
    elevation: loc.elevation,
  };
}

/** Discover the settings bucket by probing visible buckets for `locations.json`. */
async function discoverSettingsBucket(cfg: S3Config, client = getClient(cfg)): Promise<string> {
  const buckets = await client.listBuckets();
  const found: string[] = [];
  await Promise.all(
    buckets.map(async (bucket) => {
      try {
        await client.statObject(bucket, LOCATIONS_KEY);
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
      `HEAD/GET "${LOCATIONS_KEY}" in one visible bucket, and that bucket must allow this origin via CORS.`,
  );
}

function settingsRank(bucket: string): number {
  if (bucket.startsWith('sparcd-settings-')) return 0;
  if (bucket === 'sparcd') return 1;
  return 2;
}

export type LocationsResult = LocationsParse & {
  /** Settings bucket when the fallback registry was used; null for collection data. */
  settingsBucket: string | null;
  sourceBucket: string;
  sourceKey: string;
};

function isMissingObjectError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound';
}

/** Read + parse the location registry, collection list first. */
export async function fetchLocations(
  cfg: S3Config,
  collectionKey?: string | null,
  client = getClient(cfg),
): Promise<LocationsResult> {
  if (collectionKey) {
    const { bucket, uuid } = parseCollectionKey(collectionKey);
    const collectionKeyPath = `Collections/${uuid}/locations.json`;
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
      const collectionParsed = parseLocations(new TextDecoder().decode(collectionBytes));
      if (collectionParsed.locations.length > 0) {
        return { ...collectionParsed, settingsBucket: null, sourceBucket: bucket, sourceKey: collectionKeyPath };
      }
    }
  }
  const settingsBucket = await discoverSettingsBucket(cfg, client);
  let bytes: Uint8Array;
  try {
    bytes = await client.getObject(settingsBucket, LOCATIONS_KEY);
  } catch (err) {
    throw translateReadError(err, `"${LOCATIONS_KEY}"`);
  }
  return { ...parseLocations(new TextDecoder().decode(bytes)), settingsBucket, sourceBucket: settingsBucket, sourceKey: LOCATIONS_KEY };
}
