// The report sheet and its downloads. Every download is read back from disk:
// the zips unzipped, the spreadsheet's XML parsed into rows.

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { Then, When, columnValues, expect, type Scratch } from './support/world';

const report = (page: Page) => page.getByRole('dialog', { name: 'Report preview' });
const sheet = (page: Page) => report(page).locator('article.sheet');
const section = (page: Page, title: string) => sheet(page).getByRole('region', { name: title });

// --- The sheet ---------------------------------------------------------------------

When('I open the report', async ({ page }) => {
  // The test browser can't show a print dialog; count the calls instead.
  await page.evaluate(() => {
    const w = window as unknown as { prints: number };
    w.prints ??= 0;
    window.print = () => void w.prints++;
  });
  // A pointer click where the button is: Playwright's own click would first
  // scroll the sticky header's "natural" place into view, moving the page.
  // Measured again on a retry: the header can still be settling as the workspace opens.
  await expect(async () => {
    const box = (await page.getByRole('button', { name: 'Report', exact: true }).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(report(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 10_000 });
});

When('I close the report', async ({ page }) => {
  await report(page).getByRole('button', { name: 'Close', exact: true }).click();
});

Then('the report is closed', async ({ page }) => {
  await expect(report(page)).toHaveCount(0);
});

Then('the report is titled {string} for {string}', async ({ page }, title: string, collections: string) => {
  await expect(sheet(page).getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(sheet(page).locator('.r-colls')).toHaveText(collections);
});

Then("the report's filters read {string}", async ({ page }, words: string) => {
  await expect(sheet(page).locator('.r-filters')).toHaveText(words);
});

Then('the report says {string}', async ({ page }, text: string) => {
  await expect(sheet(page).locator('.r-head')).toContainText(text);
});

Then('the report includes {string}', async ({ page }, list: string) => {
  await expect(sheet(page).locator('section.r-sec:not([hidden]) > h2')).toHaveText(list.split(', '));
  const boxes = report(page).getByRole('group', { name: 'Include' }).getByRole('checkbox', { checked: true });
  await expect(boxes).toHaveCount(list.split(', ').length);
});

When('I leave out {string} and {string}', async ({ page }, a: string, b: string) => {
  const include = report(page).getByRole('group', { name: 'Include' });
  await include.getByRole('checkbox', { name: a }).uncheck();
  await include.getByRole('checkbox', { name: b }).uncheck();
});

Then("the report's Species table lists {string}", async ({ page }, names: string) => {
  await expect(section(page, 'Species').locator('tbody td:first-child')).toHaveText(names.split(', '));
});

Then("the report's map shows hexes", async ({ page }) => {
  const map = section(page, 'Map');
  expect(await map.locator('svg.rmap polygon.hx').count()).toBeGreaterThan(0);
  await expect(map.locator('figcaption')).toContainText('No basemap');
  await expect(map.locator('.scalebar text')).toHaveText(/^\d[\d,]* (k?m)$/);
});

Then("the report's totals by collection read {string} and {string}", async ({ page }, a: string, b: string) => {
  const rows = await section(page, 'By collection')
    .locator('tbody tr')
    .evaluateAll((trs) => trs.map((tr) => `${(tr as HTMLTableRowElement).cells[0].textContent} ${(tr as HTMLTableRowElement).cells[2].textContent} photos`));
  expect(rows).toEqual([a, b]);
});

Then("the report's Locations table has a Collection column", async ({ page }) => {
  await expect(section(page, 'Locations').locator('thead th').first()).toHaveText('Collection');
});

When('I scroll the report to its end', async ({ page }) => {
  await page.locator('#report').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await page.locator('#report').evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
});

Then('focus is back on the {string} button', async ({ page }, name: string) => {
  await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
});

// --- Printing ------------------------------------------------------------------------

When('I switch to the dark appearance', async ({ page }) => {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Dark appearance' }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.keyboard.press('Escape');
});

Then('the browser was asked to print once', async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { prints: number }).prints)).toBe(1);
});

When('the page is set up for printing', async ({ page }) => {
  await page.emulateMedia({ media: 'print' });
});

Then("only the report's pages show, without its buttons", async ({ page }) => {
  await expect(page.locator('#root')).toBeHidden();
  await expect(page.locator('.rep-bar')).toBeHidden();
  await expect(sheet(page)).toBeVisible();
  expect(await page.locator('#report').evaluate((el) => getComputedStyle(el).position)).toBe('static');
});

Then('the report prints dark ink on white paper', async ({ page }) => {
  const [paper, ink] = await sheet(page).evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  expect(paper).toBe('rgb(255, 255, 255)');
  expect(ink).toBe('rgb(28, 26, 20)');
});

