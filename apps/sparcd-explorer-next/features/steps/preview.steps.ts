// Steps for the preview feedback (Juli4nG/sparcd-explorer-preview#1–#7).

import type { Locator, Page } from '@playwright/test';
import { ALPHA, BRAVO, addUpload, putCollection } from './support/data';
import { Given, Then, When, columnLabels, expect, popover, tableRows, viewButton } from './support/world';

const collectionList = (page: Page) => page.getByRole('list', { name: 'Collections' });
const byCollection = (page: Page) => page.getByRole('region', { name: 'In view' }).locator('table.bc');
const byCollectionClear = (page: Page) => page.getByRole('button', { name: 'Clear collection selection' });

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

// --- #2 Clearing a collection picked in By collection ----------------------------

When('I pick {string} in By collection', async ({ page }, name: string) => {
  await byCollection(page).getByRole('button', { name, exact: true }).click();
});

Then('By collection lists {string} then {string}', async ({ page }, a: string, b: string) => {
  await expect(byCollection(page).locator('tbody tr td:first-child')).toHaveText([a, b]);
});

Then('{string} is highlighted in By collection', async ({ page }, name: string) => {
  const row = byCollection(page).locator('tbody tr', { hasText: name });
  await expect(row).toHaveClass(/\bon\b/);
  await expect(row.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
});

Then('no row is highlighted in By collection', async ({ page }) => {
  await expect(byCollection(page).locator('tbody tr.on')).toHaveCount(0);
});

Then('"× Clear" shows at the right end of the "By collection" line', async ({ page }) => {
  const clear = byCollectionClear(page);
  await expect(clear).toBeVisible();
  await expect(clear).toHaveText('×Clear');
  const line = (await page.locator('.bchead').boundingBox())!;
  const box = (await clear.boundingBox())!;
  expect(Math.abs(box.x + box.width - (line.x + line.width))).toBeLessThan(2);
});

Then('there is no "× Clear" by the collections', async ({ page }) => {
  await expect(byCollectionClear(page)).toBeHidden();
});

When('I press "× Clear" by the collections', async ({ page }) => {
  await byCollectionClear(page).click();
});

When('I note where By collection is', async ({ page, scratch }) => {
  scratch.byCollection = await byCollection(page).boundingBox();
});

Then('By collection has not moved', async ({ page, scratch }) => {
  expect(await byCollection(page).boundingBox()).toEqual(scratch.byCollection);
});

// --- #3 Clock skew, and opening what can be opened -------------------------------

// From now on: the reads the page has already started (the chooser lists collections again as it shows) finish first.
Given("the server's clock is {int} minutes ahead of this computer", async ({ page, s3 }, minutes: number) => {
  await page.waitForLoadState('networkidle');
  s3.clockAheadMs = minutes * 60_000;
});

Given("the server doesn't say what time it is", async ({ s3 }) => {
  s3.hideDate = true;
});

When("the server's clock is right again", async ({ s3 }) => {
  s3.clockAheadMs = 0;
});

When('the uploads of "Bravo Flats" can be listed again', async ({ s3 }) => {
  s3.failures.delete(`Collections/${BRAVO.uuid}/Uploads/`);
});

Then('the opening panel offers {string}', async ({ page }, label: string) => {
  await expect(page.getByRole('region', { name: 'Opening' }).getByRole('button', { name: label, exact: true })).toBeVisible();
});

Then('the opening panel does not offer {string}', async ({ page }, label: string) => {
  await expect(page.getByRole('region', { name: 'Opening' }).getByRole('button', { name: new RegExp(`^${label}`) })).toHaveCount(0);
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

// --- #6 Location flags that explain themselves ----------------------------------

const locationRow = (page: Page, id: string) => tableRows(page).filter({ has: page.locator('td', { hasText: new RegExp(`^${id}$`) }) });
const flag = (page: Page, label: string, id: string) => locationRow(page, id).getByRole('button', { name: label, exact: true });

async function collectionCell(page: Page, id: string): Promise<Locator> {
  const index = (await columnLabels(page)).indexOf('Collection');
  expect(index).toBeGreaterThanOrEqual(0);
  return locationRow(page, id).locator('td').nth(index);
}

Then('the {string} flag of {string} explains {string}', async ({ page }, label: string, id: string, tip: string) => {
  const button = flag(page, label, id);
  await expect(button).toHaveAttribute('title', tip);
  await expect(button).toHaveAccessibleDescription(tip);
});

When('I press the {string} flag of {string}', async ({ page }, label: string, id: string) => {
  await flag(page, label, id).click();
});

Then('Data checks opens on {string}', async ({ page }, text: string) => {
  const item = popover(page, 'Data checks').locator('.dqlist li.focus');
  await expect(item).toContainText(text);
  await expect(item.getByRole('button')).toBeFocused();
});

Then('focus is back on the {string} flag of {string}', async ({ page }, label: string, id: string) => {
  await expect(flag(page, label, id)).toBeFocused();
});

Then('no flag reads {string}', async ({ page }, text: string) => {
  await expect(page.locator('#table .tag', { hasText: text })).toHaveCount(0);
});

Then('the Collection of {string} reads {string}, naming {string}', async ({ page }, id: string, text: string, names: string) => {
  const button = (await collectionCell(page, id)).getByRole('button');
  await expect(button).toHaveText(text);
  await expect(button).toHaveAttribute('title', names);
  await expect(button).toHaveAccessibleDescription(names);
});

When('I tap the Collection of {string}', async ({ page }, id: string) => {
  await (await collectionCell(page, id)).getByRole('button').click();
});

Then('a small list shows {string} and {string}', async ({ page }, a: string, b: string) => {
  await expect(popover(page, 'Collections here').locator('li')).toHaveText([a, b]);
});

// --- #7 Back after a row or data-check action ----------------------------------

Given('the screen is {int} pixels wide and {int} high', async ({ page }, width: number, height: number) => {
  await page.setViewportSize({ width, height });
});

When('I press {string} on the Locations row {string}', async ({ page, scratch }, label: string, id: string) => {
  // Where the page was at the click itself, however far it had to scroll to reach the row.
  await page.evaluate(() =>
    addEventListener('click', () => ((window as unknown as { clickedAt: number }).clickedAt = scrollY), { capture: true, once: true }),
  );
  await locationRow(page, id).getByRole('button', { name: label, exact: true }).click();
  scratch.scroll = await page.evaluate(() => (window as unknown as { clickedAt: number }).clickedAt);
});

Then("the table's controls offer {string} before the view switch", async ({ page }, label: string) => {
  const back = page.locator('#table .tbl-tools').getByRole('button', { name: label, exact: true });
  await expect(back).toBeVisible();
  const b = (await back.boundingBox())!;
  const seg = (await page.getByRole('group', { name: 'Show' }).boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(seg.x);
  expect(Math.abs(b.y + b.height / 2 - (seg.y + seg.height / 2))).toBeLessThan(2);
});

Then('the view switch shows {string}', async ({ page }, view: string) => {
  await expect(viewButton(page, view)).toHaveAttribute('aria-pressed', 'true');
});

Then('the page is back where it was', async ({ page, scratch }) => {
  expect(scratch.scroll).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scratch.scroll);
});
