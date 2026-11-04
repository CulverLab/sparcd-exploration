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
  popover,
  resetButton,
  settled,
  tableRows,
  viewButton,
} from './support/world';
import { ALPHA, addUpload } from './support/data';

// --- Filters --------------------------------------------------------------------

/** On a phone, the filters are in a sheet the Filters button opens. */
export async function openSheetIfPhone(page: Page) {
  const fb = page.locator('#filtersbtn');
  if ((await fb.getAttribute('aria-haspopup')) === 'dialog' && (await fb.getAttribute('aria-expanded')) !== 'true') await fb.click();
}

async function openFilter(page: Page, name: string) {
  await openSheetIfPhone(page);
  const button = filterButton(page, new RegExp(`^${name}`));
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
}

const FILTER_NAMES: Record<string, string> = {
  species: 'Species',
  locations: 'Locations',
  dates: 'Dates',
  area: 'Map area',
  files: 'Photo files',
  'mountain range': 'Mountain range',
  collections: 'Collections',
  elevation: 'Elevation',
};
const DIMS: Record<string, string> = {
  species: 'species',
  locations: 'locations',
  dates: 'dates',
  area: 'area',
  files: 'files',
  'mountain range': 'ranges',
  collections: 'collections',
  elevation: 'elevation',
};
/** A section, read even while the sidebar is hidden. */
const section = (page: Page, which: string) => page.locator(`#side .fsec[data-dim="${DIMS[which]}"]`);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  'the sidebar sections read {string}, {string}, {string}, {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string, d: string, e: string, f: string) => {
    await expect(filterBar(page).locator('.fsec-label')).toHaveText([a, b, c, d, e, f]);
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