Then('the report keeps table rows and charts whole across pages', async ({ page }) => {
  const avoid = await sheet(page).evaluate((el) =>
    ['.rt tbody tr', '.r-map', '.r-chart', '.r-stats'].map((sel) => getComputedStyle(el.querySelector(sel)!).breakInside),
  );
  expect(avoid).toEqual(['avoid', 'avoid', 'avoid', 'avoid']);
  expect(await sheet(page).locator('.rt thead').first().evaluate((el) => getComputedStyle(el).display)).toBe('table-header-group');
});

// --- Downloads ------------------------------------------------------------------------

type Files = Record<string, string>;

async function save(page: Page, scratch: Scratch, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const bytes = await readFile((await download.path())!);
  scratch.name = download.suggestedFilename();
  const files = unzipSync(new Uint8Array(bytes));
  scratch.files = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)])) satisfies Files;
}

When('I download the spreadsheet', async ({ page, scratch }) => {
  await save(page, scratch, () => report(page).getByRole('button', { name: 'Download spreadsheet' }).click());
});

When('I download {string} from More formats', async ({ page, scratch }, item: string) => {
  await save(page, scratch, async () => {
    await report(page).getByRole('button', { name: /^More formats/ }).click();
    await report(page).getByRole('menuitem', { name: item }).click();
  });
});

const filesOf = (scratch: Scratch) => scratch.files as Files;

Then('the zip holds {string}', async ({ scratch }, list: string) => {
  expect(Object.keys(filesOf(scratch))).toEqual(list.split(', '));
});

// The spreadsheet as rows of text: shared strings resolved, numbers as written.
type Sheets = Record<string, string[][]>;
const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const columnIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function sheetsOf(files: Files): Sheets {
  const shared = [...(files['xl/sharedStrings.xml'] ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => unescape(m[1]));
  const sheets: Sheets = {};
  names.forEach((name, i) => {
    const xml = files[`xl/worksheets/sheet${i + 1}.xml`];
    sheets[name] = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, ref, attrs, inner = ''] = c;
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
        cells[columnIndex(ref)] = /t="s"/.test(attrs) ? shared[Number(v)] : unescape(inline ?? v ?? '');
      }
      return Array.from(cells, (x) => x ?? '');
    });
  });
  return sheets;
}

const sheets = (scratch: Scratch) => sheetsOf(filesOf(scratch));

Then('the spreadsheet has the sheets {string}', async ({ scratch }, list: string) => {
  expect(Object.keys(sheets(scratch))).toEqual(list.split(', '));
});

const rowFor = (rows: string[][], id: string) => {
  const [header, ...body] = rows;
  const row = body.find((r) => r[header.indexOf('Location ID')] === id);
  expect(row, `row ${id}`).toBeTruthy();
  return (name: string) => row![header.indexOf(name)];
};

Then(
  'the {string} sheet row for {string} has latitude {string} and longitude {string}',
  async ({ scratch }, name: string, id: string, lat: string, lon: string) => {
    const cell = rowFor(sheets(scratch)[name], id);
    expect([cell('Latitude'), cell('Longitude')]).toEqual([lat, lon]);
  },
);

Then(
  'the {string} sheet row for {string} has UTM {string}, easting {string} and northing {string}',
  async ({ scratch }, name: string, id: string, zone: string, easting: string, northing: string) => {
    const cell = rowFor(sheets(scratch)[name], id);
    expect([cell('UTM zone'), cell('Easting'), cell('Northing')]).toEqual([zone, easting, northing]);
  },
);

Then('the {string} sheet reads {string} {string}', async ({ scratch }, name: string, item: string, value: string) => {
  expect(sheets(scratch)[name].find((r) => r[0] === item)?.[1]).toBe(value);
});

Then('the {string} sheet has {int} rows', async ({ scratch }, name: string, n: number) => {
  expect(sheets(scratch)[name].length - 1).toBe(n);
});

Then('no number in the spreadsheet has more than {int} decimals', async ({ scratch }, digits: number) => {
  const numbers = Object.values(sheets(scratch))
    .flat(2)
    .filter((v) => /^-?\d+\.\d+$/.test(v));
  expect(numbers.length).toBeGreaterThan(0);
  for (const v of numbers) expect(v.split('.')[1].length, v).toBeLessThanOrEqual(digits);
});

// --- CSV and Camtrap DP zips ------------------------------------------------------------

/** A CSV the explorer wrote: header first, CRLF rows, quotes only where needed. */
function csvRows(text: string): string[][] {
  return text
    .trimEnd()
    .split('\r\n')
    .map((line) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => m[1].replace(/^"|"$/g, '').replace(/""/g, '"')));
}

Then(
  '{string} in the zip has the row for {string} at latitude {string} and longitude {string}',
  async ({ scratch }, file: string, id: string, lat: string, lon: string) => {
    const cell = rowFor(csvRows(filesOf(scratch)[file]), id);
    expect([cell('Latitude'), cell('Longitude')]).toEqual([lat, lon]);
  },
);

