// Pure coordinate display helpers for the location detail popover. Self-contained
// WGS84 UTM forward projection (no proj4/utm dependency — this tool ships as a
// tight static bundle). The math is the standard Transverse Mercator forward
// transform; correctness is pinned by test/coords.test.ts against a reference.
//
// Lat/lng → IANA timezone, unlike UTM, isn't a formula — it depends on actual
// political/timezone boundary data, so this one pulls in `tz-lookup` (a small,
// dependency-free, offline lookup table) rather than hand-rolling it.

import tzlookup from 'tz-lookup';

export type ElevationUnit = 'meters' | 'feet';

export type UTM = {
  zoneNumber: number;
  zoneLetter: string;
  easting: number;
  northing: number;
  hemisphere: 'N' | 'S';
};

const A = 6378137; // WGS84 semi-major axis (m)
const E2 = 0.00669438; // WGS84 first eccentricity squared
const K0 = 0.9996; // UTM scale factor
const deg = Math.PI / 180;

// Latitude band letters for UTM/MGRS (C..X, omitting I and O), 8° bands from -80.
const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

function zoneLetterFor(lat: number): string {
  if (lat < -80) return 'C';
  if (lat >= 84) return 'X';
  return BANDS[Math.floor((lat + 80) / 8)];
}

function zoneNumberFor(lat: number, lng: number): number {
  // Standard Norway/Svalbard exceptions so the zone matches authoritative UTM.
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) return 31;
    if (lng >= 9 && lng < 21) return 33;
    if (lng >= 21 && lng < 33) return 35;
    if (lng >= 33 && lng < 42) return 37;
  }
  // Clamp the antimeridian: lng === 180 would compute zone 61, but zones are
  // 1..60 and zone 60 covers 174°–180°.
  return Math.min(60, Math.floor((lng + 180) / 6) + 1);
}

export function latLngToUTM(lat: number, lng: number): UTM {
  const zoneNumber = zoneNumberFor(lat, lng);
  const lngOrigin = (zoneNumber - 1) * 6 - 180 + 3;
  const latRad = lat * deg;
  const lngRad = lng * deg;
  const lngOriginRad = lngOrigin * deg;

  const eccPrime = E2 / (1 - E2);
  const N = A / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = eccPrime * Math.cos(latRad) ** 2;
  const Aa = Math.cos(latRad) * (lngRad - lngOriginRad);

  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * latRad -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    K0 *
      N *
      (Aa +
        ((1 - T + C) * Aa ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * eccPrime) * Aa ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (M +
      N *
        Math.tan(latRad) *
        (Aa ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * Aa ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * eccPrime) * Aa ** 6) / 720));
  if (lat < 0) northing += 10000000; // southern-hemisphere false northing

  return {
    zoneNumber,
    zoneLetter: zoneLetterFor(lat),
    easting: Math.round(easting),
    northing: Math.round(northing),
    hemisphere: lat >= 0 ? 'N' : 'S',
  };
}

/** Meters → feet, rounded to 2 dp — the exact upstream sparcd-web formula. */
export function metersToFeet(m: number): number {
  return Math.round((m * 3.28084 + Number.EPSILON) * 100) / 100;
}

export function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function formatUTM(lat: number, lng: number): string {
  const u = latLngToUTM(lat, lng);
  return `${u.zoneNumber}${u.zoneLetter} ${u.easting}E ${u.northing}N`;
}

export function formatElevation(m: number, unit: ElevationUnit): string {
  return unit === 'feet' ? `${metersToFeet(m)} ft` : `${m} m`;
}

/** The IANA zone a coordinate falls in — approximate near timezone borders. */
export function timeZoneForCoords(lat: number, lng: number): string {
  return tzlookup(lat, lng);
}
