import { describe, expect, it } from 'vitest';
import { parseLocations } from '../src/lib/locations';

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
});
