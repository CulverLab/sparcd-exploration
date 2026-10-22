// Reports and exports as plain tables, each built from the one filter result
// every view reads, so a download holds what the page shows, in the order the
// page lists it. Positions are the ones the page shows: no export is more
// exact than the page.

import { elevationIn, shownPosition, type Display, type Position } from './coords';
import type { FilterResult } from './filters';
import { locationKeyOf, type Model } from './model';
import { slug } from './slug';
import {
  detectionRows,
  locationRows,
  photoRows,
  speciesRows,
  summarize,
  type LocationRow,
  type PhotoRow,
  type SpeciesRow,
} from './views';

export type ExportCell = string | number | null;

/** One sheet of a workbook, or one CSV file: a header and rows of cells. */
export type Table = { name: string; columns: string[]; rows: ExportCell[][] };

/** Rows put in the order a table on the page lists them. */
export type Reorder<R> = (rows: R[]) => R[];

/** The order of each table on the page, so a download lists rows as the page does. */
export type TableOrder = { locations: Reorder<LocationRow>; species: Reorder<SpeciesRow>; photos: Reorder<PhotoRow> };

export type ExportOptions = Display & {
  /** "Show each location ID separately". */
  separate: boolean;
  /** The page's order; each table's own order when left out. */
  order?: TableOrder;
};

/** What a report says about itself, in the caller's words. */
export type ReportFacts = {
  collections: string;
  filters: string;
  prepared: string;
  preparedBy: string;
  coordinates: string;
};

// --- Cells ---------------------------------------------------------------------

const positionColumns = (o: ExportOptions): string[] =>
  o.coords === 'utm' ? ['UTM zone', 'Easting', 'Northing'] : ['Latitude', 'Longitude'];

/** A position as the page shows it, as numbers: degrees, or UTM as whole metres. */
function positionCells(pos: Position | null, o: ExportOptions): ExportCell[] {
  if (!pos) return o.coords === 'utm' ? [null, null, null] : [null, null];
  const s = shownPosition(pos, o);
  return o.coords === 'utm' ? [s.zone, s.easting, s.northing] : [s.lat, s.lon];
}

const elevationColumn = (o: ExportOptions) => `Elevation (${o.elevation})`;
const elevationCell = (metres: number | null, o: ExportOptions): ExportCell => (metres === null ? null : elevationIn(metres, o.elevation));

const multi = (model: Model) => model.collections.length > 1;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const collectionNames = (model: Model, collections: number[]) => collections.map((c) => model.collections[c].name).join('; ');

// --- Tables --------------------------------------------------------------------

/** Locations by ID, "No location set" last. */
export function sortedLocations(model: Model, rows: LocationRow[]): LocationRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.noLocation) - Number(b.noLocation) ||
      natural(a.ids.join(), b.ids.join()) ||
      natural(collectionNames(model, a.collections), collectionNames(model, b.collections)),
  );
}

/** The Locations rows in the page's order, or by ID. */
export function orderedLocations(model: Model, result: FilterResult, o: ExportOptions): LocationRow[] {
  const rows = locationRows(model, result, o);
  return o.order ? o.order.locations(rows) : sortedLocations(model, rows);
}

export function locationsTable(model: Model, result: FilterResult, o: ExportOptions): Table {
  const many = multi(model);
  const rows = orderedLocations(model, result, o);
  return {
    name: 'Locations',
    columns: [
      ...(many ? ['Collection'] : []),
      'Location ID',
      'Location',
      'Mountain range',
      ...positionColumns(o),
      elevationColumn(o),
      'Photos',
      'Tagged',
      'Detections',
      'Species',
      'Active days',
      'First photo',
      'Last photo',
    ],
    rows: rows.map((r) => [
      ...(many ? [collectionNames(model, r.collections)] : []),
      r.ids.join(', '),
      r.noLocation ? 'No location set' : r.name || null,
      r.range || null,
      ...positionCells(r.position, o),
      elevationCell(r.elevation, o),
      r.photos,
      r.tagged,
      r.detections,
      r.species,
      r.activeDays,
      r.firstDate,
      r.lastDate,
    ]),
  };
}

