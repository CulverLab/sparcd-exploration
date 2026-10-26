import { describe, expect, it } from 'vitest';
import { HEX_SIZE_DEG, hexCenter, hexGrid, hexOf, hexRing } from '../src/data';

const grid = hexGrid([
  { lat: 10.1, lon: -100.2 },
  { lat: 10.3, lon: -100.4 },
]);

describe('hex grid', () => {
  it('anchors on the mean latitude of the sites', () => {
    expect(grid.cosLat0).toBeCloseTo(Math.cos((10.2 * Math.PI) / 180), 12);
    expect(hexGrid([]).cosLat0).toBe(1);
  });

  it('gives nearby points the same cell and far points another', () => {
    const a = hexOf(grid, { lat: 10.2, lon: -100.3 });
    expect(hexOf(grid, { lat: 10.2001, lon: -100.3001 })).toBe(a);
    expect(hexOf(grid, { lat: 10.4, lon: -100.3 })).not.toBe(a);
    expect(a).toMatch(/^-?\d+:-?\d+$/);
  });

  it('puts the cell centre back in the same cell', () => {
    const id = hexOf(grid, { lat: 10.2, lon: -100.3 });
    expect(hexOf(grid, hexCenter(grid, id))).toBe(id);
  });

  it('draws a closed six-sided ring around the centre', () => {
    const id = hexOf(grid, { lat: 10.2, lon: -100.3 });
    const ring = hexRing(grid, id);
    const c = hexCenter(grid, id);
    expect(ring).toHaveLength(7);
    expect(ring[6]).toEqual(ring[0]);
    for (const p of ring.slice(0, 6)) {
      expect(Math.hypot((p.lon - c.lon) * grid.cosLat0, p.lat - c.lat)).toBeCloseTo(HEX_SIZE_DEG, 12);
    }
  });

  it('keeps a cell id for a site whatever else is filtered', () => {
    // The id depends on the grid and the point only, so it can't move between searches.
    const point = { lat: 10.25, lon: -100.35 };
    expect(hexOf(grid, point)).toBe(hexOf(hexGrid([{ lat: 10.1, lon: -100.2 }, { lat: 10.3, lon: -100.4 }]), point));
  });
});
