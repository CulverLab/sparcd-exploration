// One filter state and one pure function over it. Every view (map, summary,
// effort strip, tables, charts, export) derives from `applyFilters`' result.
//
// Location filters (collections, locations, area, elevation, mountain range)
// test the photo's site; time filters test the photo's camera-local
// timestamp; the species filter tests its detections. An active filter on a
// value a photo lacks (no position, no elevation, no timestamp, no mountain
// range) leaves it out.
//
// The list pickers (collections, species, locations, mountain ranges) start
// with every item ticked. Their state is what is unticked, so an empty list
// is no filter and an item new to the open collections starts ticked.

import { dayNumber } from './time';
import type { Model, Photo, Site } from './model';

export type PhotoTag = 'all' | 'tagged' | 'untagged';

/** A list picker's unticked items. */
export type ListFilter = { hidden: string[] };
/** Unticked species, and whether the "Untagged photos" row is unticked too. */
export type SpeciesFilter = ListFilter & { hideUntagged: boolean };

export type FilterState = {
  /** Collection keys. Applies only while more than one collection is open. */
  collections: ListFilter;
  species: SpeciesFilter;
  /** Site keys of the sites that have photos (`photoSites`). */
  locations: ListFilter;
  /**
   * Site keys the map's hex clicks, rectangles and site clicks took in. Kept
   * as sites, not cells, so it survives a grid change when the display
   * precision changes.
   */
  area: string[];
  /** Inclusive camera-local dates, `YYYY-MM-DD`. */
  dateFrom: string | null;
  dateTo: string | null;
  years: number[];
  months: number[]; // 1-12
  /** Inclusive hours 0-23; `[22, 4]` wraps past midnight. */
  hours: [number, number] | null;
  /** Inclusive metres. */
  elevation: [number, number] | null;
  ranges: ListFilter;
  /** Which photos the Photos view lists. A view setting: counts and Reset ignore it. */
  photoTag: PhotoTag;
  /**
   * Photos whose files aren't in storage: left out (`hide`, the default),
   * counted with the rest (`show`, the Data checks switch), or alone (`only`,
   * a filter). Reset keeps the switch.
   */
  missing: 'hide' | 'show' | 'only';
};

const ALL: ListFilter = { hidden: [] };
const ALL_SPECIES: SpeciesFilter = { hidden: [], hideUntagged: false };

export const NO_FILTERS: FilterState = {
  collections: ALL,
  species: ALL_SPECIES,
  locations: ALL,
  area: [],
  dateFrom: null,
  dateTo: null,
  years: [],
  months: [],
  hours: null,
  elevation: null,
  ranges: ALL,
  photoTag: 'all',
  missing: 'hide',
};

/** The groups a filter button clears with its ×. */
export type FilterDimension = 'collections' | 'species' | 'locations' | 'area' | 'files' | 'dates' | 'elevation' | 'ranges';
/** The filters picked from a list of ticked items. */
export type ListDimension = 'collections' | 'species' | 'locations' | 'ranges';

export function clearFilter(state: FilterState, dimension: FilterDimension): FilterState {
  switch (dimension) {
    case 'collections':
      return { ...state, collections: ALL };
    case 'species':
      return { ...state, species: ALL_SPECIES };
    case 'locations':
      return { ...state, locations: ALL };
    case 'area':
      return { ...state, area: [] };
    case 'files':
      return { ...state, missing: 'show' };
    case 'dates':
      return { ...state, dateFrom: null, dateTo: null, years: [], months: [], hours: null };
    case 'elevation':
      return { ...state, elevation: null };
    case 'ranges':
      return { ...state, ranges: ALL };
  }
}

export function activeFilters(state: FilterState): FilterDimension[] {
  const active: FilterDimension[] = [];
  if (state.collections.hidden.length) active.push('collections');
  if (state.species.hidden.length || state.species.hideUntagged) active.push('species');
  if (state.locations.hidden.length) active.push('locations');
  if (state.area.length) active.push('area');
  if (state.missing === 'only') active.push('files');
  if (state.dateFrom || state.dateTo || state.years.length || state.months.length || state.hours) active.push('dates');
  if (state.elevation) active.push('elevation');
  if (state.ranges.hidden.length) active.push('ranges');
  return active;
}

export const isFiltered = (state: FilterState): boolean => activeFilters(state).length > 0;

/** Clear every filter. `undo` is the state to put back. */
export function resetFilters(state: FilterState): { state: FilterState; undo: FilterState } {
  const missing = state.missing === 'hide' ? 'hide' : 'show';
  return { state: { ...NO_FILTERS, photoTag: state.photoTag, missing }, undo: state };
}

