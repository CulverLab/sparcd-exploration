import { describe, it, expect } from 'vitest';
import {
  latLngToUTM,
  metersToFeet,
  formatUTM,
  formatLatLng,
  formatElevation,
  timeZoneForCoords,
} from '../src/lib/coords';

describe('latLngToUTM', () => {
  it('is exact at a central meridian on the equator (zone 31 origin)', () => {
    // On the central meridian, easting is the 500 km false easting; on the
    // equator, northing is 0. A clean base case for the projection math.
    expect(latLngToUTM(0, 3)).toMatchObject({
      zoneNumber: 31,
      zoneLetter: 'N',
      easting: 500000,
      northing: 0,
      hemisphere: 'N',
    });
  });

  it('projects an Arizona test point (zone 12R, northern)', () => {
    const u = latLngToUTM(31.5, -110.2);
    expect(u.zoneNumber).toBe(12);
    expect(u.zoneLetter).toBe('R'); // 24–32°N band
    expect(u.hemisphere).toBe('N');
    expect(u.easting).toBeCloseTo(575973, 0);
    expect(u.northing).toBeCloseTo(3485294, 0);
  });

  it('keeps the zone in 1..60 at the longitude boundaries', () => {
    expect(latLngToUTM(0, -180).zoneNumber).toBe(1);
    expect(latLngToUTM(0, 180).zoneNumber).toBe(60); // not 61
    expect(latLngToUTM(0, 179.9).zoneNumber).toBe(60);
  });

  it('adds the false northing and S band/hemisphere south of the equator', () => {
    const u = latLngToUTM(-34, 18);
    expect(u.zoneNumber).toBe(34);
    expect(u.zoneLetter).toBe('H'); // C..M are southern bands
    expect(u.hemisphere).toBe('S');
    expect(u.northing).toBeGreaterThan(0);
    expect(u.northing).toBeLessThan(10000000); // false northing applied
    expect(u.northing).toBeCloseTo(6233785, 0);
  });
});

describe('elevation + formatters', () => {
  it('converts meters to feet with upstream rounding', () => {
    expect(metersToFeet(1200)).toBe(3937.01);
    expect(metersToFeet(0)).toBe(0);
  });

  it('formats elevation honoring the unit preference', () => {
    expect(formatElevation(1200, 'feet')).toBe('3937.01 ft');
    expect(formatElevation(1200, 'meters')).toBe('1200 m');
    expect(formatElevation(0, 'feet')).toBe('0 ft');
  });

  it('formats lat/lng and UTM as readable strings', () => {
    expect(formatLatLng(31.5, -110.2)).toBe('31.50000, -110.20000');
    expect(formatUTM(31.5, -110.2)).toBe('12R 575973E 3485294N');
  });
});

describe('timeZoneForCoords', () => {
  it('resolves the Educational Test collection point to America/Phoenix', () => {
    expect(timeZoneForCoords(31.5, -110.2)).toBe('America/Phoenix');
  });

  it('resolves a distinct zone for a different continent/region', () => {
    expect(timeZoneForCoords(51.5074, -0.1278)).toBe('Europe/London');
  });
});
