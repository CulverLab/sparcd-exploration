import { describe, expect, it } from 'vitest';
import { locationIdentityKey, parseLocations } from '../src/lib/locations';

describe('redacted location coordinates', () => {
  it('keeps the location selectable by id while preserving name and elevation', () => {
    const result = parseLocations(JSON.stringify([
      { nameProperty: 'Protected site', idProperty: 'SITE-1', latProperty: null, lngProperty: null, elevationProperty: 1200 },
    ]));
    expect(result.skipped).toEqual([]);
    expect(result.locations).toEqual([expect.objectContaining({
      id: 'SITE-1', name: 'Protected site', elevation: 1200, latitude: null, longitude: null,
    })]);
  });

  it('keeps same-id redacted locations distinct by their visible name and elevation', () => {
    const result = parseLocations(JSON.stringify([
      { nameProperty: 'North site', idProperty: 'SAN19', latProperty: null, lngProperty: null, elevationProperty: 1100 },
      { nameProperty: 'South site', idProperty: 'SAN19', latProperty: null, lngProperty: null, elevationProperty: 1300 },
    ]));
    expect(result.skipped).toEqual([]);
    expect(result.locations).toHaveLength(2);
    expect(result.locations[0].key).not.toBe(result.locations[1].key);
    expect(locationIdentityKey('SAN19', 'North site', null, null, 1100)).toBe(result.locations[0].key);
  });
});
