import { describe, expect, it } from 'vitest';
import { hexCenter, hexRing } from '../../src/data';
import {
  HEX_STEPS,
  boxOf,
  hexStep,
  hexViews,
  hexesInBox,
  shortCount,
  siteRadius,
  siteViews,
  unplacedPhotos,
} from '../../src/lib/mapData';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

// Two cameras in one hex, one far away, and photos with no location.
const model = modelOf(
  collection()
    .upload('u1', {
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: [media('u1', 'a.jpg', 'AA01', '2024-01-01T10:00:00'), media('u1', 'b.jpg', 'AA01', '2024-01-02T10:00:00')],
      observations: [
        observation('u1', 'a.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
        observation('u1', 'a.jpg', 'AA01', '', { common: 'Deer', scientific: 'Odocoileus hemionus' }),
        observation('u1', 'b.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
      ],
    })
    .upload('u2', {
      deployments: [deployment('AA02', 'Alpha two', 12.501, -100.251)],
      media: [media('u2', 'c.jpg', 'AA02', '2024-02-01T10:00:00')],
    })
    .upload('u3', {
      deployments: [deployment('BB01', 'Bravo', 13.5, -101.5)],
      media: [media('u3', 'd.jpg', 'BB01', '2024-03-01T10:00:00')],
      observations: [observation('u3', 'd.jpg', 'BB01', '', { common: 'Deer', scientific: 'Odocoileus hemionus' })],
    })
    .upload('u4', {
      deployments: [deployment('0000', '', null, null)],
      media: [media('u4', 'n1.jpg', '0000', '2024-04-01T10:00:00'), media('u4', 'n2.jpg', '0000', '2024-04-02T10:00:00')],
    }),
);

const hexOfSite = (id: string) => model.sites.find((s) => s.locationId === id)!.hex!;

describe('hexes on the map', () => {
  it('cover every located site and count detections and photos in view', () => {
    const hexes = hexViews(model, filter(model), false);
    expect(hexes).toHaveLength(2);
    const alpha = hexes.find((h) => h.hex === hexOfSite('AA01'))!;
    expect(alpha).toMatchObject({ inView: true, photos: 3, detections: 3 });
    expect(alpha.locations.map((l) => [l.ids, l.photos, l.detections])).toEqual([
      [['AA01'], 2, 3],
      [['AA02'], 1, 0],
    ]);
    expect(alpha.ring).toEqual(hexRing(model.grid, alpha.hex));
    expect(alpha.center).toEqual(hexCenter(model.grid, alpha.hex));
  });

  it('stay on the map when filtered out, with nothing in view', () => {
    const hexes = hexViews(model, filter(model, { locations: ['id:BB01'] }), false);
    expect(hexes.map((h) => [h.inView, h.detections])).toEqual([
      [false, 0],
      [true, 1],
    ]);
  });

  it('keep a place with camera effort in view at 0 detections under a species filter', () => {
    const hexes = hexViews(model, filter(model, { species: ['Lynx rufus'] }), false);
    const bravo = hexes.find((h) => h.hex === hexOfSite('BB01'))!;
    expect(bravo).toMatchObject({ inView: true, photos: 0, detections: 0 });
  });

  it('never place photos with no location, and count them', () => {
    expect(unplacedPhotos(model, filter(model))).toBe(2);
    expect(unplacedPhotos(model, filter(model, { species: ['Lynx rufus'] }))).toBe(0);
  });
});

describe('hex shading', () => {
  it('is 0 for no detections and climbs on a square-root scale to the top step', () => {
    expect(hexStep(0, 100)).toBe(0);
    expect(hexStep(1, 100)).toBe(1);
    expect(hexStep(100, 100)).toBe(HEX_STEPS);
    expect(hexStep(25, 100)).toBe(3);
    const steps = [1, 5, 10, 30, 60, 100].map((n) => hexStep(n, 100));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it('labels big counts short', () => {
    expect(shortCount(987)).toBe('987');
    expect(shortCount(12_345)).toBe('12k');
  });
});

describe('site dots', () => {
  it('sit at the display precision, never more exact', () => {
    const [alpha] = siteViews(model, filter(model), { method: 'round', digits: 2 });
    expect(alpha.position).toEqual({ lat: 12.5, lon: -100.25 });
    const [two] = siteViews(model, filter(model), { method: 'round', digits: 2 }).slice(1);
    expect(two.position).toEqual({ lat: 12.5, lon: -100.25 });
    expect(siteViews(model, filter(model), { method: 'truncate', digits: 0 })[2].position).toEqual({ lat: 13, lon: -101 });
  });

  it('grow with detections', () => {
    expect(siteRadius(0, 10)).toBe(4);
    expect(siteRadius(10, 10)).toBe(14);
    expect(siteRadius(3, 10)).toBeGreaterThan(siteRadius(1, 10));
  });
});

describe('selecting an area by rectangle', () => {
  const hexes = hexViews(model, filter(model), false).map((h) => h.hex);
  const alpha = hexOfSite('AA01');
  const c = hexCenter(model.grid, alpha);

  it('takes the hexes whose centre it covers', () => {
    expect(hexesInBox(model.grid, hexes, boxOf({ lat: c.lat - 0.001, lon: c.lon - 0.001 }, { lat: c.lat + 0.001, lon: c.lon + 0.001 }))).toEqual([
      alpha,
    ]);
  });

  it('takes a hex it only clips at a corner', () => {
    const corner = hexRing(model.grid, alpha)[0];
    const box = boxOf({ lat: corner.lat - 0.0005, lon: corner.lon - 0.0005 }, { lat: corner.lat + 0.0005, lon: corner.lon + 0.0005 });
    expect(hexesInBox(model.grid, hexes, box)).toEqual([alpha]);
  });

  it('takes the hex a small rectangle sits inside without touching its centre or corners', () => {
    const near = { lat: c.lat + 0.01, lon: c.lon + 0.005 };
    expect(hexesInBox(model.grid, hexes, boxOf(near, { lat: near.lat + 0.001, lon: near.lon + 0.001 }))).toEqual([alpha]);
  });

  it('takes nothing from empty ground, and both hexes from a rectangle around them', () => {
    expect(hexesInBox(model.grid, hexes, boxOf({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }))).toEqual([]);
    expect(hexesInBox(model.grid, hexes, boxOf({ lat: 12, lon: -102 }, { lat: 14, lon: -100 })).sort()).toEqual([...hexes].sort());
  });

  it('reads the same whichever way the rectangle was dragged', () => {
    expect(boxOf({ lat: 2, lon: 5 }, { lat: 1, lon: 3 })).toEqual({ south: 1, north: 2, west: 3, east: 5 });
  });
});
