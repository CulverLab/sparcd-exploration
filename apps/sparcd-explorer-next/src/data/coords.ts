// Coordinates: positions, UTM, display precision and elevation units.
// Camera positions are sensitive, so anything shown or exported goes through
// the current precision first.

export type Position = { lat: number; lon: number };

/**
 * A deployment's coordinates as a usable position, or null. Latitude and
 * longitude written the wrong way round are swapped back, as the old explorer
 * did; anything still out of range has no position.
 */
export function sitePosition(lat: number | null, lon: number | null): Position | null {
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90) [lat, lon] = [lon, lat];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // 0,0 is a blank written as numbers, never a camera.
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

// --- UTM (WGS84), ported from the old explorer -------------------------------

export type Utm = { zone: number; hemisphere: 'N' | 'S'; easting: number; northing: number };

export function toUtm(lat: number, lon: number): Utm {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const a = 6378137.0;
  const eccSq = 0.00669438;
  const k0 = 0.9996;
  const rad = Math.PI / 180;
  const latRad = lat * rad;
  const lonOriginRad = ((zone - 1) * 6 - 180 + 3) * rad;
  const eccPrimeSq = eccSq / (1 - eccSq);
  const n = a / Math.sqrt(1 - eccSq * Math.sin(latRad) ** 2);
  const t = Math.tan(latRad) ** 2;
  const c = eccPrimeSq * Math.cos(latRad) ** 2;
  const aa = Math.cos(latRad) * (lon * rad - lonOriginRad);
  const m =
    a *
    ((1 - eccSq / 4 - (3 * eccSq ** 2) / 64 - (5 * eccSq ** 3) / 256) * latRad -
      ((3 * eccSq) / 8 + (3 * eccSq ** 2) / 32 + (45 * eccSq ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * eccSq ** 2) / 256 + (45 * eccSq ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * eccSq ** 3) / 3072) * Math.sin(6 * latRad));
  const easting =
    k0 * n * (aa + ((1 - t + c) * aa ** 3) / 6 + ((5 - 18 * t + t ** 2 + 72 * c - 58 * eccPrimeSq) * aa ** 5) / 120) +
    500000;
  let northing =
    k0 *
    (m +
      n *
        Math.tan(latRad) *
        (aa ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * aa ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * eccPrimeSq) * aa ** 6) / 720));
  if (lat < 0) northing += 10000000;
  return { zone, hemisphere: lat >= 0 ? 'N' : 'S', easting, northing };
}

// --- Display precision -------------------------------------------------------

/** Round or truncate to `digits` decimals of a degree; `null` digits is exact. */
export type Precision = { method: 'round' | 'truncate'; digits: number | null };

export const DEFAULT_PRECISION: Precision = { method: 'round', digits: 3 };

function reduce(value: number, step: number, method: Precision['method']): number {
  // Snap away float noise first, so 32.123 truncates to 32.123, not 32.122.
  const units = Math.round((value / step) * 1e6) / 1e6;
  return (method === 'round' ? Math.sign(units) * Math.round(Math.abs(units)) : Math.trunc(units)) * step;
}

/** A latitude or longitude at the display precision. */
export function reduceDegrees(value: number, p: Precision): number {
  if (p.digits === null) return value;
  return Number(reduce(value, 10 ** -p.digits, p.method).toFixed(p.digits));
}

/** UTM metres at the same precision: d decimals of a degree is about 10^(5-d) m. */
export function reduceMetres(value: number, p: Precision): number {
  if (p.digits === null) return Math.round(value);
  return Math.round(reduce(value, 10 ** (5 - p.digits), p.method));
}

export function formatDegrees(value: number, p: Precision): string {
  const v = reduceDegrees(value, p);
  return p.digits === null ? String(v) : v.toFixed(p.digits);
}

/** UTM as plain integers with no separators, e.g. `3468600`. */
export function formatUtm(pos: Position, p: Precision): { zone: string; easting: string; northing: string } {
  const u = toUtm(pos.lat, pos.lon);
  return {
    zone: `${u.zone}${u.hemisphere}`,
    easting: String(reduceMetres(u.easting, p)),
    northing: String(reduceMetres(u.northing, p)),
  };
}

/**
 * The precision in words, for a report or an export: "Coordinates rounded to
 * 2 decimal places", "UTM, rounded to 1,000 m".
 */
export function precisionWords(coords: 'latlon' | 'utm', p: Precision): string {
  const how = p.method === 'round' ? 'rounded' : 'truncated';
  if (coords === 'utm') {
    return p.digits === null ? 'UTM, exact to the metre' : `UTM, ${how} to ${(10 ** (5 - p.digits)).toLocaleString('en-US')} m`;
  }
  if (p.digits === null) return 'Exact coordinates';
  if (p.digits === 0) return `Coordinates ${how} to whole degrees`;
  return `Coordinates ${how} to ${p.digits} decimal place${p.digits === 1 ? '' : 's'}`;
}

/** Where a site may be drawn: never more exact than the display precision. */
export function displayPosition(pos: Position, p: Precision): Position {
  return { lat: reduceDegrees(pos.lat, p), lon: reduceDegrees(pos.lon, p) };
}

// --- Elevation -----------------------------------------------------------------

export type ElevationUnit = 'm' | 'ft';

export function elevationIn(metres: number, unit: ElevationUnit): number {
  return Math.round(unit === 'ft' ? metres * 3.28084 : metres);
}

// --- Exact sites ---------------------------------------------------------------

export const EXACT_SITES_HOST = 'wildcats.sparcd.arizona.edu';

/**
 * Whether the map may offer exact site points. Ported as-is from the old
 * explorer, which allowed them on one host only. Pending team decision (#434):
 * keep this the single place that decides.
 */
export function canShowExactSites(endpoint: string): boolean {
  const host = endpoint
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .toLowerCase()
    .replace(/\.$/, '');
  return host === EXACT_SITES_HOST;
}
