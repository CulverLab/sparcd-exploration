import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRECISION,
  EXACT_SITES_HOST,
  canShowExactSites,
  displayPosition,
  elevationIn,
  formatDegrees,
  formatUtm,
  reduceDegrees,
  reduceMetres,
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

  it('formats UTM as plain integers with no separators or decimals', () => {
    const u = formatUtm({ lat: 10.5, lon: -105.25 }, round(null));
    expect(u).toEqual({ zone: '13N', easting: '472644', northing: '1160706' });
    const coarse = formatUtm({ lat: 10.5, lon: -105.25 }, round(2));
    expect(coarse).toEqual({ zone: '13N', easting: '473000', northing: '1161000' });
    for (const v of [u.easting, u.northing, coarse.easting]) expect(v).toMatch(/^\d+$/);
  });

  it('never places a site more exactly than the display precision', () => {
    expect(displayPosition({ lat: 12.34567, lon: -100.98765 }, round(2))).toEqual({ lat: 12.35, lon: -100.99 });
    expect(displayPosition({ lat: 12.34567, lon: -100.98765 }, truncate(1))).toEqual({ lat: 12.3, lon: -100.9 });
  });
});

describe('elevation units', () => {
  it('shows metres or feet as whole numbers', () => {
    expect(elevationIn(1000, 'm')).toBe(1000);
    expect(elevationIn(1000, 'ft')).toBe(3281);
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
