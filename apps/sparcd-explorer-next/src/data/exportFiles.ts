// The export files themselves. The spreadsheet writer and the zip library
// load only when someone downloads, so neither is in the app's first load.

import type { ExportCell, Table } from './export';

/** About as wide as a column's longest text, between 8 and 48 characters. */
const width = (t: Table, i: number): number =>
  Math.min(48, Math.max(8, t.columns[i].length + 2, ...t.rows.slice(0, 500).map((r) => String(r[i] ?? '').length + 1)));

/**
 * A cell as its type: text is always written as a string cell, never a
 * formula, so `=1+1` in a name opens as those characters.
 */
const cell = (v: ExportCell) => (typeof v === 'string' ? { value: v, type: String } : v);

/** An .xlsx workbook, one sheet per table, its header row bold and frozen. */
export async function xlsxBlob(tables: Table[]): Promise<Blob> {
  // write-excel-file: maintained, multi-sheet, and its one dependency is fflate, which the zips use too.
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  return writeXlsxFile(
    tables.map((t) => ({
      sheet: t.name,
      data: [t.columns.map((c) => ({ value: c, type: String, fontWeight: 'bold' as const })), ...t.rows.map((r) => r.map(cell))],
      stickyRowsCount: 1,
      columns: t.columns.map((_, i) => ({ width: width(t, i) })),
    })),
  ).toBlob();
}

/** A .zip of text files. */
export async function zipBlob(files: Record<string, string>): Promise<Blob> {
  const { strToU8, zipSync } = await import('fflate');
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