// --- The list pickers ---------------------------------------------------------

const photoSiteCache = new WeakMap<Model, Site[]>();

/** Sites with at least one photo: the items the Locations filter lists. */
export function photoSites(model: Model): Site[] {
  let sites = photoSiteCache.get(model);
  if (!sites) {
    const used = new Uint8Array(model.sites.length);
    for (const p of model.photos) used[p.site] = 1;
    sites = model.sites.filter((_, i) => used[i]);
    photoSiteCache.set(model, sites);
  }
  return sites;
}

/** The keys of every item a list filter can untick. */
export function listKeys(model: Model, dim: ListDimension): string[] {
  switch (dim) {
    case 'collections':
      return model.collections.map((c) => c.key);
    case 'species':
      return model.species.map((s) => s.key);
    case 'locations':
      return photoSites(model).map((s) => s.key);
    case 'ranges':
      return [...new Set(model.sites.map((s) => s.range).filter(Boolean))].sort();
  }
}

/** Tick (`on`) or untick `keys`. */
export function tick<F extends ListFilter>(f: F, keys: string[], on: boolean): F {
  const hidden = new Set(f.hidden);
  for (const k of keys) {
    if (on) hidden.delete(k);
    else hidden.add(k);
  }
  return { ...f, hidden: [...hidden] };
}

/** `keys` ticked and every other item of `all` unticked. */
export function only(all: string[], keys: string[]): ListFilter {
  const keep = new Set(keys);
  return { hidden: all.filter((k) => !keep.has(k)) };
}

/** Tick or untick species, and the "Untagged photos" row with them when `untagged`. */
export function tickSpecies(f: SpeciesFilter, keys: string[], untagged: boolean, on: boolean): SpeciesFilter {
  return { ...tick(f, keys, on), hideUntagged: untagged ? !on : f.hideUntagged };
}

/** Only these species ticked, and "Untagged photos" only when `untagged`. */
export function onlySpecies(model: Model, keys: string[], untagged = false): SpeciesFilter {
  return { ...only(listKeys(model, 'species'), keys), hideUntagged: !untagged };
}

/** Only the sites `keys` name, by site key or by location key. */
export function onlyLocations(model: Model, keys: string[]): ListFilter {
  const keep = new Set(keys);
  return { hidden: photoSites(model).flatMap((s) => (keep.has(s.key) || keep.has(s.groupKey) ? [] : [s.key])) };
}

/** The one species ticked alone, with untagged photos unticked: what a species bar or row picks. */
export function soleSpecies(model: Model, f: SpeciesFilter): string | null {
  if (!f.hideUntagged || f.hidden.length !== model.species.length - 1) return null;
  const off = new Set(f.hidden);
  return model.species.find((s) => !off.has(s.key))?.key ?? null;
}

/** A species alone, or every species again when it already was. */
export function toggleSpecies(model: Model, f: FilterState, key: string): FilterState {
  return { ...f, species: soleSpecies(model, f.species) === key ? ALL_SPECIES : onlySpecies(model, [key]) };
}

/**
 * The list filter that still applies once the items change (other collections,
 * or a refresh). It keeps the side its button named: the ticked items when
 * it listed them ("Species: Bobcat"), so items new here start unticked; else
 * the unticked ones ("all but Ghost"), so new items start ticked. A count
 * ("7 of 13") keeps the smaller side. `dropped` says whether a kept item is gone.
 * When every ticked item it named is gone, the filter goes too, unless
 * `strict`: then nothing is ticked, as Undo puts back what no longer applies.
 */
export function carryList(
  before: string[],
  after: string[],
  hidden: string[],
  strict = false,
): { hidden: string[]; dropped: boolean } {
  if (!hidden.length) return { hidden, dropped: false };
  const now = new Set(after);
  const off = new Set(hidden);
  const ticked = before.filter((k) => !off.has(k));
  const unticked = before.filter((k) => off.has(k));
  if (!ticked.length) return { hidden: after, dropped: false };
  if (ticked.length <= 2 || (unticked.length > 2 && ticked.length <= unticked.length)) {
    const kept = new Set(ticked.filter((k) => now.has(k)));
    return { hidden: kept.size || strict ? after.filter((k) => !kept.has(k)) : [], dropped: kept.size < ticked.length };
  }
  const kept = unticked.filter((k) => now.has(k));
  return { hidden: kept, dropped: kept.length < unticked.length };
}