When(/^I open the (species|locations|mountain range|collections|dates|elevation) filter$/, async ({ page }, filter: string) => {
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

When(/^I close the (species|locations|mountain range|collections) filter with its button$/, async ({ page }, filter: string) => {
  const button = filterButton(page, new RegExp(`^${FILTER_NAMES[filter]}`));
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await button.click();
  await expect(popover(page, FILTER_NAMES[filter])).toHaveCount(0);
});

When(/^I press "(Select all|Clear all|Select matches|Clear matches)" in the (species|locations|mountain range|collections) filter$/, async ({ page }, label: string, filter: string) => {
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

Then('the species filter lists, in order, {string}', async ({ page }, list: string) => {
  await expect(popover(page, 'Species').locator('.opt .t')).toHaveText(list.split(', '));
});

Then('the mountain range filter lists {string}', async ({ page }, list: string) => {
  await expect(popover(page, 'Mountain range').locator('.opt .t')).toHaveText(list.split(', '));
});

Then('the mountain range filter counts {string} for {string}', async ({ page }, count: string, range: string) => {
  await expect(popover(page, 'Mountain range').locator('.opt').filter({ hasText: range }).locator('.c')).toHaveText(count);
});

Then('the locations filter lists {string}', async ({ page }, list: string) => {
  await expect(popover(page, 'Locations').locator('.opt .t .mono')).toHaveText(list.split(', '));
});

Then('the locations filter offers no Only button', async ({ page }) => {
  await expect(popover(page, 'Locations').locator('.opt')).toHaveCount(1);
  await expect(popover(page, 'Locations').locator('.opt .only')).toHaveCount(0);
});

Then(/^"(.*)" (shows|does not show) at zero in the species filter$/, async ({ page }, item: string, shows: string) => {
  const { row } = pickerRow(page, 'species', item);
  await (shows === 'shows' ? expect(row).toHaveClass(/\bzero\b/) : expect(row).not.toHaveClass(/\bzero\b/));
});

Then('the species filter offers {string} and {string}', async ({ page }, a: string, b: string) => {
  for (const label of [a, b]) await expect(popover(page, 'Species').getByRole('button', { name: label, exact: true })).toBeVisible();
});

Then(/^the (species|locations|mountain range|dates|elevation) section reads "(.*)"$/, async ({ page }, which: string, text: string) => {
  await expect(section(page, which).locator('.fsec-value')).toHaveText(text);
});

Then('the dates picker lists the years {string}', async ({ page }, list: string) => {
  await expect(popover(page, 'Dates').locator('.yearchips button b')).toHaveText(list.split(', '));
});

Then('the months of the dates filter run from {string} to {string}', async ({ page }, min: string, max: string) => {
  for (const label of ['From', 'To']) {
    const field = popover(page, 'Dates').getByLabel(label, { exact: true });
    await expect(field).toHaveAttribute('min', min);
    await expect(field).toHaveAttribute('max', max);
  }
});

Then(/^the year (\d+) is (disabled|enabled) in the Dates section$/, async ({ page }, year: string, state: string) => {
  const button = filterBar(page).getByRole('group', { name: 'Years' }).getByRole('button', { name: year, exact: true });
  await (state === 'disabled' ? expect(button).toBeDisabled() : expect(button).toBeEnabled());
});

Then('the elevation filter spans {string} to {string}', async ({ page }, lo: string, hi: string) => {
  await expect(popover(page, 'Elevation').locator('p.fine').first()).toHaveText(`Spans ${lo} to ${hi}`);
});

When('I set the lowest elevation to {int}', async ({ page }, metres: number) => {
  await popover(page, 'Elevation').getByLabel('Lowest').fill(String(metres));
});

Then('the elevation filter says {string}', async ({ page }, text: string) => {
  await expect(popover(page, 'Elevation').getByText(text, { exact: true })).toBeVisible();
});

Then('the elevation filter says nothing is left out', async ({ page }) => {
  await expect(popover(page, 'Elevation').getByText('left out')).toHaveCount(0);
});

When('I press the {string} button in the elevation filter', async ({ page }, label: string) => {
  await popover(page, 'Elevation').getByRole('button', { name: label, exact: true }).click();
});

Then('the species filter lists {string} first, apart from the species', async ({ page }, item: string) => {
  const first = popover(page, 'Species').locator('.opt').first();
  await expect(first).toHaveClass(/apart/);
  await expect(first.getByRole('button', { name: `Only ${item}`, exact: true })).toBeAttached();
});

/** "Species: Bobcat" is the Species section on, reading "Bobcat" (in either case); "Species" alone is the section off. */
Then(
  /^the (species|dates|locations|area|files|mountain range|collections) filter reads "(.*)"$/,
  async ({ page }, which: string, label: string) => {
    const sec = section(page, which);
    const at = label.indexOf(': ');
    if (at < 0) {
      await expect(sec).not.toHaveClass(/\bon\b/);
      return;
    }
    await expect(sec).toHaveClass(/\bon\b/);
    await expect(sec.locator('.fsec-value')).toHaveText(new RegExp(`^${escapeRe(label.slice(at + 2))}$`, 'i'));
  },
);

When(/^I clear the (Collections|Species|Area|Locations|Files|Dates) filter with its ×$/, async ({ page }, name: string) => {
  await openSheetIfPhone(page);
  await page.getByRole('button', { name: `Clear ${FILTER_NAMES[name.toLowerCase()]} filter` }).click();
});

When('I press the year {int} in the Dates section', async ({ page }, year: number) => {
  await filterBar(page).getByRole('group', { name: 'Years' }).getByRole('button', { name: String(year), exact: true }).click();
});

Then("Undo has taken Reset's place, with the focus on it", async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeFocused();
  await expect(resetButton(page)).toHaveCount(0);
});

Then('"Reset filters" is back in its place', async ({ page }) => {
  await expect(resetButton(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
});

// --- Layout -----------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };
const LAYOUT_PARTS = ['#figures', '#map', '#table .tbl-head'];
const boxes = (page: Page) => Promise.all(LAYOUT_PARTS.map(async (sel) => (await page.locator(sel).boundingBox())!));

When("I note where the figures, the map and the tables' tab row are", async ({ page, scratch }) => {
  await page.evaluate(() => scrollTo(0, 0));
  scratch.boxes = await boxes(page);
});

Then("the figures, the map and the tables' tab row have not moved", async ({ page, scratch }) => {
  const before = scratch.boxes as Box[];
  const now = await boxes(page);
  now.forEach((b, i) => {
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(b[k] - before[i][k]), `${LAYOUT_PARTS[i]} ${k}`).toBeLessThanOrEqual(1);
  });
});

Then("the figures, the map and the tables' tab row are only wider", async ({ page, scratch }) => {
  const before = scratch.boxes as Box[];
  await expect.poll(async () => Math.round((await page.locator('#map').boundingBox())!.x)).toBeLessThan(before[1].x - 200);
  // Once the sidebar has slid shut.
  await page.waitForTimeout(250);
  const now = await boxes(page);
  now.forEach((b, i) => {
    expect(Math.abs(b.y - before[i].y), `${LAYOUT_PARTS[i]} top`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - before[i].height), `${LAYOUT_PARTS[i]} height`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x + b.width - (before[i].x + before[i].width)), `${LAYOUT_PARTS[i]} right edge`).toBeLessThanOrEqual(1);
    expect(b.width, `${LAYOUT_PARTS[i]} width`).toBeGreaterThan(before[i].width + 200);
  });
});

When(/^I (hide|show) the sidebar$/, async ({ page }, verb: string) => {
  const fb = page.locator('#filtersbtn');
  await expect(fb).toHaveAttribute('aria-pressed', verb === 'hide' ? 'true' : 'false');
  await fb.click();
  // Once it has slid in or out.
  await (verb === 'hide' ? expect(filterBar(page)).toBeHidden() : expect(filterBar(page)).toBeVisible());
});

Then(/^the sidebar is (hidden|shown)$/, async ({ page }, state: string) => {
  await expect(page.locator('#filtersbtn')).toHaveAttribute('aria-pressed', state === 'shown' ? 'true' : 'false');
  await (state === 'shown' ? expect(filterBar(page)).toBeVisible() : expect(filterBar(page)).toBeHidden());
});

Then('the Filters button counts {int} on, named {string}', async ({ page }, n: number, name: string) => {
  const fb = page.locator('#filtersbtn');
  await expect(fb.locator('.n')).toHaveText(String(n));
  await expect(fb).toHaveAccessibleName(name);
});

Then('"Reset filters" sits right after the Filters button', async ({ page }) => {
  const fb = (await page.locator('#filtersbtn').boundingBox())!;
  const reset = (await resetButton(page).boundingBox())!;
  expect(reset.x - (fb.x + fb.width)).toBeGreaterThan(0);
  expect(reset.x - (fb.x + fb.width)).toBeLessThan(16);
  expect(Math.abs(reset.y + reset.height / 2 - (fb.y + fb.height / 2))).toBeLessThanOrEqual(1);
});

When('I open the Filters sheet', async ({ page }) => {
  await page.locator('#filtersbtn').click();
  await expect(filterBar(page)).toBeVisible();
});

Then("the sheet's button reads {string}", async ({ page }, label: string) => {
  await expect(filterBar(page).locator('.sheetfoot button')).toHaveText(label);
});

Then('the Filters sheet is closed', async ({ page }) => {
  await expect(filterBar(page)).toBeHidden();
  await expect(page.locator('#filtersbtn')).toHaveAttribute('aria-expanded', 'false');
});

When('Undo runs out', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0, { timeout: 10_000 });
});

