// Export CSV: the downloaded file is read back and checked.

import { readFile } from 'node:fs/promises';
import { ALPHA, addUpload, cameraNamed } from './support/data';
import { Given, Then, When, columnValues, expect, viewMenu } from './support/world';

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
  const menu = await viewMenu(page);
  const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('button', { name: 'Export CSV' }).click()]);
  const [header, ...rows] = parseCsv(await readFile((await download.path())!, 'utf8'));
  scratch.name = download.suggestedFilename();
  scratch.csv = { name: download.suggestedFilename(), header, rows } satisfies Csv;
});

const csvOf = (scratch: Record<string, unknown>) => scratch.csv as Csv;

Then('the file is named like {string}', async ({ scratch }, pattern: string) => {
  const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace('<date>', '\\d{4}-\\d{2}-\\d{2}')}$`);
  expect(scratch.name).toMatch(re);
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

Then(
  'the CSV row for {string} has UTM {string}, easting {string} and northing {string}',
  async ({ scratch }, id: string, zone: string, easting: string, northing: string) => {
    const { header, rows } = csvOf(scratch);
    const row = rows.find((r) => r[header.indexOf('Location ID')] === id)!;
    expect(row, `row ${id}`).toBeTruthy();
    expect([row[header.indexOf('UTM zone')], row[header.indexOf('Easting')], row[header.indexOf('Northing')]]).toEqual([
      zone,
      easting,
      northing,
    ]);
  },
);

Given('{string} has a camera named {string}', async ({ s3 }, collection: string, name: string) => {
  expect(collection).toBe('Alpha Basin');
  addUpload(s3, ALPHA, cameraNamed(name));
});

Then('the CSV row for {string} reads {string} under {string}', async ({ scratch }, id: string, value: string, column: string) => {
  const { header, rows } = csvOf(scratch);
  const row = rows.find((r) => r[header.indexOf('Location ID')] === id);
  expect(row, `row ${id}`).toBeTruthy();
  expect(row![header.indexOf(column)]).toBe(value);
});

Then(/^the CSV lists the (locations|photos) in the table's order$/, async ({ page, scratch }, what: string) => {
  const column = what === 'locations' ? 'Location ID' : 'Date and time';
  const { header, rows } = csvOf(scratch);
  const listed = rows.map((r) => r[header.indexOf(column)]);
  expect(listed.length).toBeGreaterThan(1);
  expect(listed).toEqual(await columnValues(page, column));
});

// --- Saving a chart ------------------------------------------------------------------

When('I save the data of {string}', async ({ page, scratch }, title: string) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Save data of ${title}`, exact: true }).click()]);
  const [header, ...rows] = parseCsv(await readFile((await download.path())!, 'utf8'));
  scratch.name = download.suggestedFilename();
  scratch.csv = { name: download.suggestedFilename(), header, rows } satisfies Csv;
});

Then('the CSV reads {string} then {string} then {string}', async ({ scratch }, a: string, b: string, c: string) => {
  expect(csvOf(scratch).rows.map((r) => r.join(','))).toEqual([a, b, c]);
});

Then('the CSV has the row {string}', async ({ scratch }, row: string) => {
  expect(csvOf(scratch).rows.map((r) => r.join(','))).toContain(row);
});

When('I save the image of {string}', async ({ page, scratch }, title: string) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Save image of ${title}`, exact: true }).click()]);
  scratch.name = download.suggestedFilename();
  scratch.png = await readFile((await download.path())!);
});

Then('the file is a PNG {int} pixels wide', async ({ scratch }, width: number) => {
  const png = scratch.png as Buffer;
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(width);
});

Then('the image has a white background and bars in the light palette', async ({ page, scratch }) => {
  const seen = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let bars = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 0x0b && data[i + 1] === 0x33 && data[i + 2] === 0x58) bars++;
    return { corner: [...data.subarray(0, 4)], bars };
  }, (scratch.png as Buffer).toString('base64'));
  expect(seen.corner).toEqual([255, 255, 255, 255]);
  expect(seen.bars).toBeGreaterThan(100);
});
