// The camera-location registry, copied from the Tagger's `lib/locations.ts`:
// the collection's `locations.json` when it has entries, else
// `Settings/locations.json`.
//
// Shape (verified against the live registry and upstream `Location.java`): a
// JSON array of { nameProperty, idProperty, latProperty, lngProperty,
// elevationProperty }. Validity mirrors Location.java: name and id non-empty,
// lat in [-85, 85], lng in [-180, 180], elevation not the -20000 "unset" value.
//
// An id is not unique in the registry: the same id repeats with other
// coordinates or names. An entry is keyed by id plus coordinates, never by id.

import { readCollectionOrSettings, type RegistrySource } from './settings';
import type { ReadClient } from './s3';

export type RegistryLocation = {
  key: string; // id + coordinates
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
};

export type SkippedLocation = { raw: unknown; reason: string };
export type LocationsParse = { locations: RegistryLocation[]; skipped: SkippedLocation[] };

export class LocationsShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationsShapeError';
  }
}

const ELEVATION_UNSET = -20000;

/**
 * Registry identity: the id and its coordinates at the six decimals
 * `deployments.csv` is written with, so a deployment finds its entry.
 */
export function registryKey(id: string, latitude: number, longitude: number): string {
  return `${id.trim()}|${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function invalidReason(o: RegistryLocation): string | null {
  if (!o.name) return 'empty name';
  if (!o.id) return 'empty id';
  if (!(o.latitude >= -85 && o.latitude <= 85)) return `latitude ${o.latitude} out of [-85, 85]`;
  if (!(o.longitude >= -180 && o.longitude <= 180)) return `longitude ${o.longitude} out of [-180, 180]`;
  if (o.elevation === ELEVATION_UNSET) return 'elevation unset';
  return null;
}

function coerce(entry: unknown): RegistryLocation | string {
  if (typeof entry !== 'object' || entry === null) return 'not an object';
  const o = entry as Record<string, unknown>;
  for (const k of ['nameProperty', 'idProperty'] as const) {
    if (typeof o[k] !== 'string') return `${k} is not a string`;
  }
  for (const k of ['latProperty', 'lngProperty', 'elevationProperty'] as const) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return `${k} is not a finite number`;
  }
  const id = (o.idProperty as string).trim();
  const latitude = o.latProperty as number;
  const longitude = o.lngProperty as number;
  return {
    key: registryKey(id, latitude, longitude),
    id,
    name: (o.nameProperty as string).trim(),
    latitude,
    longitude,
    elevation: o.elevationProperty as number,
  };
}

/**
 * Parse the registry. Throws `LocationsShapeError` only when the document is
 * not a JSON array; bad entries and exact duplicates (same id and
 * coordinates) land in `skipped`. Same id at other coordinates is kept.
 */
export function parseLocations(text: string): LocationsParse {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new LocationsShapeError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc)) throw new LocationsShapeError('Expected a JSON array of locations');

  const locations: RegistryLocation[] = [];
  const skipped: SkippedLocation[] = [];
  const seen = new Set<string>();
  for (const entry of doc) {
    const loc = coerce(entry);
    const reason = typeof loc === 'string' ? loc : invalidReason(loc);
    if (typeof loc === 'string' || reason) {
      skipped.push({ raw: entry, reason: reason! });
      continue;
    }
    if (seen.has(loc.key)) {
      skipped.push({ raw: entry, reason: 'duplicate (same id and coordinates)' });
      continue;
    }
    seen.add(loc.key);
    locations.push(loc);
  }
  locations.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { locations, skipped };
}

export type LocationsResult = LocationsParse & RegistrySource;

export async function fetchLocations(
  client: ReadClient,
  collection: { bucket: string; uuid: string } | null,
): Promise<LocationsResult> {
  const { parsed, ...source } = await readCollectionOrSettings(
    client,
    collection,
    'locations.json',
    parseLocations,
    (p) => p.locations.length === 0,
  );
  return { ...parsed, ...source };
}
