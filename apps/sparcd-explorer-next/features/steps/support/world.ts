// Fixtures and flows the feature steps share.

import { expect, type Locator, type Page } from '@playwright/test';
import { test as base, createBdd } from 'playwright-bdd';
import { MockS3, installS3Mock, testOrigin } from './s3mock';
import { seedFixtures } from './data';

export const APP_URL = '/sparcd-exploration/explorer-next/';
export const ENDPOINT = testOrigin();
export const USERNAME = 'fieldlead';

export type Scratch = Record<string, unknown>;

export const test = base.extend<{ s3: MockS3; scratch: Scratch }>({
  s3: async ({}, use) => {
    const s3 = new MockS3();
    seedFixtures(s3);
    await use(s3);
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

export const filterBar = (page: Page): Locator => page.getByRole('group', { name: 'Filters' });
export const filterButton = (page: Page, name: string | RegExp): Locator =>
  filterBar(page).getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}`) : name });
export const resetButton = (page: Page): Locator => page.getByRole('button', { name: /^Reset( filters)?$/ });
export const photoCount = (page: Page): Locator => page.locator('.fright .result');
export const table = (page: Page): Locator => page.locator('#table table.data');
export const tableRows = (page: Page): Locator => table(page).locator('tbody tr:not([aria-hidden])');
export const headerCells = (page: Page): Locator => table(page).locator('thead th');
export const viewButton = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Show' }).getByRole('button', { name, exact: true });
export const popover = (page: Page, name: string): Locator => page.getByRole('dialog', { name });

/** Column labels in order: each header's first text, as written (headers are uppercased by CSS). */
export async function columnLabels(page: Page): Promise<string[]> {
  const labels = await headerCells(page).evaluateAll((cells) =>
    cells.map((th) => {
      const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT, (n) =>
        n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      );
      return walker.nextNode()?.textContent?.trim() ?? '';
    }),
  );
  return labels.filter((l) => l && l !== 'Actions');
}

/** The cell texts of one column, by its header label. */
export async function columnValues(page: Page, label: string): Promise<string[]> {
  const index = (await columnLabels(page)).findIndex((l) => l.toLowerCase() === label.toLowerCase());
  expect(index, `column ${label}`).toBeGreaterThanOrEqual(0);
  return tableRows(page).evaluateAll((rows, i) => rows.map((r) => (r as HTMLTableRowElement).cells[i]?.innerText.trim() ?? ''), index);
}

// --- Flows ----------------------------------------------------------------------

export async function signIn(page: Page, username = USERNAME): Promise<void> {
  await page.goto(APP_URL);
  await page.locator('#endpoint').fill(ENDPOINT);
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
