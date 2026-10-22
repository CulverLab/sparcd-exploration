// Column definitions for the Locations, Species and Photos tables. One
// definition feeds the table cell, its sort and the CSV export, so what is
// exported is what is shown, in the order shown: positions as the table shows
// them, elevation in the chosen unit, common names first.

import {
  checkMoved,
  checkNearDuplicateIds,
  elevationIn,
  formatDegrees,
  localTimeKey,
  locationGroupKey,
  reduceDegrees,
  shownPosition,
  type LocationRow,
  type Model,
  type PhotoRow,
  type Position,
  type Reorder,
  type SpeciesRow,
  type TableOrder,
} from '@/data';
import type { Sorting, TableView } from '@/store';
import { andList, checkKey } from './checkText';
import { loadPrefs, shownColumns } from './columnPrefs';
import { fmtN, formatElevation, formatPosition, type Display } from './format';

export type Cell = string | number | null;

export type Col<R> = {
  id: string;
  label: string;
  /** Shown by default. */
  def: boolean;
  /** Only while several collections are open. */
  multi?: boolean;
  numeric?: boolean;
  mono?: boolean;
  italic?: boolean;
  sortable?: boolean;
  /** Left out of CSV (a drawing, not a value). */
  noExport?: boolean;
  csvLabel?: string;
  title?: string;
  /** Sort key and CSV value. */
  value: (r: R) => Cell;
  /**
   * Each row's place in this column's order, ready made: 0 for empty, then
   * 1, 2, … up to `max`. For a column with a distinct value on nearly every
   * row, ranked once ahead of any sort.
   */
  rank?: () => { of: (r: R) => number; max: number };
  /** Cell text; numbers default to thousands separators. */
  text?: (r: R) => string;
};

export type TableContext = { model: Model; display: Display; totalDetections: number };

export const ACTIVE_DAYS_HELP = 'Days with at least one photo, summed over locations';

// One collator for every comparison: `localeCompare` with options builds a
// new one each call, which took 24 s to sort 500,000 photos.
const natural = new Intl.Collator(undefined, { numeric: true }).compare;

/** Two cells in sort order: empty first, numbers by value, text naturally ("AB2" before "AB10"). */
export function compareCells(x: Cell, y: Cell): number {
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1;
  return typeof x === 'number' && typeof y === 'number' ? x - y : natural(String(x), String(y));
}

/**
 * `rows` ordered by `key` as `compareCells` orders it: empty first going up
 * and last going down, ties kept in their own order either way. Each distinct
 * value is compared once, then rows are dealt into their value's place, so a
 * long list with few distinct values costs little more than one pass.
 */
export function orderBy<R>(rows: R[], key: (r: R) => Cell, desc: boolean): R[] {
  const n = rows.length;
  const values = new Array<Cell>(n);
  let text = false;
  for (let i = 0; i < n; i++) {
    const v = key(rows[i]);
    values[i] = v;
    if (typeof v === 'string') text = true;
  }
  const { rank, ranks } = text ? textRanks(values) : numberRanks(values as (number | null)[]);
  return dealt(rows, rank, ranks, desc);
}

/** `rows` dealt into their rank's place, ties in their own order; 0 first going up and last going down. */
function dealt<R>(rows: R[], rank: ArrayLike<number>, ranks: number, desc: boolean): R[] {
  const n = rows.length;
  const count = new Uint32Array(ranks + 1);
  for (let i = 0; i < n; i++) count[rank[i]]++;
  const next = new Uint32Array(ranks + 1);
  for (let r = desc ? ranks : 0, at = 0; desc ? r >= 0 : r <= ranks; r += desc ? -1 : 1) {
    next[r] = at;
    at += count[r];
  }
  const out = new Array<R>(n);
  for (let i = 0; i < n; i++) out[next[rank[i]]++] = rows[i];
  return out;
}

