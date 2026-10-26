import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRECISION,
  EXACT_SITES_HOST,
  canShowExactSites,
  elevationIn,
  formatDegrees,
  fromUtm,
  reduceDegrees,
  reduceMetres,
  shownElevationMetres,
  shownPosition,
  sitePosition,
  toUtm,
  type Precision,
} from '../src/data';

const round = (digits: number | null): Precision => ({ method: 'round', digits });
const truncate = (digits: number | null): Precision => ({ method: 'truncate', digits });

describe('sitePosition', () => {
  it('keeps valid coordinates', () => {
    expect(sitePosition(12.5, -100.25)).toEqual({ lat: 12.5, lon: -100.25 });
  });

  it('swaps latitude and longitude written the wrong way round', () => {
    expect(sitePosition(-100.25, 12.5)).toEqual({ lat: 12.5, lon: -100.25 });
  });

  it('has no position for blank, out-of-range or 0,0 coordinates', () => {
    expect(sitePosition(null, -100)).toBeNull();
    expect(sitePosition(12, null)).toBeNull();
    expect(sitePosition(95, 190)).toBeNull();
    expect(sitePosition(0, 0)).toBeNull();
  });
});

describe('toUtm (WGS84)', () => {
  it('puts a point on the equator at a central meridian at 500000 E, 0 N', () => {
    expect(toUtm(0, 3)).toEqual({ zone: 31, hemisphere: 'N', easting: 500000, northing: 0 });
  });

  it('matches the meridian arc at 45°N on a central meridian', () => {
    const u = toUtm(45, 3);
    expect(u.easting).toBeCloseTo(500000, 3);
    expect(u.northing).toBeCloseTo(4982950.4, 1);
  });

  // Reference values from the old explorer's Python formula for synthetic points.
  it.each([
    [10.5, -105.25, 13, 'N', 472643.964, 1160705.970],
    [-20.25, 47.5, 38, 'S', 761161.180, 7758880.369],
    [60.125, 10.75, 32, 'N', 597234.869, 6666620.047],
  ])('converts (%f, %f) like the old explorer', (lat, lon, zone, hemisphere, easting, northing) => {
    const u = toUtm(lat, lon);
    expect(u.zone).toBe(zone);
    expect(u.hemisphere).toBe(hemisphere);
    expect(u.easting).toBeCloseTo(easting, 2);
    expect(u.northing).toBeCloseTo(northing, 2);
  });

  it.each([
    [10.5, -105.25],
    [-20.25, 47.5],
    [60.125, 10.75],
    [12.5649, -100.23456],
  ])('converts (%f, %f) back from UTM to within a centimetre', (lat, lon) => {
    const back = fromUtm(toUtm(lat, lon));
    expect(back.lat).toBeCloseTo(lat, 7);
    expect(back.lon).toBeCloseTo(lon, 7);
  });
});

describe('display precision', () => {
  it('defaults to rounding at 3 decimals', () => {
    expect(DEFAULT_PRECISION).toEqual({ method: 'round', digits: 3 });
  });

  it('rounds or truncates degrees to 0-5 digits, or leaves them exact', () => {
    expect(reduceDegrees(12.34567, round(3))).toBe(12.346);
    expect(reduceDegrees(12.34567, truncate(3))).toBe(12.345);
    expect(reduceDegrees(-100.98765, round(2))).toBe(-100.99);
    expect(reduceDegrees(-100.98765, truncate(2))).toBe(-100.98);
    expect(reduceDegrees(12.34567, round(0))).toBe(12);
    expect(reduceDegrees(12.34567, round(5))).toBe(12.34567);
    expect(reduceDegrees(12.34567, round(null))).toBe(12.34567);
  });

  it('truncates without float slips', () => {
    expect(reduceDegrees(32.123, truncate(3))).toBe(32.123);
    expect(reduceDegrees(0.3, truncate(1))).toBe(0.3);
  });

  it('formats degrees with the chosen number of digits', () => {
    expect(formatDegrees(12.5, round(3))).toBe('12.500');
    expect(formatDegrees(12.5, round(null))).toBe('12.5');
  });

  it('applies the same precision to UTM metres: d digits is 10^(5-d) m', () => {
    expect(reduceMetres(3468629.12, round(3))).toBe(3468600);
    expect(reduceMetres(3468629.12, round(2))).toBe(3469000);
    expect(reduceMetres(3468629.12, truncate(2))).toBe(3468000);
    expect(reduceMetres(3468629.12, round(5))).toBe(3468629);
    expect(reduceMetres(3468629.12, round(0))).toBe(3500000);
    expect(reduceMetres(3468629.12, round(null))).toBe(3468629);
  });

  it('shows UTM as whole metres', () => {
    const u = shownPosition({ lat: 10.5, lon: -105.25 }, { coords: 'utm', precision: round(null) });
    expect([u.zone, u.easting, u.northing]).toEqual(['13N', 472644, 1160706]);
    const coarse = shownPosition({ lat: 10.5, lon: -105.25 }, { coords: 'utm', precision: round(2) });
    expect([coarse.zone, coarse.easting, coarse.northing]).toEqual(['13N', 473000, 1161000]);
  });
});