Then('the focus is on the Filters button', async ({ page }) => {
  await expect(page.locator('#filtersbtn')).toBeFocused();
});

Then('the focus is on the Species section', async ({ page }) => {
  await expect(filterButton(page, 'Species')).toBeFocused();
});

const inert = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).inert);

Then('only the Filters sheet takes the focus', async ({ page }) => {
  expect([await inert(page, '#sticky-top'), await inert(page, '#main'), await inert(page, '#side')]).toEqual([true, true, false]);
});

Then('only the Species picker takes the focus', async ({ page }) => {
  await expect(popover(page, 'Species')).toBeVisible();
  expect([await inert(page, '#sticky-top'), await inert(page, '#main'), await inert(page, '#side')]).toEqual([true, true, true]);
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

When(/^I enter "(.*)" as (From|To) in the dates filter$/, async ({ page }, month: string, end: string) => {
  await openFilter(page, 'Dates');
  await popover(page, 'Dates').getByLabel(end, { exact: true }).fill(month);
});

When('I type the year {string} into To in the dates filter', async ({ page }, year: string) => {
  await popover(page, 'Dates').getByLabel('To', { exact: true }).focus();
  // From the month part to the year part, which reads 0002, 0020, 0202, 2025 as it is typed.
  await page.keyboard.press('Tab');
  await page.keyboard.type(year, { delay: 30 });
});

When('I press the year {int} in the dates picker', async ({ page }, year: number) => {
  await openFilter(page, 'Dates');
  await popover(page, 'Dates').getByRole('button', { name: new RegExp(`^${year}`) }).click();
});

Then('the From and To of the dates filter are empty', async ({ page }) => {
  await expect(popover(page, 'Dates').getByLabel('From', { exact: true })).toHaveValue('');
  await expect(popover(page, 'Dates').getByLabel('To', { exact: true })).toHaveValue('');
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

Then('the page does not scroll sideways', async ({ page }) => {
  // Once the layout has followed a resize: the effort strip and the map measure their boxes a frame later.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
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

Then('the Photos switch reads {string}', async ({ page }, which: string) => {
  await expect(page.getByRole('group', { name: 'Tagged' }).getByRole('button', { name: which, exact: true })).toHaveAttribute('aria-pressed', 'true');
});

Then('every row reads {string}', async ({ page }, text: string) => {
  for (const value of await columnValues(page, 'Species')) expect(value).toBe(text);
});

Then(/^the Locations table (has|has no) a? ?"(.*)" column$/, async ({ page }, has: string, label: string) => {
  expect((await columnLabels(page)).includes(label)).toBe(has === 'has');
});

Then('the sidebar has a {string} section', async ({ page }, name: string) => {
  await expect(filterButton(page, name)).toBeVisible();
});

Then('the sidebar has no {string} section', async ({ page }, name: string) => {
  await expect(filterButton(page, name)).toHaveCount(0);
});

Then('the figures list photos by collection', async ({ page }) => {
  const line = page.getByRole('group', { name: 'By collection' });
  await expect(line.locator(':scope > .bc-k')).toHaveText('By collection');
  await expect(line.locator(':scope > .bc-item')).toHaveCount(2);
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

const locationRow = (page: Page, id: string) => tableRows(page).filter({ has: page.locator('td', { hasText: new RegExp(`^${escapeRe(id)}$`) }) });

Then("the table's count reads {string}", async ({ page }, text: string) => {
  await expect(page.locator('#table .rowcount')).toHaveText(text);
});

Then('the row {string} is not dimmed', async ({ page }, id: string) => {
  await expect(locationRow(page, id)).not.toHaveClass(/\bnomatch\b/);
});

Then('the row {string} is dimmed, with {string} disabled', async ({ page }, id: string, action: string) => {
  await expect(locationRow(page, id)).toHaveClass(/\bnomatch\b/);
  await expect(locationRow(page, id).getByRole('button', { name: action })).toBeDisabled();
});

Then('the first row is {string}', async ({ page }, id: string) => {
  expect((await columnValues(page, 'Location ID'))[0]).toBe(id);
});

// --- Data checks ----------------------------------------------------------------

/** The quiet item in the top bar's status: "3 data checks", or "No data problems". */
export const checksButton = (page: Page) => page.getByRole('button', { name: /data checks?$|^No data problems$/ });

When('I open Data checks', async ({ page }) => {
  await checksButton(page).click();
  await expect(popover(page, 'Data checks')).toBeVisible();
});

Then('Data checks shows {int} problems', async ({ page }, n: number) => {
  await expect(popover(page, 'Data checks').locator('.dqlist li')).toHaveCount(n);
  await expect(checksButton(page)).toHaveText(`${n} data check${n === 1 ? '' : 's'}`);
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
  const sw = popover(page, 'Data checks').getByRole('switch', { name: label });
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
});

// --- Sticky bar -----------------------------------------------------------------

When('I scroll down to the table', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.evaluate(() => scrollTo(0, document.getElementById('table')!.offsetTop + 40));
});

Then('the top bar and the sidebar are still in view', async ({ page }) => {
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  // The top bar's top edge sits exactly at the viewport's top, and the sidebar right under it.
  await expect.poll(async () => Math.round((await page.locator('#sticky-top').boundingBox())!.y)).toBe(0);
  const header = (await page.locator('header.top').boundingBox())!;
  const side = (await filterBar(page).boundingBox())!;
  expect(Math.abs(side.y - (header.y + header.height))).toBeLessThan(2);
  await expect(resetButton(page)).toBeInViewport();
});

const tools = (page: Page) => page.locator('#table .tbl-head');

When("I note the height of the table's controls", async ({ page, scratch }) => {
  scratch.toolsHeight = (await tools(page).boundingBox())!.height;
});

When('I scroll far down the table', async ({ page }) => {
  await page.evaluate(() => scrollTo(0, document.getElementById('table')!.getBoundingClientRect().top + scrollY + 2500));
});

Then(/^the table's controls sit just under (?:it|the top bar), on one line$/, async ({ page, scratch }) => {
  const bar = (await page.locator('#sticky-top').boundingBox())!;
  await expect.poll(async () => Math.abs(Math.round((await tools(page).boundingBox())!.y - (bar.y + bar.height)))).toBeLessThan(2);
  const box = (await tools(page).boundingBox())!;
  // The tabs, and the tools beside them rather than wrapped under them.
  expect(box.height).toBeLessThan(80);
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

Then('the table shows each location ID separately', async ({ page }) => {
  await expect(page.locator('#table').getByRole('switch', { name: 'Show each location ID separately' })).toHaveAttribute('aria-checked', 'true');
});