/** Each value's place among the distinct values, from 1; empty is 0. Values that compare equal share a place. */
function textRanks(values: Cell[]): { rank: Uint32Array; ranks: number } {
  const rankOf = new Map<string, number>();
  const distinct: string[] = [];
  for (const v of values) {
    if (v === null) continue;
    const k = String(v);
    if (!rankOf.has(k)) {
      rankOf.set(k, 0);
      distinct.push(k);
    }
  }
  distinct.sort(natural);
  let ranks = 0;
  distinct.forEach((k, j) => {
    if (j === 0 || natural(distinct[j - 1], k) !== 0) ranks++;
    rankOf.set(k, ranks);
  });
  const rank = new Uint32Array(values.length);
  values.forEach((v, i) => (rank[i] = v === null ? 0 : rankOf.get(String(v))!));
  return { rank, ranks };
}

/** As `textRanks`, for numbers: a native sort of the distinct values, then a binary search per row. */
export function numberRanks(values: (number | null)[]): { rank: Uint32Array; ranks: number } {
  const sorted = Float64Array.from(values.filter((v): v is number => v !== null)).sort();
  let ranks = 0;
  for (let j = 0; j < sorted.length; j++) if (j === 0 || sorted[j] !== sorted[ranks - 1]) sorted[ranks++] = sorted[j];
  const rank = new Uint32Array(values.length);
  values.forEach((v, i) => {
    if (v === null) return;
    let lo = 0;
    let hi = ranks - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    rank[i] = lo + 1;
  });
  return { rank, ranks };
}

// The last orders of a set of rows, so the grid, the list, the detail view and
// the download all share one sort, and a view switched back to costs nothing.
const orders = new WeakMap<object, WeakMap<object, [unknown[]?, unknown[]?]>>();

/**
 * Rows in a table's order: by the sorted column, ties kept in their own
 * order. The Photos grid, list and detail view all walk this one order.
 */
export function sortRows<R>(rows: R[], cols: Col<R>[], sorting: { id: string; desc: boolean }[]): R[] {
  const col = sorting[0] && cols.find((c) => c.id === sorting[0].id);
  if (!col || col.sortable === false) return rows;
  const desc = sorting[0].desc;
  let byCol = orders.get(rows);
  if (!byCol) orders.set(rows, (byCol = new WeakMap()));
  let both = byCol.get(col);
  if (!both) byCol.set(col, (both = []));
  const i = desc ? 1 : 0;
  if (!both[i]) {
    const ready = col.rank?.();
    both[i] = ready ? dealt(rows, Uint32Array.from(rows, ready.of), ready.max, desc) : orderBy(rows, col.value, desc);
  }
  return both[i] as R[];
}

const timeRanks = new WeakMap<Model, Uint32Array>();

/**
 * Each photo's place in time order across the model, as the Date and time
 * column sorts its text: ranked once per model, so sorting any set of photos
 * by time is one pass. 0 for a timestamp that isn't a date and time, which
 * sorts with the empty ones.
 */
export function photoTimeRanks(model: Model): Uint32Array {
  let ranks = timeRanks.get(model);
  if (!ranks) timeRanks.set(model, (ranks = numberRanks(model.photos.map((p) => p.timeKey)).rank));
  return ranks;
}

/** A photo timestamp's sort key: the shared camera-clock parser's, so sorting and filtering agree on what is a date. */
export function timeKey(time: string): number | null {
  return localTimeKey(time);
}

/**
 * Each table's rows in the order the page lists them: by its sort over the
 * columns it shows, for the downloads and the report to follow.
 */
export function tableOrder(ctx: TableContext, sorting: Record<TableView, Sorting>, multi: boolean): TableOrder {
  const by = <R>(view: TableView, defs: Col<R>[]): Reorder<R> => {
    const shown = new Set(shownColumns(loadPrefs(view, defs), defs, multi));
    const cols = defs.filter((c) => shown.has(c.id));
    return (rows) => sortRows(rows, cols, sorting[view]);
  };
  return {
    locations: by('locations', locationColumns(ctx)),
    species: by('species', speciesColumns(ctx)),
    photos: by('photos', photoColumns(ctx)),
  };
}

export const cellText = <R>(c: Col<R>, r: R): string => {
  if (c.text) return c.text(r);
  const v = c.value(r);
  return v === null || v === '' ? '—' : typeof v === 'number' ? fmtN(v) : v;
};

