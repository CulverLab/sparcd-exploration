// Coordinates: positions, UTM, display precision and elevation units.
// Camera positions are sensitive, so anything shown or exported goes through
// `shownPosition` at the current display settings first.

export type Position = { lat: number; lon: number };

/** What the Display menu sets. */
export type Display = { coords: 'latlon' | 'utm'; precision: Precision; elevation: ElevationUnit };
export type CoordDisplay = Pick<Display, 'coords' | 'precision'>;

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

/** The inverse of `toUtm` (Snyder's series), on the same ellipsoid. */
export function fromUtm(u: Utm): Position {
  const a = 6378137.0;
  const eccSq = 0.00669438;
  const k0 = 0.9996;
  const rad = Math.PI / 180;
  const eccPrimeSq = eccSq / (1 - eccSq);
  const e1 = (1 - Math.sqrt(1 - eccSq)) / (1 + Math.sqrt(1 - eccSq));
  const x = u.easting - 500000;
  const y = u.hemisphere === 'S' ? u.northing - 10000000 : u.northing;
  const mu = y / k0 / (a * (1 - eccSq / 4 - (3 * eccSq ** 2) / 64 - (5 * eccSq ** 3) / 256));
  const phi =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n = a / Math.sqrt(1 - eccSq * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = eccPrimeSq * Math.cos(phi) ** 2;
  const r = (a * (1 - eccSq)) / (1 - eccSq * Math.sin(phi) ** 2) ** 1.5;
  const d = x / (n * k0);
  const lat =
    phi -
    ((n * Math.tan(phi)) / r) *
      (d ** 2 / 2 -
        ((5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * eccPrimeSq) * d ** 4) / 24 +
        ((61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * eccPrimeSq - 3 * c ** 2) * d ** 6) / 720);
  const lon =
    (d - ((1 + 2 * t + c) * d ** 3) / 6 + ((5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * eccPrimeSq + 24 * t ** 2) * d ** 5) / 120) /
    Math.cos(phi);
  return { lat: lat / rad, lon: (u.zone - 1) * 6 - 180 + 3 + lon / rad };
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

/** A position as the page shows it: degrees, and UTM as whole metres (`14N`, `366000`, `1389000`). */
export type Shown = Position & { zone: string; easting: number; northing: number };

/**
 * A camera position exactly as the page shows it at these display settings:
 * the one place every view, map, export and report gets a position from.
 * Lat/long reduces the degrees and works UTM out from them; UTM reduces
 * easting and northing and converts them back to degrees. Either way every
 * coordinate comes from the one reduced position, so two cameras the table
 * shows alike come out alike everywhere.
 */
export function shownPosition(pos: Position, d: CoordDisplay): Shown {
  const metres = (u: Utm) => ({
    zone: `${u.zone}${u.hemisphere}`,
    easting: reduceMetres(u.easting, d.precision),
    northing: reduceMetres(u.northing, d.precision),
  });
  if (d.coords === 'latlon') {
    const lat = reduceDegrees(pos.lat, d.precision);
    const lon = reduceDegrees(pos.lon, d.precision);
    return { lat, lon, ...metres(toUtm(lat, lon)) };
  }
  const u = toUtm(pos.lat, pos.lon);
  const shown = metres(u);
  const back = fromUtm({ ...u, easting: shown.easting, northing: shown.northing });
  // Six decimals (about 0.1 m) is finer than any UTM step, and keeps files tidy.
  return { lat: Number(back.lat.toFixed(6)), lon: Number(back.lon.toFixed(6)), ...shown };
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

// --- Elevation -----------------------------------------------------------------

export type ElevationUnit = 'm' | 'ft';

const FEET_PER_METRE = 3.28084;

export function elevationIn(metres: number, unit: ElevationUnit): number {
  return Math.round(unit === 'ft' ? metres * FEET_PER_METRE : metres);
}

/** The elevation the page shows, back in whole metres, for files that must hold metres. */
export function shownElevationMetres(metres: number, unit: ElevationUnit): number {
  const shown = elevationIn(metres, unit);
  return unit === 'ft' ? Math.round(shown / FEET_PER_METRE) : shown;
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