/**
 * The filters that still apply once the model changes: another set of
 * collections, or a refresh. List filters carry by `carryList`; map-area sites
 * no longer open drop; dates, elevation and the tagged switch carry as they
 * are. `dropped` says whether anything was let go. `strict` keeps what no
 * longer applies, matching nothing, for Undo.
 */
export function carryFilters(
  before: Model,
  after: Model,
  state: FilterState,
  strict = false,
): { state: FilterState; dropped: boolean } {
  let dropped = false;
  const carry = (dim: ListDimension): string[] => {
    const next = carryList(listKeys(before, dim), listKeys(after, dim), state[dim].hidden, strict);
    dropped ||= next.dropped;
    return next.hidden;
  };
  const sites = new Set(after.sites.map((s) => s.key));
  const area = strict ? state.area : state.area.filter((k) => sites.has(k));
  dropped ||= area.length < state.area.length;
  const species = { hidden: carry('species'), hideUntagged: state.species.hideUntagged };
  const locations = { hidden: carry('locations') };
  const ranges = { hidden: carry('ranges') };
  const collections = { hidden: carry('collections') };
  return {
    // A single open collection has no Collections filter.
    state: { ...state, collections: after.collections.length > 1 ? collections : ALL, species, locations, ranges, area },
    dropped,
  };
}

export type FilterResult = {
  /** Photos passing every filter. */
  photos: number[];
  /** Photos with nothing filtered: every one, less those with missing files while they are left out. */
  total: number;
  /** Their detections, less any the species filter hides. */
  detections: number[];
  /** Photos passing every filter but species: camera effort, for active days. */
  effort: number[];
  /** Per site, whether it passes the location filters. */
  sitePass: boolean[];
};

function sitePasses(model: Model, state: FilterState): (site: Site) => boolean {
  const hiddenSet = (f: ListFilter) => (f.hidden.length ? new Set(f.hidden) : null);
  const collections = model.collections.length > 1 ? hiddenSet(state.collections) : null;
  const locations = hiddenSet(state.locations);
  const ranges = hiddenSet(state.ranges);
  const area = state.area.length ? new Set(state.area) : null;
  const { elevation } = state;
  return (site) => {
    if (collections?.has(model.collections[site.collection].key)) return false;
    if (locations?.has(site.key)) return false;
    if (area && !area.has(site.key)) return false;
    if (elevation && (site.elevation === null || site.elevation < elevation[0] || site.elevation > elevation[1])) {
      return false;
    }
    if (ranges && (!site.range || ranges.has(site.range))) return false;
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

/**
 * A photo passes the species filter when it is untagged and "Untagged photos"
 * is ticked, or when at least one of its species is ticked. Its detections
 * keep only the ticked species.
 */
export function applyFilters(model: Model, state: FilterState): FilterResult {
  const sitePass = model.sites.map(sitePasses(model, state));
  const timeOk = timePasses(state);
  const { hidden, hideUntagged } = state.species;
  const off = new Set(hidden);
  const ticked = hidden.length ? model.species.map((s) => !off.has(s.key)) : null;

  const { missing } = state;
  const photos: number[] = [];
  const detections: number[] = [];
  const effort: number[] = [];
  let total = 0;
  const { detections: allDetections } = model;
  for (let i = 0; i < model.photos.length; i++) {
    const p = model.photos[i];
    if (p.missing && missing === 'hide') continue;
    total++;
    if (missing === 'only' && !p.missing) continue;
    if (!sitePass[p.site] || (timeOk && !timeOk(p))) continue;
    effort.push(i);
    const own = p.detections;
    if (!own.length) {
      if (!hideUntagged) photos.push(i);
    } else if (!ticked) {
      photos.push(i);
      for (const d of own) detections.push(d);
    } else {
      const before = detections.length;
      for (const d of own) if (ticked[allDetections[d].species]) detections.push(d);
      if (detections.length > before) photos.push(i);
    }
  }
  return { photos, total, detections, effort, sitePass };
}

/** The photos the Photos view lists for its Tagged / Untagged / All switch. */
export function photosForTag(model: Model, photos: number[], tag: PhotoTag): number[] {
  if (tag === 'all') return photos;
  const tagged = tag === 'tagged';
  return photos.filter((i) => model.photos[i].tagged === tagged);
}

/**
 * A result with the Photos view's tag switch applied: its photos and their
 * detections. Camera effort stays as it is, as it does for a species filter.
 */
export function resultForTag(model: Model, result: FilterResult, tag: PhotoTag): FilterResult {
  if (tag === 'all') return result;
  const photos = photosForTag(model, result.photos, tag);
  const kept = new Set(photos);
  return { ...result, photos, detections: result.detections.filter((d) => kept.has(model.detections[d].photo)) };
}
