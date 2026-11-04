// What the map draws, derived from one filter result like every other view.
// Hexes cover every located site the collections hold, whether or not it is
// in view, so the grid never moves on a filter change; their numbers count
// what is in view. The grid itself follows the display precision.
// "In view" for a place means camera effort in view: at least one photo
// passing every filter but species, as the Locations table lists it.

import {
  hexCenter,
  shownPosition,
  hexRing,
  locationIdOf,
  locationKeyOf,
  type FilterResult,
  type HexGrid,
  type Model,
  type CoordDisplay,
  type Position,
  type SiteHexes,
} from '@/data';

/** A map rectangle in degrees. */
export type Box = { south: number; west: number; north: number; east: number };

type SiteTally = { photos: number; detections: number; effort: boolean };

function tallySites(model: Model, result: FilterResult): SiteTally[] {
  const sites = model.sites.map(() => ({ photos: 0, detections: 0, effort: false }));
  for (const i of result.effort) sites[model.photos[i].site].effort = true;
  for (const i of result.photos) sites[model.photos[i].site].photos++;
  for (const d of result.detections) sites[model.photos[model.detections[d].photo].site].detections++;
  return sites;
}

export type HexLocation = {
  key: string;
  ids: string[];
  name: string;
  photos: number;
  detections: number;
  inView: boolean;
};

export type HexView = {
  hex: string;
  center: Position;
  ring: Position[];
  sites: number[];
  /** Some camera here has photos in view. */
  inView: boolean;
  photos: number;
  detections: number;
  /** The locations inside, by the grouping in force, with their own counts. */
  locations: HexLocation[];
  collections: number[];
};

export function hexViews(model: Model, result: FilterResult, separate: boolean, cells: SiteHexes): HexView[] {
  const tallies = tallySites(model, result);
  const hexes = new Map<string, HexView>();
  model.sites.forEach((site, i) => {
    const id = cells.cells[i];
    if (!id) return;
    let h = hexes.get(id);
    if (!h) {
      h = {
        hex: id,
        center: hexCenter(cells.grid, id),
        ring: hexRing(cells.grid, id),
        sites: [],
        inView: false,
        photos: 0,
        detections: 0,
        locations: [],
        collections: [],
      };
      hexes.set(id, h);
    }
    const t = tallies[i];
    h.sites.push(i);
    h.inView ||= t.effort;
    h.photos += t.photos;
    h.detections += t.detections;
    if (!h.collections.includes(site.collection)) h.collections.push(site.collection);
    const key = locationKeyOf(site, separate);
    let loc = h.locations.find((l) => l.key === key);
    if (!loc) h.locations.push((loc = { key, ids: [], name: site.name, photos: 0, detections: 0, inView: false }));
    const shownId = locationIdOf(site, separate);
    if (!loc.ids.includes(shownId)) loc.ids.push(shownId);
    loc.photos += t.photos;
    loc.detections += t.detections;
    loc.inView ||= t.effort;
  });
  for (const h of hexes.values()) h.locations.sort((a, b) => a.ids[0].localeCompare(b.ids[0], undefined, { numeric: true }));
  return [...hexes.values()];
}

export type SiteView = {
  site: number;
  /** As the tables show it, never more exact. */
  position: Position;
  photos: number;
  detections: number;
  inView: boolean;
};

export function siteViews(model: Model, result: FilterResult, display: CoordDisplay): SiteView[] {
  const tallies = tallySites(model, result);
  return model.sites.flatMap((site, i) => {
    if (!site.position) return [];
    const { lat, lon } = shownPosition(site.position, display);
    return [{ site: i, position: { lat, lon }, ...pick(tallies[i]) }];
  });
}

const pick = (t: SiteTally) => ({ photos: t.photos, detections: t.detections, inView: t.effort });

/** How dark a hex is: 0 for no detections, then 1 to `HEX_STEPS` on a square-root scale. */
export const HEX_STEPS = 5;
export function hexStep(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(HEX_STEPS, Math.max(1, Math.ceil(HEX_STEPS * Math.sqrt(count / max))));
}

