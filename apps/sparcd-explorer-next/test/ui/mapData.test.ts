import { describe, expect, it } from 'vitest';
import { NO_FILTERS, applyFilters, displayPosition, hexCenter, hexOf, hexRing, hexSizeFor, siteHexes } from '../../src/data';
import {
  HEX_STEPS,
  areaLocations,
  boxOf,
  hexStep,
  hexViews,
  hexesInBox,
  selectedHexes,
  shortCount,
  siteRadius,
  siteViews,
  sitesInHexes,
  toggleHex,
  unplacedPhotos,
} from '../../src/lib/mapData';
import { cellsOf, collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

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

const cells = cellsOf(model);
const hexOfSite = (id: string) => cells.cells[model.sites.findIndex((s) => s.locationId === id)]!;

describe('hexes on the map', () => {
  it('cover every located site and count detections and photos in view', () => {
    const hexes = hexViews(model, filter(model), false, cells);
    expect(hexes).toHaveLength(2);
    const alpha = hexes.find((h) => h.hex === hexOfSite('AA01'))!;
    expect(alpha).toMatchObject({ inView: true, photos: 3, detections: 3 });
    expect(alpha.locations.map((l) => [l.ids, l.photos, l.detections])).toEqual([
      [['AA01'], 2, 3],
      [['AA02'], 1, 0],
    ]);
    expect(alpha.ring).toEqual(hexRing(cells.grid, alpha.hex));
    expect(alpha.center).toEqual(hexCenter(cells.grid, alpha.hex));
  });

  it('stay on the map when filtered out, with nothing in view', () => {
    const hexes = hexViews(model, filter(model, { locations: ['id:BB01'] }), false, cells);
    expect(hexes.map((h) => [h.inView, h.detections])).toEqual([
      [false, 0],
      [true, 1],
    ]);
  });

  it('keep a place with camera effort in view at 0 detections under a species filter', () => {
    const hexes = hexViews(model, filter(model, { species: ['Lynx rufus'] }), false, cells);
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
  const hexes = hexViews(model, filter(model), false, cells).map((h) => h.hex);
  const alpha = hexOfSite('AA01');
  const c = hexCenter(cells.grid, alpha);

  it('takes the hexes whose centre it covers', () => {
    expect(hexesInBox(cells.grid, hexes, boxOf({ lat: c.lat - 0.001, lon: c.lon - 0.001 }, { lat: c.lat + 0.001, lon: c.lon + 0.001 }))).toEqual([
      alpha,
    ]);
  });

  it('takes a hex it only clips at a corner', () => {
    const corner = hexRing(cells.grid, alpha)[0];
    const box = boxOf({ lat: corner.lat - 0.0005, lon: corner.lon - 0.0005 }, { lat: corner.lat + 0.0005, lon: corner.lon + 0.0005 });
    expect(hexesInBox(cells.grid, hexes, box)).toEqual([alpha]);
  });

  it('takes the hex a small rectangle sits inside without touching its centre or corners', () => {
    const near = { lat: c.lat + 0.01, lon: c.lon + 0.005 };
    expect(hexesInBox(cells.grid, hexes, boxOf(near, { lat: near.lat + 0.001, lon: near.lon + 0.001 }))).toEqual([alpha]);
  });

  it('takes nothing from empty ground, and both hexes from a rectangle around them', () => {
    expect(hexesInBox(cells.grid, hexes, boxOf({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }))).toEqual([]);
    expect(hexesInBox(cells.grid, hexes, boxOf({ lat: 12, lon: -102 }, { lat: 14, lon: -100 })).sort()).toEqual([...hexes].sort());
  });

  it('reads the same whichever way the rectangle was dragged', () => {
    expect(boxOf({ lat: 2, lon: 5 }, { lat: 1, lon: 3 })).toEqual({ south: 1, north: 2, west: 3, east: 5 });
  });
});

describe('the grid at a display precision', () => {
  const at = (digits: number | null) => ({ method: 'round' as const, digits });
  const index = (id: string) => model.sites.findIndex((s) => s.locationId === id);

  it('never draws cells finer than the precision', () => {
    expect(hexSizeFor(at(0))).toBe(1);
    expect(hexSizeFor({ method: 'truncate', digits: 1 })).toBeCloseTo(0.1, 12);
    expect(hexSizeFor(at(2))).toBe(0.03);
    expect(hexSizeFor(at(5))).toBe(0.03);
    expect(hexSizeFor(at(null))).toBe(0.03);
  });

  it('bins the positions the tables show, not the exact ones', () => {
    const p = at(1);
    const grid = siteHexes(model.sites, p);
    expect(grid.grid.size).toBeCloseTo(0.1, 12);
    model.sites.forEach((s, i) => {
      expect(grid.cells[i]).toBe(s.position ? hexOf(grid.grid, displayPosition(s.position, p)) : null);
    });
    // Two cameras that read the same at the precision share a cell.
    expect(grid.cells[index('AA01')]).toBe(grid.cells[index('AA02')]);
  });

  it('keeps the Area filter when the precision changes the grid', () => {
    const fine = siteHexes(model.sites, at(3));
    const area = toggleHex(model, fine, [], fine.cells[index('AA01')]!);
    expect(area.sort()).toEqual([model.sites[index('AA01')].key, model.sites[index('AA02')].key].sort());
    const photos = applyFilters(model, { ...NO_FILTERS, area }).photos;
    expect(photos).toHaveLength(3);

    const coarse = siteHexes(model.sites, at(0));
    expect(coarse.cells[index('AA01')]).not.toBe(fine.cells[index('AA01')]);
    expect([...selectedHexes(model, coarse, area)]).toEqual([coarse.cells[index('AA01')]]);
    expect(areaLocations(model, area, false)).toBe(2);
    // A click on the cell drawn as selected lets go of every site in it.
    expect(toggleHex(model, coarse, area, coarse.cells[index('AA01')]!)).toEqual([]);
  });

  it('a rectangle takes in the sites of the cells it touches', () => {
    const c = hexCenter(cells.grid, hexOfSite('BB01'));
    const picked = hexesInBox(cells.grid, [...new Set(cells.cells.filter(Boolean) as string[])], boxOf(c, { lat: c.lat + 0.001, lon: c.lon + 0.001 }));
    expect(sitesInHexes(model, cells, picked)).toEqual([model.sites[index('BB01')].key]);
  });
});
