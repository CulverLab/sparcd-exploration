// CSV export of the rows in view. The columns are the ones shown, with the
// combined Coordinates column split into its parts. Tables with positions
// always carry them, at the display precision, so an export is usable on its
// own.

import type { Display } from './format';
import { cellText, type Cell, type Col } from './tables';

const COORDINATE_IDS = ['coords', 'lat', 'lon', 'zone', 'easting', 'northing'];

/** The columns a CSV of this table holds, in order. */
export function csvColumns<R>(defs: Col<R>[], shown: string[], display: Display): Col<R>[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const parts = (display.coords === 'utm' ? ['zone', 'easting', 'northing'] : ['lat', 'lon']).filter((id) => byId.has(id));
  const ids = shown.flatMap((id) => (id === 'coords' ? parts : [id]));
  if (parts.length && !shown.some((id) => COORDINATE_IDS.includes(id))) ids.push(...parts);
  return [...new Set(ids)].map((id) => byId.get(id)!).filter((c) => !c.noExport);
}

const quote = (v: Cell): string => {
  const s = v === null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<R>(cols: Col<R>[], rows: R[]): string {
  const lines = [cols.map((c) => quote(c.csvLabel ?? c.label)).join(',')];
  // Text columns export what the cell shows; numeric ones their plain value.
  for (const r of rows) lines.push(cols.map((c) => quote(c.numeric || c.mono ? c.value(r) : csvText(c, r))).join(','));
  return lines.join('\r\n') + '\r\n';
}

const csvText = <R>(c: Col<R>, r: R): Cell => (c.value(r) === null ? null : cellText(c, r));

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** `alpha-basin-2026-10-19-locations.csv`, or `alpha-and-bravo-…` for several collections. */
export function csvFileName(collections: string[], view: string, today: Date): string {
  const base =
    collections.length === 1
      ? slug(collections[0])
      : collections.length === 2
        ? `${slug(collections[0])}-and-${slug(collections[1])}`
        : `${slug(collections[0])}-and-${collections.length - 1}-more`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base}-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}-${view}.csv`;
}
