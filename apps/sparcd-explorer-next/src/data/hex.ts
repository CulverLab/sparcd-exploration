// Hex binning, ported from the old explorer: a pointy-top axial grid in
// degrees, with longitude scaled by cos(lat0) so cells read as hexagons at the
// data's latitude. Cell ids are `q:r`, as before.

import type { Position } from './coords';

/** Edge length in degrees of latitude (~3.3 km), comparable to H3 resolution 6. */
export const HEX_SIZE_DEG = 0.03;
const SQRT3 = Math.sqrt(3);

export type HexGrid = { cosLat0: number };

/**
 * The grid for a set of sites. Its reference latitude is the mean over every
 * loaded site, each counted once, never over a filtered set, so a search never
 * moves the grid or regroups sites (#405).
 */
export function hexGrid(sitePositions: Position[]): HexGrid {
  const lat0 = sitePositions.length
    ? sitePositions.reduce((sum, p) => sum + p.lat, 0) / sitePositions.length
    : 0;
  return { cosLat0: Math.cos((lat0 * Math.PI) / 180) || 1 };
}

// Python's round() goes half to even; keeping it keeps cell ids identical.
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function hexOf(grid: HexGrid, pos: Position): string {
  const x = pos.lon * grid.cosLat0;
  const y = pos.lat;
  const xc = ((SQRT3 / 3) * x - y / 3) / HEX_SIZE_DEG;
  const zc = ((2 / 3) * y) / HEX_SIZE_DEG;
  const yc = -xc - zc;
  let [rx, ry, rz] = [roundHalfEven(xc), roundHalfEven(yc), roundHalfEven(zc)];
  const [dx, dy, dz] = [Math.abs(rx - xc), Math.abs(ry - yc), Math.abs(rz - zc)];
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return `${rx}:${rz}`;
}

function axialCenter(id: string): [number, number] {
  const [q, r] = id.split(':').map(Number);
  return [HEX_SIZE_DEG * (SQRT3 * q + (SQRT3 / 2) * r), HEX_SIZE_DEG * 1.5 * r];
}

/** The cell's own centre. The map centres on this, never on a site inside it. */
export function hexCenter(grid: HexGrid, id: string): Position {
  const [x, y] = axialCenter(id);
  return { lat: y, lon: x / grid.cosLat0 };
}

/** The cell outline, closed (seven points). */
export function hexRing(grid: HexGrid, id: string): Position[] {
  const [cx, cy] = axialCenter(id);
  const ring: Position[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    ring.push({ lat: cy + HEX_SIZE_DEG * Math.sin(angle), lon: (cx + HEX_SIZE_DEG * Math.cos(angle)) / grid.cosLat0 });
  }
  ring.push(ring[0]);
  return ring;
}
