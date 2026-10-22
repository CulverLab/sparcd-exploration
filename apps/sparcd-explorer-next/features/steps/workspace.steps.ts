// Filters, tables, Columns, Display and Data checks in the workspace.

import type { Page } from '@playwright/test';
import {
  APP_URL,
  Given,
  Then,
  When,
  columnLabels,
  columnValues,
  expect,
  filterBar,
  filterButton,
  headerCells,
  openCollections,
  photoCount,
  popover,
  resetButton,
  settled,
  tableRows,
  viewButton,
} from './support/world';
import { ALPHA, addUpload } from './support/data';

// --- Filters --------------------------------------------------------------------

async function openFilter(page: Page, name: string) {
  const button = filterButton(page, new RegExp(`^${name}`));
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
}

const FILTER_NAMES: Record<string, string> = {
  species: 'Species',
  locations: 'Locations',
  dates: 'Dates',
  area: 'Area',
  files: 'Files',
  'mountain range': 'Mountain range',
  collections: 'Collections',
};

/** A picker row: its checkbox, and the Only button that shows as the pointer rests on it. */
function pickerRow(page: Page, filter: string, item: string) {
  const name = FILTER_NAMES[filter];
  const row = popover(page, name)
    .locator('.opt')
    .filter({ has: page.getByRole('button', { name: `Only ${item}`, exact: true }) });
  return { row, box: row.getByRole('checkbox'), only: row.getByRole('button', { name: `Only ${item}`, exact: true }) };
}

async function pressOnly(page: Page, filter: string, item: string) {
  await openFilter(page, FILTER_NAMES[filter]);
  const { row, only } = pickerRow(page, filter, item);
  await row.hover();
  await expect(only).toHaveCSS('opacity', '1');
  await only.click();
}

Then(
  'the filter buttons read {string}, {string}, {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string, d: string, e: string) => {
    await expect(filterBar(page).locator('.fbtn')).toHaveText([a, b, c, d, e]);
  },
);

Then('{string} is disabled', async ({ page }, label: string) => {
  await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
});

When('I filter species to {string}', async ({ page }, species: string) => {
  await pressOnly(page, 'species', species);
  await page.keyboard.press('Escape');
});

When('I also pick {string} in the species filter', async ({ page }, species: string) => {
  await openFilter(page, 'Species');
  await pickerRow(page, 'species', species).box.check();
  await page.keyboard.press('Escape');
});

When('I hide the species {string}', async ({ page }, species: string) => {
  await openFilter(page, 'Species');
  await pickerRow(page, 'species', species).box.uncheck();
  await page.keyboard.press('Escape');
});

When(/^I open the (species|locations|mountain range|collections) filter$/, async ({ page }, filter: string) => {
  await openFilter(page, FILTER_NAMES[filter]);
});

When(/^I press Only on "(.*)" in the (species|locations|mountain range|collections) filter$/, async ({ page }, item: string, filter: string) => {
  await pressOnly(page, filter, item);
});

When(/^I (tick|untick) "(.*)" in the (species|locations|mountain range|collections) filter$/, async ({ page }, verb: string, item: string, filter: string) => {
  await openFilter(page, FILTER_NAMES[filter]);
  const { box } = pickerRow(page, filter, item);
  await (verb === 'tick' ? box.check() : box.uncheck());
});

When(/^I press "(Select all|Clear all)" in the (species|locations|mountain range|collections) filter$/, async ({ page }, label: string, filter: string) => {
  await popover(page, FILTER_NAMES[filter]).getByRole('button', { name: label, exact: true }).click();
});

const speciesSearch = (page: Page) => popover(page, 'Species').getByRole('searchbox', { name: 'Search species' });
const speciesSearchClear = (page: Page) => popover(page, 'Species').getByRole('button', { name: 'Clear search', exact: true });

When('I search the species filter for {string}', async ({ page }, text: string) => {
  await speciesSearch(page).fill(text);
});

Then('the species search has no "Clear search" button', async ({ page }) => {
  await expect(speciesSearchClear(page)).toHaveCount(0);
});

