// Steps for the preview feedback (Juli4nG/sparcd-explorer-preview#1–#7).

import type { Locator, Page } from '@playwright/test';
import { ALPHA, addUpload, putCollection } from './support/data';
import { Given, Then, When, expect } from './support/world';

const collectionList = (page: Page) => page.getByRole('list', { name: 'Collections' });

// --- #1 Select all and Clear all in the chooser ----------------------------------

Given('there are {int} more collections called {string}', async ({ s3 }, n: number, base: string) => {
  for (let i = 1; i <= n; i++) {
    putCollection(s3, { name: `${base} ${i}`, uuid: `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}` }, []);
  }
});

When('I press {string} above the collections', async ({ page }, label: string) => {
  await page.getByRole('button', { name: label, exact: true }).click();
});

When('I search the collections for {string}', async ({ page }, text: string) => {
  await page.getByLabel('Search collections').fill(text);
});

When('I clear the search', async ({ page }) => {
  await page.getByLabel('Search collections').fill('');
});

Then('every collection is ticked', async ({ page }) => {
  const boxes = collectionList(page).getByRole('checkbox');
  for (const box of await boxes.all()) await expect(box).toBeChecked();
});

Then('no collection is ticked', async ({ page }) => {
  const boxes = collectionList(page).getByRole('checkbox');
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
});

Then('{string} is not ticked', async ({ page }, name: string) => {
  await expect(collectionList(page).locator('label').filter({ hasText: name }).getByRole('checkbox')).not.toBeChecked();
});

// --- #4 Year labels that never pile up -------------------------------------------

Given('{string} also has photos from {int}', async ({ s3 }, _name: string, year: number) => {
  addUpload(s3, ALPHA, {
    stamp: `${year}.06.01.10.00.00_fielduser`,
    deployment: { id: 'AB08', name: 'Old Spring', lat: 0.56, lon: -150.2, elevation: 1250 },
    photos: [{ file: 'IMG0801.JPG', time: `${year}-05-10T08:00:00` }],
  });
});

/** Each label's left and right edge, in order. */
async function labelEdges(labels: Locator): Promise<{ text: string; left: number; right: number }[]> {
  return labels.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent ?? '', left: r.left, right: r.right };
    }),
  );
}

async function expectApart(labels: Locator, first: string) {
  const edges = await labelEdges(labels);
  expect(edges[0].text).toBe(first);
  expect(edges.length).toBeGreaterThan(1);
  for (let i = 1; i < edges.length; i++) expect(edges[i].left - edges[i - 1].right).toBeGreaterThanOrEqual(4);
}

Then('the Activity year labels start at {string} and none touch', async ({ page }, first: string) => {
  await expectApart(page.locator('#table .yaxis span'), first);
});

Then('the effort strip year labels start at {string} and none touch', async ({ page }, first: string) => {
  await expectApart(page.locator('svg.effort text.year'), first);
});
