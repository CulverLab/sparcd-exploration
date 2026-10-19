// Column definitions for the Locations, Species and Photos tables. One
// definition feeds the table cell, its sort and the CSV export, so what is
// exported is what is shown, in the order shown: positions as the table shows
// them, elevation in the chosen unit, common names first.

import {
  checkMoved,
  checkNearDuplicateIds,
  elevationIn,
  formatDegrees,
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
  /** Cell text; numbers default to thousands separators. */
  text?: (r: R) => string;
};

export type TableContext = { model: Model; display: Display; totalDetections: number };

export const ACTIVE_DAYS_HELP = 'Days with at least one photo, summed over locations';

/** Two cells in sort order: empty first, numbers by value, text naturally ("AB2" before "AB10"). */
export function compareCells(x: Cell, y: Cell): number {
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1;
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
}

/**
 * Rows in a table's order: by the sorted column, ties kept in their own
 * order. The Photos grid, list and detail view all walk this one order.
 */
export function sortRows<R>(rows: R[], cols: Col<R>[], sorting: { id: string; desc: boolean }[]): R[] {
  const col = sorting[0] && cols.find((c) => c.id === sorting[0].id);
  if (!col || col.sortable === false) return rows;
  const dir = sorting[0].desc ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i, v: col.value(r) }))
    .sort((a, b) => dir * compareCells(a.v, b.v) || a.i - b.i)
    .map((x) => x.r);
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
    { id: 'time', label: 'Date and time', def: true, mono: true, value: (r) => r.time || null },
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

/** Short warnings shown after a location's name, from the data checks. */
export function locationFlagger(model: Model): (row: LocationRow) => string[] {
  const moved = new Set(checkMoved(model).map((m) => m.locationId));
  const similar = new Set(checkNearDuplicateIds(model).flatMap((c) => c.ids));
  return (row) => {
    const flags: string[] = [];
    if (row.noLocation) flags.push('no location');
    if (row.ids.some((id) => moved.has(id))) flags.push('moved');
    if (row.ids.some((id) => similar.has(id))) flags.push('similar ID');
    if (row.collections.length > 1) flags.push(`in ${row.collections.length} collections`);
    return flags;
  };
}