export function speciesTable(model: Model, result: FilterResult, o: ExportOptions): Table {
  const rows = o.order
    ? o.order.species(speciesRows(model, result, o))
    : speciesRows(model, result, o).sort(
        (a, b) => b.detections - a.detections || model.species[a.species].name.localeCompare(model.species[b.species].name),
      );
  return {
    name: 'Species',
    columns: ['Common name', 'Scientific name', 'Detections', 'Animals counted', 'Photos', 'Locations', 'First seen', 'Last seen'],
    rows: rows.map((r) => [
      model.species[r.species].name,
      model.species[r.species].scientificName || null,
      r.detections,
      r.animals,
      r.photos,
      r.locations,
      r.firstDate,
      r.lastDate,
    ]),
  };
}

const byTime = (a: { time: string; fileName: string }, b: { time: string; fileName: string }) =>
  a.time.localeCompare(b.time) || natural(a.fileName, b.fileName);

/** The Photos rows in the page's order, or oldest first. */
function orderedPhotos(model: Model, result: FilterResult, o: ExportOptions): PhotoRow[] {
  const rows = photoRows(model, result.photos, result.detections, o);
  return o.order ? o.order.photos(rows) : rows.sort(byTime);
}

export function photosTable(model: Model, result: FilterResult, o: ExportOptions): Table {
  const many = multi(model);
  const rows = orderedPhotos(model, result, o);
  return {
    name: 'Photos',
    columns: [
      'Date and time',
      'File name',
      'Species',
      'Scientific name',
      'Count',
      'Tagged',
      'Location ID',
      'Location',
      ...(many ? ['Collection'] : []),
      ...positionColumns(o),
      elevationColumn(o),
      'Mountain range',
      'Upload',
    ],
    rows: rows.map((r) => {
      const p = model.photos[r.photo];
      const site = model.sites[p.site];
      return [
        r.time || null,
        r.fileName,
        r.species || null,
        r.scientificNames || null,
        r.tagged ? r.count : null,
        r.tagged ? 'Yes' : 'No',
        r.locationId || null,
        site.noLocation ? 'No location set' : r.locationName || null,
        ...(many ? [r.collection] : []),
        ...positionCells(site.position, o),
        elevationCell(site.elevation, o),
        site.range || null,
        model.uploads[p.upload].stamp,
      ];
    }),
  };
}

export function detectionsTable(model: Model, result: FilterResult, o: ExportOptions): Table {
  const many = multi(model);
  // Each photo's species together, in the Photos table's order.
  const rank = new Map(orderedPhotos(model, result, o).map((r, i) => [r.photo, i]));
  const rows = detectionRows(model, result.detections, o).sort((a, b) => rank.get(a.photo)! - rank.get(b.photo)! || a.detection - b.detection);
  return {
    name: 'Detections',
    columns: [
      'Date and time',
      'File name',
      'Common name',
      'Scientific name',
      'Count',
      'Location ID',
      'Location',
      ...(many ? ['Collection'] : []),
      ...positionColumns(o),
      elevationColumn(o),
    ],
    rows: rows.map((r) => {
      const site = model.sites[model.photos[r.photo].site];
      return [
        r.time || null,
        r.fileName,
        r.species,
        r.scientificName || null,
        r.count,
        r.locationId || null,
        site.noLocation ? 'No location set' : r.locationName || null,
        ...(many ? [r.collection] : []),
        ...positionCells(site.position, o),
        elevationCell(site.elevation, o),
      ];
    }),
  };
}

/**
 * Totals per open collection, less those the Collections filter unticks
 * (`hidden`): locations with camera effort, photos, tagged photos,
 * detections, species, and the first and last photo.
 */
