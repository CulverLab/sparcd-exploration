// Ported from apps/sparcd-explorer/tests/test_hex_grid.py.

import { describe, expect, it } from 'vitest';
import { onlyLocations, type Model } from '../../src/data';
import { binsOf, collection, deployment, filter, media, modelOf } from '../support/fixtures';

function fixture({ alpha = [11.5, -100.03], delta = [12.2, -100.8], extraCharlieUploads = 0 } = {}) {
  const c = collection();
  for (const [upload, site, name, [lat, lon]] of [
    ['u1', 'AAA01', 'Alpha', alpha],
    ['u2', 'BBB01', 'Bravo', [12.0, -100.5]],
    ['u3', 'CCC01', 'Charlie', [13.5, -101.0]],
    ['u4', 'DDD01', 'Delta', delta],
  ] as const) {
    c.upload(upload, { deployments: [deployment(site, name, lat, lon)], media: [media(upload, 'a.jpg', site, '2024-01-01T10:00:00')] });
  }
  for (let i = 0; i < extraCharlieUploads; i++) {
    c.upload(`x${i}`, { deployments: [deployment('CCC01', 'Charlie', 13.5, -101.0)], media: [media(`x${i}`, 'a.jpg', 'CCC01', '2024-01-01T10:00:00')] });
  }
  return modelOf(c);
}

function hexIds(model: Model, locations: string[] = []): Record<string, string> {
  return Object.fromEntries(
    binsOf(model, filter(model, locations.length ? { locations: onlyLocations(model, locations) } : {})).flatMap((b) => b.locationNames.map((name) => [name, b.hex])),
  );
}

describe('test_hex_grid', () => {
  it('a search does not move a site’s hex', () => {
    const model = fixture();
    const alphaOnly = binsOf(model, filter(model, { locations: onlyLocations(model, ['id:AAA01']) }));
    expect(alphaOnly).toHaveLength(1);
    expect(alphaOnly[0].hex).toBe(hexIds(model).Alpha);
  });

  it('the map centre comes from the hex, not the site', () => {
    const centres = [
      [11.5, -100.03],
      [11.5, -100.0305],
    ].map((alpha) => {
      const model = fixture({ alpha });
      const [bin] = binsOf(model, filter(model, { locations: onlyLocations(model, ['id:AAA01']) }));
      return [bin.hex, bin.center.lat.toFixed(9), bin.center.lon.toFixed(9)];
    });
    // Moving the only site a little within its hex leaves the map centre where it was.
    expect(centres[0]).toEqual(centres[1]);
  });

  it('extra uploads at one site do not move the grid', () => {
    expect(hexIds(fixture({ extraCharlieUploads: 4 }))).toEqual(hexIds(fixture()));
  });

  it('swapped coordinates anchor like corrected ones', () => {
    expect(hexIds(fixture({ delta: [-100.8, 12.2] }))).toEqual(hexIds(fixture()));
  });
});
