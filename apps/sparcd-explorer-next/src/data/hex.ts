// Hex binning, ported from the old explorer: a pointy-top axial grid in
// degrees, with longitude scaled by cos(lat0) so cells read as hexagons at the
// data's latitude. Cell ids are `q:r`, as before.

import { displayPosition, type Position, type Precision } from './coords';
import type { Site } from './model';

/** The smallest cell: edge length in degrees of latitude (~3.3 km), comparable to H3 resolution 6. */
export const HEX_SIZE_DEG = 0.03;
const SQRT3 = Math.sqrt(3);

export type HexGrid = { cosLat0: number; size: number };

/**
 * The cell size for a display precision, so the map never shows more than the
 * tables do: 1° at 0 decimals, 0.1° at 1, and the 0.03° floor at 2 or more or
 * exact.
 */
export function hexSizeFor(p: Precision): number {
  return p.digits === null ? HEX_SIZE_DEG : Math.max(HEX_SIZE_DEG, 10 ** -p.digits);
}

/**
 * The grid for a set of sites. Its reference latitude is the mean over every
 * loaded site, each counted once, never over a filtered set, so a search never
 * moves the grid or regroups sites (#405).
 */
export function hexGrid(sitePositions: Position[], size = HEX_SIZE_DEG): HexGrid {
  const lat0 = sitePositions.length
    ? sitePositions.reduce((sum, p) => sum + p.lat, 0) / sitePositions.length
    : 0;
  return { cosLat0: Math.cos((lat0 * Math.PI) / 180) || 1, size };
}

// Python's round() goes half to even; keeping it keeps cell ids identical.
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function hexOf(grid: HexGrid, pos: Position): string {
  const x = pos.lon * grid.cosLat0;
  const y = pos.lat;
  const xc = ((SQRT3 / 3) * x - y / 3) / grid.size;
  const zc = ((2 / 3) * y) / grid.size;
  const yc = -xc - zc;
  let [rx, ry, rz] = [roundHalfEven(xc), roundHalfEven(yc), roundHalfEven(zc)];
  const [dx, dy, dz] = [Math.abs(rx - xc), Math.abs(ry - yc), Math.abs(rz - zc)];
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return `${rx}:${rz}`;
}

function axialCenter(grid: HexGrid, id: string): [number, number] {
  const [q, r] = id.split(':').map(Number);
  return [grid.size * (SQRT3 * q + (SQRT3 / 2) * r), grid.size * 1.5 * r];
}

/** The cell's own centre. The map centres on this, never on a site inside it. */
export function hexCenter(grid: HexGrid, id: string): Position {
  const [x, y] = axialCenter(grid, id);
  return { lat: y, lon: x / grid.cosLat0 };
}

/** The cell outline, closed (seven points). */
export function hexRing(grid: HexGrid, id: string): Position[] {
  const [cx, cy] = axialCenter(grid, id);
  const ring: Position[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    ring.push({ lat: cy + grid.size * Math.sin(angle), lon: (cx + grid.size * Math.cos(angle)) / grid.cosLat0 });
  }
  ring.push(ring[0]);
  return ring;
}

/** Every site's cell at one display precision. */
export type SiteHexes = {
  grid: HexGrid;
  /** Per site, its cell; null for a site with no position. */
  cells: (string | null)[];
};

/**
 * The grid and cells at a display precision: positions are reduced to the
 * precision first and the cell size follows it, so the map is never more exact
 * than the tables. Each site position anchors the grid once, however many
 * uploads it has.
 */
export function siteHexes(sites: Site[], precision: Precision): SiteHexes {
  const shown = sites.map((s) => (s.position ? displayPosition(s.position, precision) : null));
  const anchors = new Map<string, Position>();
  sites.forEach((s, i) => {
    const p = shown[i];
    if (p) anchors.set(`${s.locationId}|${p.lat},${p.lon}`, p);
  });
  const grid = hexGrid([...anchors.values()], hexSizeFor(precision));
  return { grid, cells: shown.map((p) => (p ? hexOf(grid, p) : null)) };
}