export function collectionsTable(model: Model, result: FilterResult, o: ExportOptions, hidden: string[] = []): Table {
  const totals = model.collections.map(() => ({
    locations: new Set<string>(),
    photos: 0,
    tagged: 0,
    detections: 0,
    species: new Set<number>(),
    first: null as string | null,
    last: null as string | null,
  }));
  for (const i of result.effort) {
    const p = model.photos[i];
    totals[p.collection].locations.add(locationKeyOf(model.sites[p.site], o.separate));
  }
  for (const i of result.photos) {
    const p = model.photos[i];
    const t = totals[p.collection];
    t.photos++;
    if (p.tagged) t.tagged++;
    if (p.date !== null) {
      if (t.first === null || p.date < t.first) t.first = p.date;
      if (t.last === null || p.date > t.last) t.last = p.date;
    }
  }
  for (const d of result.detections) {
    const det = model.detections[d];
    totals[det.collection].detections++;
    totals[det.collection].species.add(det.species);
  }
  return {
    name: 'By collection',
    columns: ['Collection', 'Locations', 'Photos', 'Tagged', 'Detections', 'Species', 'First photo', 'Last photo'],
    rows: model.collections.flatMap((c, i) => {
      if (hidden.includes(c.key)) return [];
      const t = totals[i];
      return [[c.name, t.locations.size, t.photos, t.tagged, t.detections, t.species.size, t.first, t.last]];
    }),
  };
}

/** The report's key facts and numbers as two columns, with the per-collection totals under them when several are open. */
export function summaryTable(model: Model, result: FilterResult, o: ExportOptions, facts: ReportFacts, hidden: string[] = []): Table {
  const s = summarize(model, result, o);
  const rows: ExportCell[][] = [
    ['Collections', facts.collections],
    ['Filters', facts.filters],
    ['Prepared', facts.prepared],
    ['Prepared by', facts.preparedBy],
    ['Coordinates', facts.coordinates],
    ['Elevation', o.elevation === 'ft' ? 'Feet' : 'Metres'],
    ['Locations', s.locations],
    ['Photos', s.photos],
    ['Tagged photos', s.tagged],
    ['Untagged photos', s.photos - s.tagged],
    ['Detections', s.detections],
    ['Species', s.species],
    ['Animals counted', s.animals],
    ['Active days', s.activeDays],
    ['First photo', s.firstDate],
    ['Last photo', s.lastDate],
  ];
  if (multi(model)) {
    const by = collectionsTable(model, result, o, hidden);
    rows.push([], [by.name], by.columns, ...by.rows);
  }
  return { name: 'Summary', columns: ['Item', 'Value'], rows };
}

/** The workbook: Summary, Locations, Species, Photos and Detections. */
export function spreadsheetTables(
  model: Model,
  result: FilterResult,
  o: ExportOptions,
  facts: ReportFacts,
  hidden: string[] = [],
): Table[] {
  return [
    summaryTable(model, result, o, facts, hidden),
    locationsTable(model, result, o),
    speciesTable(model, result, o),
    photosTable(model, result, o),
    detectionsTable(model, result, o),
  ];
}

// --- CSV -------------------------------------------------------------------------

/**
 * Text a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, a tab or a
 * carriage return first) gets a leading `'`, so it opens as the text it is.
 * Numbers are never text here, and text that is a plain number (`-12.5`)
 * opens as that number, so neither changes.
 */
export function formulaSafe(text: string): string {
  return /^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
}

const quote = (v: ExportCell): string => {
  const s = v === null ? '' : typeof v === 'string' ? formulaSafe(v) : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tableCsv(t: Table): string {
  return [t.columns, ...t.rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** The CSV files of the zip: locations, species, photos and detections. */
export function csvFiles(model: Model, result: FilterResult, o: ExportOptions): Record<string, string> {
  return {
    'locations.csv': tableCsv(locationsTable(model, result, o)),
    'species.csv': tableCsv(speciesTable(model, result, o)),
    'photos.csv': tableCsv(photosTable(model, result, o)),
    'detections.csv': tableCsv(detectionsTable(model, result, o)),
  };
}

// --- File names ----------------------------------------------------------------------

/** A local calendar date, `2026-10-19`. */
export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type ExportKind = 'report.xlsx' | 'csv.zip' | 'camtrap-dp.zip';

/** `alpha-basin-2026-10-19-report.xlsx`, or `combined-…` for several collections. */
export function exportFileName(collections: string[], kind: ExportKind, today: Date): string {
  const base = collections.length === 1 ? slug(collections[0]) || 'collection' : 'combined';
  return `${base}-${isoDate(today)}-${kind}`;
}