Then(/^"(.*)" in the zip has (\d+) rows?$/, async ({ scratch }, file: string, n: string) => {
  expect(csvRows(filesOf(scratch)[file]).length - 1).toBe(Number(n));
});

/** SPARC'd's own layout: every field quoted, LF rows, no header. */
const sparcdRows = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));

Then("the package's media.csv lists {string}", async ({ scratch }, list: string) => {
  expect(sparcdRows(filesOf(scratch)['media.csv']).map((r) => r[6]).sort()).toEqual(list.split(', '));
});

Then('every deployment in the package sits at {int} decimals or fewer', async ({ scratch }, digits: number) => {
  const rows = sparcdRows(filesOf(scratch)['deployments.csv']);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    for (const v of [r[3], r[4]]) {
      if (v) expect(Number(v), v).toBe(Number(Number(v).toFixed(digits)));
    }
  }
});

Then(
  "the package's deployment {string} sits at latitude {string} and longitude {string}",
  async ({ scratch }, id: string, lat: string, lon: string) => {
    const row = sparcdRows(filesOf(scratch)['deployments.csv']).find((r) => r[1] === id);
    expect(row, `deployment ${id}`).toBeTruthy();
    expect([row![4], row![3]]).toEqual([lat, lon]);
  },
);

Then("the package's datapackage.json follows the Camtrap DP profile and says {string}", async ({ scratch }, note: string) => {
  const dp = JSON.parse(filesOf(scratch)['datapackage.json']);
  expect(dp.profile).toBe('https://raw.githubusercontent.com/tdwg/camtrap-dp/0.1.6/camtrap-dp-profile.json');
  expect(dp.resources.map((r: { name: string; path: string }) => `${r.name}:${r.path}`)).toEqual([
    'deployments:deployments.csv',
    'media:media.csv',
    'observations:observations.csv',
  ]);
  for (const key of ['created', 'contributors', 'project', 'spatial', 'temporal', 'taxonomic']) expect(dp).toHaveProperty(key);
  expect(dp.description).toContain(note);
});

// --- Order, the tag switch and text guarded against formulas --------------------------

const ORDER_COLUMN = { locations: 'Location ID', photos: 'Date and time' } as const;

When(/^I note the order of the (Locations|Photos) table$/, async ({ page, scratch }, table: string) => {
  const key = table.toLowerCase() as keyof typeof ORDER_COLUMN;
  scratch[`${key}Order`] = await columnValues(page, ORDER_COLUMN[key]);
  expect((scratch[`${key}Order`] as string[]).length).toBeGreaterThan(1);
});

const noted = (scratch: Scratch, key: keyof typeof ORDER_COLUMN) => scratch[`${key}Order`] as string[];
const columnOf = (rows: string[][], name: string) => rows.slice(1).map((r) => r[rows[0].indexOf(name)]);

Then("the report's Locations table lists the locations in the noted order", async ({ page, scratch }) => {
  await expect(section(page, 'Locations').locator('tbody tr td:first-child')).toHaveText(noted(scratch, 'locations'));
});

Then(/^the "(Locations|Photos)" sheet lists the (?:locations|photos) in the noted order$/, async ({ scratch }, name: string) => {
  const key = name.toLowerCase() as keyof typeof ORDER_COLUMN;
  expect(columnOf(sheets(scratch)[name], ORDER_COLUMN[key])).toEqual(noted(scratch, key));
});

Then('"photos.csv" in the zip lists the photos in the noted order', async ({ scratch }) => {
  expect(columnOf(csvRows(filesOf(scratch)['photos.csv']), 'Date and time')).toEqual(noted(scratch, 'photos'));
});

Then('every row of the {string} sheet reads {string} under {string}', async ({ scratch }, name: string, value: string, column: string) => {
  expect(new Set(columnOf(sheets(scratch)[name], column))).toEqual(new Set([value]));
});

Then('the {string} sheet row for {string} holds {string} as text, not a formula', async ({ scratch }, name: string, id: string, text: string) => {
  expect(rowFor(sheets(scratch)[name], id)('Location')).toBe(text);
  const files = filesOf(scratch);
  const xml = Object.keys(files).filter((f) => f.startsWith('xl/worksheets/')).map((f) => files[f]).join('');
  expect(xml).not.toContain('<f>');
});

Then('{string} in the zip names {string} {string}', async ({ scratch }, file: string, id: string, name: string) => {
  expect(rowFor(csvRows(filesOf(scratch)[file]), id)('Location')).toBe(name);
});

Then("the package's deployment {string} is named {string}", async ({ scratch }, id: string, name: string) => {
  const row = sparcdRows(filesOf(scratch)['deployments.csv']).find((r) => r[1] === id);
  expect(row, `deployment ${id}`).toBeTruthy();
  expect(row![2]).toBe(name);
});
