// Export CSV: the downloaded file is read back and checked.

import { readFile } from 'node:fs/promises';
import { Then, When, expect } from './support/world';

type Csv = { name: string; header: string[]; rows: string[][] };

/** Enough CSV parsing for the export: quoted cells with doubled quotes, CRLF rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else if (ch !== '\r') cell += ch;
  }
  return rows;
}

When('I export CSV', async ({ page, scratch }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const [header, ...rows] = parseCsv(await readFile((await download.path())!, 'utf8'));
  scratch.csv = { name: download.suggestedFilename(), header, rows } satisfies Csv;
});

const csvOf = (scratch: Record<string, unknown>) => scratch.csv as Csv;

Then('the file is named like {string}', async ({ scratch }, pattern: string) => {
  const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace('<date>', '\\d{4}-\\d{2}-\\d{2}')}$`);
  expect(csvOf(scratch).name).toMatch(re);
});

Then('the CSV has the header {string}', async ({ scratch }, header: string) => {
  expect(csvOf(scratch).header.join(',')).toBe(header);
});

Then(
  'the CSV row for {string} has latitude {string} and longitude {string}',
  async ({ scratch }, id: string, lat: string, lon: string) => {
    const { header, rows } = csvOf(scratch);
    const row = rows.find((r) => r[header.indexOf('Location ID')] === id)!;
    expect(row, `row ${id}`).toBeTruthy();
    expect(row[header.indexOf('Latitude')]).toBe(lat);
    expect(row[header.indexOf('Longitude')]).toBe(lon);
  },
);

Then('the CSV has {int} rows', async ({ scratch }, n: number) => {
  expect(csvOf(scratch).rows).toHaveLength(n);
});

Then('the CSV header ends with {string}', async ({ scratch }, tail: string) => {
  expect(csvOf(scratch).header.join(',').endsWith(tail)).toBe(true);
});

Then('the CSV header includes {string}', async ({ scratch }, part: string) => {
  expect(csvOf(scratch).header.join(',')).toContain(part);
});

Then('no CSV value has more than {int} decimals', async ({ scratch }, digits: number) => {
  for (const value of csvOf(scratch).rows.flat()) {
    if (/^-?\d+\.\d+$/.test(value)) expect(value.split('.')[1].length, value).toBeLessThanOrEqual(digits);
  }
});

Then('every CSV easting and northing is a plain whole number', async ({ scratch }) => {
  const { header, rows } = csvOf(scratch);
  const values = rows.flatMap((r) => [r[header.indexOf('Easting')], r[header.indexOf('Northing')]]).filter(Boolean);
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) expect(v).toMatch(/^\d+$/);
});