/** Latitude, longitude, UTM zone, easting and northing, all from the position as shown. */
function positionColumns<R>(pos: (r: R) => Position | null, d: Display): Col<R>[] {
  const shown = (r: R) => {
    const p = pos(r);
    return p && shownPosition(p, d);
  };
  const degrees = (axis: 'lat' | 'lon'): Col<R> => ({
    id: axis,
    label: axis === 'lat' ? 'Latitude' : 'Longitude',
    def: false,
    mono: true,
    value: (r) => {
      const s = shown(r);
      return s && reduceDegrees(s[axis], d.precision);
    },
    text: (r) => {
      const s = shown(r);
      return s ? formatDegrees(s[axis], d.precision) : '—';
    },
  });
  const metres = (part: 'easting' | 'northing'): Col<R> => ({
    id: part,
    label: part === 'easting' ? 'Easting' : 'Northing',
    def: false,
    mono: true,
    value: (r) => shown(r)?.[part] ?? null,
    text: (r) => String(shown(r)?.[part] ?? '—'),
  });
  return [
    degrees('lat'),
    degrees('lon'),
    metres('easting'),
    metres('northing'),
    { id: 'zone', label: 'UTM zone', def: false, mono: true, value: (r) => shown(r)?.zone ?? null },
  ];
}

const coordinatesColumn = <R>(pos: (r: R) => Position | null, d: Display, def: boolean): Col<R> => ({
  id: 'coords',
  label: 'Coordinates',
  def,
  mono: true,
  value: (r) => {
    const p = pos(r);
    return p && shownPosition(p, d).lat;
  },
  text: (r) => formatPosition(pos(r), d),
});

const elevationColumn = <R>(metres: (r: R) => number | null, d: Display, def: boolean): Col<R> => ({
  id: 'elev',
  label: 'Elevation',
  csvLabel: `Elevation (${d.elevation})`,
  def,
  numeric: true,
  value: (r) => {
    const m = metres(r);
    return m === null ? null : elevationIn(m, d.elevation);
  },
  text: (r) => formatElevation(metres(r), d.elevation),
});

const collectionNames = (model: Model, collections: number[]) => collections.map((c) => model.collections[c].name);

export function locationColumns({ model, display }: TableContext): Col<LocationRow>[] {
  const pos = (r: LocationRow) => r.position;
  return [
    { id: 'name', label: 'Location', def: true, value: (r) => (r.noLocation ? 'No location set' : r.name || null) },
    { id: 'id', label: 'Location ID', def: true, mono: true, value: (r) => r.ids.join(', ') },
    {
      id: 'coll',
      label: 'Collection',
      def: true,
      multi: true,
      value: (r) => (r.collections.length > 1 ? `${r.collections.length} collections` : collectionNames(model, r.collections)[0]),
    },
    { id: 'activity', label: 'Activity', def: true, sortable: false, noExport: true, value: () => null },
    { id: 'range', label: 'Mountain range', def: true, value: (r) => r.range || null },
    coordinatesColumn(pos, display, true),
    elevationColumn((r) => r.elevation, display, true),
    { id: 'photos', label: 'Photos', def: true, numeric: true, value: (r) => r.photos },
    { id: 'tagged', label: 'Tagged', def: false, numeric: true, value: (r) => r.tagged },
    { id: 'untagged', label: 'Untagged', def: false, numeric: true, value: (r) => r.photos - r.tagged },
    { id: 'dets', label: 'Detections', def: true, numeric: true, value: (r) => r.detections },
    { id: 'species', label: 'Species', def: true, numeric: true, value: (r) => r.species },
    { id: 'first', label: 'First photo', def: true, mono: true, value: (r) => r.firstDate },
    { id: 'last', label: 'Last photo', def: true, mono: true, value: (r) => r.lastDate },
    { id: 'days', label: 'Active days', def: true, numeric: true, title: ACTIVE_DAYS_HELP, value: (r) => r.activeDays },
    ...positionColumns(pos, display),
    { id: 'sites', label: 'Camera positions', def: false, numeric: true, value: (r) => r.sites.length },
  ];
}

