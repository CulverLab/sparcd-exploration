// The camera-location registry is read from the selected collection's
// `Collections/<UUID>/locations.json` when non-empty, with the SPARC'd
// settings bucket's `Settings/locations.json` as the fallback. Parsing and
// validation stay here; the S3 read lives in s3.ts.
//
// Shape verified against the live registry (250 entries) and the upstream
// `Location.java` model: a JSON array of objects, each with exactly
//   { nameProperty: string, idProperty: string,
//     latProperty: number, lngProperty: number, elevationProperty: number }
// Validity rules mirror Location.java: name/id non-empty, lat ∈ [-85, 85],
// lng ∈ [-180, 180], elevation ≠ the -20000 "unset" sentinel.

import type { Deployment } from '@sparcd/camtrap';

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
 * `deployment_id` is `<collection-uuid>:<location-id>`, matching the existing
 * convention (verified against the live `…:SAN15` deployment). The CSV
 * serializer lands in P3; this gives it a typed source.
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