describe('shownPosition: the one position every view and export uses', () => {
  const latlon = (p: Precision) => ({ coords: 'latlon' as const, precision: p });
  const utm = (p: Precision) => ({ coords: 'utm' as const, precision: p });

  it('in lat/long, reduces the degrees and works UTM out from them', () => {
    const s = shownPosition({ lat: 12.34567, lon: -100.98765 }, latlon(round(2)));
    expect([s.lat, s.lon]).toEqual([12.35, -100.99]);
    const u = toUtm(12.35, -100.99);
    expect([s.zone, s.easting, s.northing]).toEqual([`${u.zone}${u.hemisphere}`, reduceMetres(u.easting, round(2)), reduceMetres(u.northing, round(2))]);
    const t = shownPosition({ lat: 12.34567, lon: -100.98765 }, latlon(truncate(1)));
    expect([t.lat, t.lon]).toEqual([12.3, -100.9]);
  });

  it('in UTM, gives two cameras the table shows alike one position, in degrees too', () => {
    const a = shownPosition({ lat: 12.5649, lon: -100.23456 }, utm(round(2)));
    const b = shownPosition({ lat: 12.5651, lon: -100.23456 }, utm(round(2)));
    expect([a.zone, a.easting, a.northing]).toEqual(['14N', 366000, 1389000]);
    expect(b).toEqual(a);
    // The degrees are the shown UTM position converted back.
    const back = fromUtm({ zone: 14, hemisphere: 'N', easting: 366000, northing: 1389000 });
    expect(a.lat).toBeCloseTo(back.lat, 6);
    expect(a.lon).toBeCloseTo(back.lon, 6);
    // Neither camera's own latitude survives.
    expect([a.lat, b.lat]).not.toContain(12.5649);
  });

  it('in UTM, truncates the metres when the display truncates', () => {
    const s = shownPosition({ lat: 12.5649, lon: -100.23456 }, utm(truncate(2)));
    expect([s.easting, s.northing]).toEqual([365000, 1389000]);
  });

  it('works south of the equator', () => {
    const s = shownPosition({ lat: -20.25, lon: 47.5 }, utm(round(2)));
    expect([s.zone, s.easting, s.northing]).toEqual(['38S', 761000, 7759000]);
    expect(s.lat).toBeLessThan(0);
    expect(toUtm(s.lat, s.lon).northing).toBeCloseTo(7759000, 0);
  });
});

describe('elevation units', () => {
  it('shows metres or feet as whole numbers', () => {
    expect(elevationIn(1000, 'm')).toBe(1000);
    expect(elevationIn(1000, 'ft')).toBe(3281);
  });

  it('gives the elevation shown back in whole metres, for files that hold metres', () => {
    expect(shownElevationMetres(1000.123456, 'm')).toBe(1000);
    expect(shownElevationMetres(1000.6, 'm')).toBe(1001);
    expect(shownElevationMetres(1000.123456, 'ft')).toBe(1000);
  });
});

describe('canShowExactSites (pending team decision #434)', () => {
  it('allows exact sites only on the one host the old explorer allowed', () => {
    expect(canShowExactSites(EXACT_SITES_HOST)).toBe(true);
    expect(canShowExactSites(`https://${EXACT_SITES_HOST.toUpperCase()}/`)).toBe(true);
    expect(canShowExactSites(`${EXACT_SITES_HOST}:9000`)).toBe(true);
  });

  it('refuses every other endpoint', () => {
    expect(canShowExactSites('server.example.org')).toBe(false);
    expect(canShowExactSites('https://server.example.org')).toBe(false);
    expect(canShowExactSites(`${EXACT_SITES_HOST}.example.org`)).toBe(false);
  });
});