export function speciesColumns({ model, totalDetections }: TableContext): Col<SpeciesRow>[] {
  const sp = (r: SpeciesRow) => model.species[r.species];
  return [
    { id: 'common', label: 'Common name', def: true, value: (r) => sp(r).name },
    { id: 'sci', label: 'Scientific name', def: true, italic: true, value: (r) => sp(r).scientificName || null },
    { id: 'dets', label: 'Detections', def: true, numeric: true, value: (r) => r.detections },
    { id: 'animals', label: 'Animals counted', def: true, numeric: true, value: (r) => r.animals },
    { id: 'locs', label: 'Locations', def: true, numeric: true, value: (r) => r.locations },
    { id: 'photos', label: 'Photos', def: false, numeric: true, value: (r) => r.photos },
    { id: 'first', label: 'First seen', def: true, mono: true, value: (r) => r.firstDate },
    { id: 'last', label: 'Last seen', def: true, mono: true, value: (r) => r.lastDate },
    {
      id: 'share',
      label: 'Share of detections',
      def: false,
      numeric: true,
      value: (r) => Math.round((r.detections / Math.max(1, totalDetections)) * 1000) / 10,
      text: (r) => `${(Math.round((r.detections / Math.max(1, totalDetections)) * 1000) / 10).toFixed(1)}%`,
    },
  ];
}

export function photoColumns({ model, display }: TableContext): Col<PhotoRow>[] {
  const site = (r: PhotoRow) => model.sites[model.photos[r.photo].site];
  const pos = (r: PhotoRow) => site(r).position;
  return [
    {
      id: 'time',
      label: 'Date and time',
      def: true,
      mono: true,
      value: (r) => r.time || null,
      rank: () => {
        const ranks = photoTimeRanks(model);
        return { of: (r) => ranks[r.photo], max: model.photos.length };
      },
    },
    { id: 'species', label: 'Species', def: true, value: (r) => r.species || null, text: (r) => r.species || 'Untagged' },
    { id: 'count', label: 'Count', def: true, numeric: true, value: (r) => (r.tagged ? r.count : null) },
    { id: 'location', label: 'Location', def: true, value: (r) => (site(r).noLocation ? 'No location set' : r.locationName || null) },
    { id: 'coll', label: 'Collection', def: true, multi: true, value: (r) => r.collection },
    { id: 'tagged', label: 'Tagged', def: true, value: (r) => (r.tagged ? 'Yes' : 'No') },
    { id: 'sci', label: 'Scientific name', def: false, italic: true, value: (r) => r.scientificNames || null },
    { id: 'locId', label: 'Location ID', def: false, mono: true, value: (r) => r.locationId || null },
    coordinatesColumn(pos, display, false),
    elevationColumn((r) => site(r).elevation, display, false),
    ...positionColumns(pos, display),
    { id: 'range', label: 'Mountain range', def: false, value: (r) => site(r).range || null },
    { id: 'upload', label: 'Upload', def: false, mono: true, value: (r) => model.uploads[model.photos[r.photo].upload].stamp },
    { id: 'file', label: 'File name', def: false, mono: true, value: (r) => r.fileName },
    { id: 'type', label: 'Media type', def: false, mono: true, value: (r) => model.photos[r.photo].mimeType || null },
  ];
}

/** A short warning after a location's name: its word, what it means in plain words, and the data check it comes from. */
export type Flag = { label: string; tip: string; check: string };

/** The warnings shown after a location's name, from the data checks. */
export function locationFlagger(model: Model): (row: LocationRow) => Flag[] {
  // By location, so a row finds its checks whichever spelling it shows.
  const moved = new Map(checkMoved(model).map((m) => [locationGroupKey(m.locationId), m]));
  const similar = new Map(checkNearDuplicateIds(model).flatMap((c) => c.ids.map((id) => [locationGroupKey(id), c] as const)));
  return (row) => {
    const flags: Flag[] = [];
    if (row.noLocation) {
      flags.push({ label: 'no location', tip: "These photos have no location ID (0000), so they can't go on the map.", check: 'no-location' });
    }
    const m = row.ids.map((id) => moved.get(locationGroupKey(id))).find(Boolean);
    if (m) {
      flags.push({
        label: 'moved',
        tip: `This location has ${m.pairs} positions in the data, so the camera was probably moved.`,
        check: checkKey(m)!,
      });
    }
    const s = row.ids.map((id) => similar.get(locationGroupKey(id))).find(Boolean);
    if (s) flags.push({ label: 'similar ID', tip: `${andList(s.ids)} look like the same location.`, check: checkKey(s)! });
    return flags;
  };
}
