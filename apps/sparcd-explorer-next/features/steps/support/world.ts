// Fixtures and flows the feature steps share.

import { expect, type Locator, type Page } from '@playwright/test';
import { test as base, createBdd } from 'playwright-bdd';
import { MockS3, installS3Mock, testOrigin } from './s3mock';
import { seedFixtures } from './data';

export const APP_URL = '/sparcd-exploration/explorer-next/';
export const ENDPOINT = testOrigin();
export const USERNAME = 'fieldlead';

export type Scratch = Record<string, unknown>;

// Basemap tiles never leave the machine: every tile host answers with one
// blank pixel.
const TILE_HOSTS = ['nationalmap.gov', 'arcgisonline.com', 'openstreetmap.org', 'cartocdn.com'];
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);
const isTile = (url: URL) => url.pathname.includes('/tile/') || TILE_HOSTS.some((h) => url.hostname.endsWith(h));

/** Tile requests the page made, and the ones answered here. */
export type Tiles = { requested: string[]; answered: string[] };

export const test = base.extend<{ s3: MockS3; scratch: Scratch; tiles: Tiles }>({
  s3: async ({}, use) => {
    const s3 = new MockS3();
    seedFixtures(s3);
    await use(s3);
  },
  tiles: async ({}, use) => {
    await use({ requested: [], answered: [] });
  },
  context: async ({ context, tiles }, use) => {
    context.on('request', (r) => {
      if (isTile(new URL(r.url()))) tiles.requested.push(r.url());
    });
    await context.route(isTile, (route) => {
      tiles.answered.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG });
    });
    await use(context);
  },
  page: async ({ page, s3 }, use) => {
    await installS3Mock(page, s3);
    await use(page);
  },
  scratch: async ({}, use) => {
    await use({});
  },
});

export const { Given, When, Then } = createBdd(test);
export { expect };

// --- Page parts ---------------------------------------------------------------

/** The filter sidebar (or, on a phone, the Filters sheet). */
export const filterBar = (page: Page): Locator => page.getByRole('complementary', { name: 'Filters' });
/** A sidebar section's button: its name, then its value ("Species All 4 species"). */
export const filterButton = (page: Page, name: string | RegExp): Locator =>
  filterBar(page).getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}`) : name });
export const resetButton = (page: Page): Locator => page.getByRole('button', { name: 'Reset filters', exact: true });
/** The Photos figure: its number, then "% tagged", and "of N" while a filter is on. */
export const photosFigure = (page: Page): Locator => page.locator('#figures .fig.ph');
/** The Photos figure as one line: "4 of 11 photos", or "11 photos" with no filter on. */
export async function photoCountText(page: Page): Promise<string> {
  const fig = photosFigure(page);
  const v = (await fig.locator('.v').innerText()).trim();
  const of = (await fig.locator('.of').innerText()).split(' · ')[1] ?? '';
  const noun = (of ? of.slice(3) : v) === '1' ? 'photo' : 'photos';
  return of ? `${v} ${of} ${noun}` : `${v} ${noun}`;
}
export const table = (page: Page): Locator => page.locator('#table table.data');
export const tableRows = (page: Page): Locator => table(page).locator('tbody tr:not([aria-hidden])');
export const headerCells = (page: Page): Locator => table(page).locator('thead th');
export const viewButton = (page: Page, name: string): Locator =>
  page.getByRole('tablist', { name: 'Tables' }).getByRole('tab', { name, exact: true });
export const popover = (page: Page, name: string): Locator => page.getByRole('dialog', { name });

/** A trigger's menu, opened unless it already is. */
async function opened(page: Page, trigger: Locator, name: string): Promise<Locator> {
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(popover(page, name)).toBeVisible();
  return popover(page, name);
}
/** The collection title's menu: By collection, Change collections, the data checks and "Updated ...". */
export const titleMenu = (page: Page): Promise<Locator> => opened(page, page.locator('#collname'), 'Collections');
/** The table's View menu. */
export const viewMenu = (page: Page): Promise<Locator> => opened(page, page.locator('#table .viewbtn'), 'View');
/** The Map menu: Hexes or Sites, and the basemap. */
export const mapMenu = (page: Page): Promise<Locator> => opened(page, page.locator('#map').getByRole('button', { name: 'Map', exact: true }), 'Map');
/** Columns… in the View menu: the Columns editor, under the View button. */
export async function columnsEditor(page: Page): Promise<Locator> {
  await (await viewMenu(page)).getByRole('button', { name: 'Columns…' }).click();
  return page.getByRole('dialog', { name: /^Columns/ });
}
/** Grid or List, from the View menu. */
export async function chooseLayout(page: Page, layout: 'Grid' | 'List'): Promise<void> {
  await (await viewMenu(page)).getByRole('group', { name: 'Show as' }).getByRole('button', { name: layout }).click();
  await page.keyboard.press('Escape');
}

/**
 * The table has caught up with the last click. It follows a view switch, a
 * sort or a filter in a background render, and says "Updating…" until then.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator('#table .updating')).toHaveCount(0);
}

/** Column labels in order: each header's first text, as written (headers are uppercased by CSS). */
export async function columnLabels(page: Page): Promise<string[]> {
  await settled(page);
  const labels = await headerCells(page).evaluateAll((cells) =>
    cells.map((th) => {
      const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT, (n) =>
        n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      );
      return walker.nextNode()?.textContent?.trim() ?? '';
    }),
  );
  return labels.filter((l) => l && l !== 'Actions' && l !== 'Open');
}

/** The cell texts of one column, by its header label. */
export async function columnValues(page: Page, label: string): Promise<string[]> {
  const index = (await columnLabels(page)).findIndex((l) => l.toLowerCase() === label.toLowerCase());
  expect(index, `column ${label}`).toBeGreaterThanOrEqual(0);
  return tableRows(page).evaluateAll((rows, i) => rows.map((r) => (r as HTMLTableRowElement).cells[i]?.innerText.trim() ?? ''), index);
}

// --- Flows ----------------------------------------------------------------------

export async function signIn(page: Page, username = USERNAME, endpoint = ENDPOINT): Promise<void> {
  await page.goto(APP_URL);
  await page.locator('#endpoint').fill(endpoint);
  await page.locator('#accessKey').fill(username);
  await page.locator('#secretKey').fill('a-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function signedIn(page: Page): Promise<void> {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
}

export const collectionBox = (page: Page, name: string): Locator =>
  page.getByRole('list', { name: 'Collections' }).locator('label').filter({ hasText: name }).getByRole('checkbox');

export async function openCollections(page: Page, ...names: string[]): Promise<void> {
  if (!(await page.getByRole('heading', { name: 'Choose collections' }).count())) await signedIn(page);
  for (const name of names) await collectionBox(page, name).check();
  await page.getByRole('button', { name: /^Open / }).click();
  await expect(page.locator('#sticky-top')).toBeVisible();
}
