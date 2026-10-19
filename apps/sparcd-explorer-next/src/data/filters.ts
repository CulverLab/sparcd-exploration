// One filter state and one pure function over it. Every view (map, summary,
// effort strip, tables, charts, export) derives from `applyFilters`' result.
//
// Location filters (collections, locations, area, elevation, mountain range)
// test the photo's site; time filters test the photo's camera-local
// timestamp; the species filter tests its detections. An active filter on a
// value a photo lacks (no position, no elevation, no timestamp) leaves it out.

import { dayNumber } from './time';
import type { Model, Photo, Site } from './model';

/** A map rectangle in degrees. */
export type Box = { south: number; west: number; north: number; east: number };

export type PhotoTag = 'all' | 'tagged' | 'untagged';

export type FilterState = {
  /** Collection keys. Applies only while more than one collection is open. */
  collections: string[];
  /** Species keys, shown alone (`only`) or hidden (`hide`). */
  species: string[];
  speciesMode: 'only' | 'hide';
  /** Location keys (grouped or separate) or site keys; a photo matching either passes. */
  locations: string[];
  area: { hexes: string[]; boxes: Box[] };
  /** Inclusive camera-local dates, `YYYY-MM-DD`. */
  dateFrom: string | null;
  dateTo: string | null;
  years: number[];
  months: number[]; // 1-12
  /** Inclusive hours 0-23; `[22, 4]` wraps past midnight. */
  hours: [number, number] | null;
  /** Inclusive metres. */
  elevation: [number, number] | null;
  ranges: string[];
  /** Which photos the Photos view lists. A view setting: counts and Reset ignore it. */
  photoTag: PhotoTag;
};

export const NO_FILTERS: FilterState = {
  collections: [],
  species: [],
  speciesMode: 'only',
  locations: [],
  area: { hexes: [], boxes: [] },
  dateFrom: null,
  dateTo: null,
  years: [],
  months: [],
  hours: null,
  elevation: null,
  ranges: [],
  photoTag: 'all',
};

/** The groups a filter button clears with its ×. */
export type FilterDimension = 'collections' | 'species' | 'locations' | 'area' | 'dates' | 'elevation' | 'ranges';

export function clearFilter(state: FilterState, dimension: FilterDimension): FilterState {
  switch (dimension) {
    case 'collections':
      return { ...state, collections: [] };
    case 'species':
      return { ...state, species: [], speciesMode: 'only' };
    case 'locations':
      return { ...state, locations: [] };
    case 'area':
      return { ...state, area: NO_FILTERS.area };
    case 'dates':
      return { ...state, dateFrom: null, dateTo: null, years: [], months: [], hours: null };
    case 'elevation':
      return { ...state, elevation: null };
    case 'ranges':
      return { ...state, ranges: [] };
  }
}

export function activeFilters(state: FilterState): FilterDimension[] {
  const active: FilterDimension[] = [];
  if (state.collections.length) active.push('collections');
  if (state.species.length) active.push('species');
  if (state.locations.length) active.push('locations');
  if (state.area.hexes.length || state.area.boxes.length) active.push('area');
  if (state.dateFrom || state.dateTo || state.years.length || state.months.length || state.hours) active.push('dates');
  if (state.elevation) active.push('elevation');
  if (state.ranges.length) active.push('ranges');
  return active;
}

export const isFiltered = (state: FilterState): boolean => activeFilters(state).length > 0;

/** Clear every filter. `undo` is the state to put back. */
export function resetFilters(state: FilterState): { state: FilterState; undo: FilterState } {
  return { state: { ...NO_FILTERS, photoTag: state.photoTag }, undo: state };
}

export type FilterResult = {
  /** Photos passing every filter. */
  photos: number[];
  /** Their detections, less any the species filter hides. */
  detections: number[];
  /** Photos passing every filter but species: camera effort, for active days. */
  effort: number[];
  /** Per site, whether it passes the location filters. */
  sitePass: boolean[];
};

function sitePasses(model: Model, state: FilterState): (site: Site) => boolean {
  const collections = model.collections.length > 1 && state.collections.length ? new Set(state.collections) : null;
  const locations = state.locations.length ? new Set(state.locations) : null;
  const hexes = new Set(state.area.hexes);
  const { boxes } = state.area;
  const area = hexes.size > 0 || boxes.length > 0;
  const ranges = state.ranges.length ? new Set(state.ranges) : null;
  const { elevation } = state;
  return (site) => {
    if (collections && !collections.has(model.collections[site.collection].key)) return false;
    if (locations && !locations.has(site.key) && !locations.has(site.groupKey)) return false;
    if (area) {
      const pos = site.position;
      if (!pos) return false;
      const inBox = boxes.some((b) => pos.lat >= b.south && pos.lat <= b.north && pos.lon >= b.west && pos.lon <= b.east);
      if (!inBox && !hexes.has(site.hex!)) return false;
    }
    if (elevation && (site.elevation === null || site.elevation < elevation[0] || site.elevation > elevation[1])) {
      return false;
    }
    if (ranges && !ranges.has(site.range)) return false;
    return true;
  };
}

function timePasses(state: FilterState): ((photo: Photo) => boolean) | null {
  const from = state.dateFrom ? dayNumber(state.dateFrom) : null;
  const to = state.dateTo ? dayNumber(state.dateTo) : null;
  const years = state.years.length ? new Set(state.years) : null;
  const months = state.months.length ? new Set(state.months) : null;
  const { hours } = state;
  if (from === null && to === null && !years && !months && !hours) return null;
  return (p) => {
    if (p.day === null) return false;
    if (from !== null && p.day < from) return false;
    if (to !== null && p.day > to) return false;
    if (years && !years.has(p.year!)) return false;
    if (months && !months.has(p.month!)) return false;
    if (hours) {
      if (p.hour === null) return false;
      const [h0, h1] = hours;
      if (h0 <= h1 ? p.hour < h0 || p.hour > h1 : p.hour < h0 && p.hour > h1) return false;
    }
    return true;
  };
}

export function applyFilters(model: Model, state: FilterState): FilterResult {
  const sitePass = model.sites.map(sitePasses(model, state));
  const timeOk = timePasses(state);
  const chosen = new Set(state.species);
  const speciesSet = chosen.size ? model.species.map((s) => chosen.has(s.key)) : null;
  const only = state.speciesMode === 'only';

  const photos: number[] = [];
  const detections: number[] = [];
  const effort: number[] = [];
  const { detections: allDetections } = model;
  for (let i = 0; i < model.photos.length; i++) {
    const p = model.photos[i];
    if (!sitePass[p.site] || (timeOk && !timeOk(p))) continue;
    effort.push(i);
    if (!speciesSet) {
      photos.push(i);
      for (const d of p.detections) detections.push(d);
      continue;
    }
    // Show-only keeps a photo with a chosen species; hide drops a tagged
    // photo whose every species is hidden. Untagged photos pass a hide.
    const before = detections.length;
    for (const d of p.detections) if (speciesSet[allDetections[d].species] === only) detections.push(d);
    const kept = detections.length - before;
    if (only ? kept === 0 : kept === 0 && p.detections.length > 0) continue;
    photos.push(i);
  }
  return { photos, detections, effort, sitePass };
}

/** The photos the Photos view lists for its Tagged / Untagged / All switch. */
export function photosForTag(model: Model, photos: number[], tag: PhotoTag): number[] {
  if (tag === 'all') return photos;
  const tagged = tag === 'tagged';
  return photos.filter((i) => model.photos[i].tagged === tagged);
}