Then('the species search shows "Clear search", at least 28 pixels square', async ({ page }) => {
  await expect(speciesSearchClear(page)).toBeVisible();
  const box = (await speciesSearchClear(page).boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(28);
});

When('I press "Clear search" in the species filter', async ({ page }) => {
  await speciesSearchClear(page).click();
});

Then('the species search is empty, with the cursor in it', async ({ page }) => {
  await expect(speciesSearch(page)).toHaveValue('');
  await expect(speciesSearch(page)).toBeFocused();
});

Then('the species filter is closed', async ({ page }) => {
  await expect(popover(page, 'Species')).toHaveCount(0);
});

Then(/^every row of the (species|locations) filter is ticked$/, async ({ page }, filter: string) => {
  const boxes = popover(page, FILTER_NAMES[filter]).getByRole('checkbox');
  expect(await boxes.count()).toBeGreaterThan(1);
  for (const box of await boxes.all()) await expect(box).toBeChecked();
});

Then(/^"(.*)" is (ticked|unticked) in the (species|locations) filter$/, async ({ page }, item: string, state: string, filter: string) => {
  const { box } = pickerRow(page, filter, item);
  await (state === 'ticked' ? expect(box).toBeChecked() : expect(box).not.toBeChecked());
});

Then('the species filter lists {string} first, apart from the species', async ({ page }, item: string) => {
  const first = popover(page, 'Species').locator('.opt').first();
  await expect(first).toHaveClass(/apart/);
  await expect(first.getByRole('button', { name: `Only ${item}`, exact: true })).toBeAttached();
});

Then(/^the (species|dates|locations|area|files|mountain range) filter reads "(.*)"$/, async ({ page }, which: string, label: string) => {
  await expect(filterBar(page).locator('.fbtn').filter({ hasText: new RegExp(`^${FILTER_NAMES[which]}`) })).toHaveText(label);
});

When(/^I clear the (Collections|Species|Area|Locations|Files|Dates) filter with its ×$/, async ({ page }, name: string) => {
  await page.getByRole('button', { name: `Clear ${name} filter` }).click();
});

When('I press Escape', async ({ page }) => {
  await page.keyboard.press('Escape');
});

Then('each check has exactly one button', async ({ page }) => {
  const counts = await popover(page, 'Data checks')
    .locator('.dqlist li')
    .evaluateAll((items) => items.map((li) => li.querySelectorAll('button').length));
  expect(counts.length).toBeGreaterThan(0);
  expect(counts.every((n) => n === 1)).toBe(true);
});

When('I pick the year {int} in the dates filter', async ({ page }, year: number) => {
  await openFilter(page, 'Dates');
  await popover(page, 'Dates').getByRole('button', { name: new RegExp(`^${year}`) }).click();
  await page.keyboard.press('Escape');
});

When('I press {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: label, exact: true }).first().click();
});

Then('I see the note {string} with Undo', async ({ page }, note: string) => {
  const toast = page.getByRole('status').filter({ hasText: note });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
});

Then('there is no note', async ({ page }) => {
  await expect(page.locator('.toast')).toHaveCount(0);
});

When('I filter locations to {string}', async ({ page }, id: string) => {
  await pressOnly(page, 'locations', id);
  await page.keyboard.press('Escape');
});

When('I press Undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Undo' }).click();
});

Then('the table says {string}', async ({ page }, text: string) => {
  await expect(page.locator('#table')).toContainText(text);
});

When('I press the big {string} button', async ({ page }, label: string) => {
  await page.locator('#table .empty').getByRole('button', { name: label }).click();
});

Given('the screen is {int} pixels wide', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 860 });
});

Then('the filter bar is one line high', async ({ page }) => {
  const tops = await filterBar(page).locator('.fb').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
  const bar = await page.locator('.filterbar').boundingBox();
  expect(bar!.height).toBeLessThan(60);
});

Then('the page does not scroll sideways', async ({ page }) => {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
});

Then('the reset button reads {string}', async ({ page }, label: string) => {
  await expect(resetButton(page)).toHaveAccessibleName(label);
});

Then('the photo count is hidden', async ({ page }) => {
  await expect(photoCount(page)).toBeHidden();
});

// --- Tables ---------------------------------------------------------------------

When(/^I show the (Locations|Species|Photos) table$/, async ({ page }, view: string) => {
  await viewButton(page, view).click();
  if (view === 'Photos') await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'List' }).click();
});

Then(
  'the Locations table lists {string}, {string}, {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string, d: string, e: string) => {
    expect((await columnValues(page, 'Location ID')).sort()).toEqual([a, b, c, d, e].sort());
  },
);

Then('the row {string} reads {string} and is flagged', async ({ page }, id: string, name: string) => {
  const row = tableRows(page).filter({ has: page.locator('td', { hasText: new RegExp(`^${id}$`) }) });
  await expect(row).toHaveClass(/flag/);
  await expect(row.locator('td').first()).toContainText(name);
});

Then(
  'the {string} column lists {string}, {string}, {string} and {string}',
  async ({ page }, column: string, a: string, b: string, c: string, d: string) => {
    await expect.poll(async () => (await columnValues(page, column)).sort()).toEqual([a, b, c, d].sort());
  },
);