/** A site dot's radius in pixels: 4 for none, up to 14 for the most detections. */
export const siteRadius = (detections: number, max: number): number =>
  4 + 10 * Math.sqrt(Math.max(0, detections) / Math.max(1, max));

/** `987`, `12k` */
export const shortCount = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));

const inside = (p: Position, b: Box) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

/**
 * The hexes a dragged rectangle takes in: each whose centre or a corner it
 * covers, and the one its own centre falls in. Only `hexes` (those on the map)
 * can join, and the result is in hexes, never exact positions.
 */
export function hexesInBox(grid: HexGrid, hexes: string[], box: Box): string[] {
  const mid = { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 };
  return hexes.filter((id) => {
    const ring = hexRing(grid, id);
    return inside(hexCenter(grid, id), box) || ring.some((p) => inside(p, box)) || pointInRing(mid, ring);
  });
}

/** The keys of the sites whose dot, drawn at the display precision, a dragged rectangle covers. */
export function sitesInBox(model: Model, display: CoordDisplay, box: Box): string[] {
  return model.sites.flatMap((s) => (s.position && inside(shownPosition(s.position, display), box) ? [s.key] : []));
}

function pointInRing(p: Position, ring: Position[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) hit = !hit;
  }
  return hit;
}

// --- The Area filter ----------------------------------------------------------
// The filter holds site keys, so it means the same places at any precision.
// Hexes are only how the map draws and picks them.

/** The keys of the sites inside some cells. */
export function sitesInHexes(model: Model, cells: SiteHexes, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return model.sites.flatMap((s, i) => (wanted.has(cells.cells[i]!) ? [s.key] : []));
}

/** The cells holding at least one site in the area: what the map draws as selected. */
export function selectedHexes(model: Model, cells: SiteHexes, area: string[]): Set<string> {
  const keys = new Set(area);
  const out = new Set<string>();
  model.sites.forEach((s, i) => {
    const id = cells.cells[i];
    if (id && keys.has(s.key)) out.add(id);
  });
  return out;
}

/**
 * Of these site keys, the ones the map can take in: those with photos under
 * every filter but Map area (`inView`, per site). A place outside the current
 * area counts, so an area can grow.
 */
export function sitesStillInView(model: Model, keys: string[], inView: ArrayLike<number>): string[] {
  const wanted = new Set(keys);
  return model.sites.flatMap((s, i) => (inView[i] && wanted.has(s.key) ? [s.key] : []));
}

/**
 * A hex click: a cell drawn as selected lets all its sites go, any other takes
 * in those still in view. With none, `area` comes back as it is.
 */
export function toggleHex(model: Model, cells: SiteHexes, area: string[], id: string, inView: ArrayLike<number>): string[] {
  const inside = sitesInHexes(model, cells, [id]);
  const keys = new Set(inside);
  if (area.some((k) => keys.has(k))) return area.filter((k) => !keys.has(k));
  const taken = sitesStillInView(model, inside, inView);
  return taken.length ? [...area, ...taken] : area;
}

/** A site click, by the same rules as a hex click. */
export function toggleSite(model: Model, area: string[], site: number, inView: ArrayLike<number>): string[] {
  const { key } = model.sites[site];
  if (area.includes(key)) return area.filter((k) => k !== key);
  return inView[site] ? [...area, key] : area;
}

/** How many of the area's locations are still in view (`inView`, per site), by the grouping in force. */
export function areaLocations(model: Model, area: string[], separate: boolean, inView: ArrayLike<number>): number {
  const keys = new Set(area);
  return new Set(model.sites.filter((s, i) => inView[i] && keys.has(s.key)).map((s) => locationKeyOf(s, separate))).size;
}

/** Two dragged corners as a box, whichever way the drag went. */
export const boxOf = (a: Position, b: Position): Box => ({
  south: Math.min(a.lat, b.lat),
  north: Math.max(a.lat, b.lat),
  west: Math.min(a.lon, b.lon),
  east: Math.max(a.lon, b.lon),
});