Then('the {string} column lists {string}', async ({ page }, column: string, value: string) => {
  expect(await columnValues(page, column)).toContain(value);
});

Then(/^the (?:Locations|Photos) table has (\d+) rows$/, async ({ page }, n: string) => {
  await expect(tableRows(page)).toHaveCount(Number(n));
});

Then("one photo's species read {string} with count {int}", async ({ page }, species: string, count: number) => {
  const species_ = await columnValues(page, 'Species');
  const counts = await columnValues(page, 'Count');
  expect(counts[species_.indexOf(species)]).toBe(String(count));
});

When('I show only untagged photos', async ({ page }) => {
  await page.getByRole('group', { name: 'Tagged' }).getByRole('button', { name: 'Untagged' }).click();
});

When('I choose {string} in the Photos switch', async ({ page }, which: string) => {
  await page.getByRole('group', { name: 'Tagged' }).getByRole('button', { name: which, exact: true }).click();
});

Then('every row reads {string}', async ({ page }, text: string) => {
  for (const value of await columnValues(page, 'Species')) expect(value).toBe(text);
});

Then(/^the Locations table (has|has no) a? ?"(.*)" column$/, async ({ page }, has: string, label: string) => {
  expect((await columnLabels(page)).includes(label)).toBe(has === 'has');
});

Then('the filter bar has a {string} filter', async ({ page }, name: string) => {
  await expect(filterButton(page, name)).toBeVisible();
});

Then('the filter bar has no {string} filter', async ({ page }, name: string) => {
  await expect(filterButton(page, name)).toHaveCount(0);
});

Then('{string} lists photos by collection', async ({ page }, region: string) => {
  const inView = page.getByRole('region', { name: region });
  await expect(inView.getByText('By collection')).toBeVisible();
  await expect(inView.locator('table.bc tbody tr')).toHaveCount(2);
});

// --- Columns and Display --------------------------------------------------------

When('I open the Columns editor', async ({ page }) => {
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
});

When(/^I (hide|show) the "(.*)" column$/, async ({ page }, verb: string, label: string) => {
  const box = page.getByRole('dialog', { name: /^Columns/ }).getByRole('checkbox', { name: label, exact: true });
  await box.setChecked(verb === 'show');
});

When('I move {string} up', async ({ page }, label: string) => {
  await page.getByRole('button', { name: `Move ${label} up` }).click();
});

When('I reset the columns to default', async ({ page }) => {
  await page.getByRole('button', { name: 'Reset to default' }).click();
});

Then('the columns read {string}', async ({ page }, list: string) => {
  await page.keyboard.press('Escape');
  expect(await columnLabels(page)).toEqual(list.split(', '));
});

When('I reload and reopen {string}', async ({ page }, name: string) => {
  await page.goto(APP_URL);
  await openCollections(page, name);
});

When('I switch the display to UTM', async ({ page }) => {
  await page.getByRole('button', { name: 'Display' }).click();
  await popover(page, 'Display').getByRole('button', { name: 'UTM' }).click();
  await page.keyboard.press('Escape');
});

When('I set the precision to {int} decimals', async ({ page }, digits: number) => {
  await page.getByRole('button', { name: 'Display' }).click();
  await popover(page, 'Display').getByLabel('Decimals').selectOption(String(digits));
  await page.keyboard.press('Escape');
});

When('I show the {string} and {string} columns', async ({ page }, a: string, b: string) => {
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /^Columns/ });
  await editor.getByRole('checkbox', { name: a, exact: true }).check();
  await editor.getByRole('checkbox', { name: b, exact: true }).check();
  await page.keyboard.press('Escape');
});

Then('every easting and northing is a plain whole number', async ({ page }) => {
  const values = [...(await columnValues(page, 'Easting')), ...(await columnValues(page, 'Northing'))].filter((v) => v !== '—');
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) expect(v).toMatch(/^\d+$/);
});

When('I set the precision method to {string}', async ({ page }, method: string) => {
  await page.getByRole('button', { name: 'Display' }).click();
  await popover(page, 'Display').getByRole('group', { name: 'Precision method' }).getByRole('button', { name: method }).click();
  await page.keyboard.press('Escape');
});

async function cellOf(page: Page, id: string, column: string): Promise<string> {
  const ids = await columnValues(page, 'Location ID');
  expect(ids).toContain(id);
  return (await columnValues(page, column))[ids.indexOf(id)];
}

Then('the Coordinates of {string} read {string}', async ({ page }, id: string, text: string) => {
  await expect.poll(() => cellOf(page, id, 'Coordinates')).toBe(text);
});

Then('the Easting and Northing of {string} read {string} and {string}', async ({ page }, id: string, e: string, n: string) => {
  await expect.poll(async () => [await cellOf(page, id, 'Easting'), await cellOf(page, id, 'Northing')]).toEqual([e, n]);
});

When(/^I sort by "(.*)"(?: again)?$/, async ({ page }, label: string) => {
  await page.locator('#table thead').getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await settled(page);
});

Then('the first row is {string}', async ({ page }, id: string) => {
  expect((await columnValues(page, 'Location ID'))[0]).toBe(id);
});

// --- Data checks ----------------------------------------------------------------

When('I open Data checks', async ({ page }) => {
  await page.getByRole('button', { name: /^Data checks/ }).click();
  await expect(popover(page, 'Data checks')).toBeVisible();
});

Then('Data checks shows {int} problems', async ({ page }, n: number) => {
  await expect(popover(page, 'Data checks').locator('.dqlist li')).toHaveCount(n);
  await expect(page.getByRole('button', { name: /^Data checks/ })).toContainText(String(n));
});

When('I press {string} in Data checks', async ({ page }, label: string) => {
  await popover(page, 'Data checks').getByRole('button', { name: label, exact: true }).click();
});

Given('{string} has photos at {string} in one upload and {string} in another', async ({ s3 }, name: string, one: string, other: string) => {
  expect(name).toBe('Alpha Basin');
  const at = (stamp: string, id: string, files: string[]) =>
    addUpload(s3, ALPHA, {
      stamp,
      deployment: { id, name: 'Pine Pass', lat: 0.59, lon: -150.24, elevation: 1150 },
      photos: files.map((file, i) => ({ file, time: `2025-09-1${i}T07:00:00` })),
    });
  at('2025.10.01.10.00.00_fielduser', one, ['IMG2601.JPG']);
  at('2025.10.02.10.00.00_fielduser', other, ['IMG2602.JPG', 'IMG2603.JPG']);
});

Then('the Locations table lists {string} once, and no {string}', async ({ page }, id: string, other: string) => {
  await expect.poll(async () => (await columnValues(page, 'Location ID')).filter((v) => v === id || v === other)).toEqual([id]);
});

When('I switch on {string}', async ({ page }, label: string) => {
  const sw = page.getByRole('switch', { name: label });
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
});

// --- Sticky bar -----------------------------------------------------------------

When('I scroll down to the table', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.evaluate(() => scrollTo(0, document.getElementById('table')!.offsetTop + 40));
});

Then('the filter bar is still at the top of the screen', async ({ page }) => {
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  // The header block's top edge sits exactly at the viewport's top, and the bar right under the header.
  await expect.poll(async () => Math.round((await page.locator('#sticky-top').boundingBox())!.y)).toBe(0);
  const header = (await page.locator('header.top').boundingBox())!;
  const bar = (await page.locator('.filterbar').boundingBox())!;
  expect(Math.abs(bar.y - (header.y + header.height))).toBeLessThan(2);
  await expect(page.locator('.filterbar')).toBeInViewport();
});

const tools = (page: Page) => page.locator('#table .tbl-head');

When("I note the height of the table's controls", async ({ page, scratch }) => {
  scratch.toolsHeight = (await tools(page).boundingBox())!.height;
});

When('I scroll far down the table', async ({ page }) => {
  await page.evaluate(() => scrollTo(0, document.getElementById('table')!.getBoundingClientRect().top + scrollY + 2500));
});

Then(/^the table's controls sit just under (?:it|the filter bar), on one line$/, async ({ page, scratch }) => {
  const bar = (await page.locator('#sticky-top').boundingBox())!;
  await expect.poll(async () => Math.abs(Math.round((await tools(page).boundingBox())!.y - (bar.y + bar.height)))).toBeLessThan(2);
  const box = (await tools(page).boundingBox())!;
  expect(box.height).toBeLessThan(60);
  if (scratch.toolsHeight !== undefined) expect(box.height).toBe(scratch.toolsHeight);
  await expect(tools(page).getByRole('button', { name: 'Export CSV' })).toBeInViewport();
});

When("I note where the table's controls are", async ({ page, scratch }) => {
  scratch.toolsAt = (await tools(page).boundingBox())!.y;
});

Then("the table's controls have not moved", async ({ page, scratch }) => {
  await expect.poll(async () => Math.round((await tools(page).boundingBox())!.y)).toBe(Math.round(scratch.toolsAt as number));
});

Then("the table's column headers sit just under the table's controls", async ({ page }) => {
  await expect
    .poll(async () => {
      const box = (await tools(page).boundingBox())!;
      return Math.abs(Math.round((await headerCells(page).first().boundingBox())!.y - (box.y + box.height)));
    })
    .toBeLessThan(4);
});
