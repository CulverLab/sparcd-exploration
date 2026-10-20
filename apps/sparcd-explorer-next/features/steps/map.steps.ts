// The map, the effort strip and the In view summary.

import type { Locator, Page } from '@playwright/test';
import { Then, When, expect, tableRows } from './support/world';

// --- Map ------------------------------------------------------------------------

/** Sends one wheel event over the map's centre; true when the page was left to handle it. */
async function wheelOverMap(page: Page, opts: { ctrlKey: boolean; deltaY: number }): Promise<boolean> {
  const map = page.locator('.leafmap');
  await expect(map).toHaveAttribute('data-zoom', /\d/);
  await map.evaluate((el) => ((el as HTMLElement).dataset.zoomBefore = (el as HTMLElement).dataset.zoom));
  return map.evaluate((el, o) => {
    const r = el.getBoundingClientRect();
    const e = new WheelEvent('wheel', { ...o, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
    return el.dispatchEvent(e);
  }, opts);
}

let pageHandledWheel = true;
const zoomOf = (page: Page) =>
  page.locator('.leafmap').evaluate((el) => ({ before: Number((el as HTMLElement).dataset.zoomBefore), now: Number((el as HTMLElement).dataset.zoom) }));

When('I pinch to zoom in over the map', async ({ page }) => {
  // A trackpad pinch arrives as a wheel event with ctrlKey set.
  pageHandledWheel = await wheelOverMap(page, { ctrlKey: true, deltaY: -60 });
});

When('I scroll over the map without pinching', async ({ page }) => {
  pageHandledWheel = await wheelOverMap(page, { ctrlKey: false, deltaY: 60 });
});

Then('the map is zoomed in', async ({ page }) => {
  await expect.poll(async () => { const z = await zoomOf(page); return z.now - z.before; }).toBeGreaterThan(0);
});

Then('the map is not zoomed', async ({ page }) => {
  const z = await zoomOf(page);
  expect(z.now).toBe(z.before);
});

Then('the browser did not zoom the page', () => {
  expect(pageHandledWheel, 'the pinch was kept from the browser').toBe(false);
});

Then('the browser scrolled the page as usual', () => {
  expect(pageHandledWheel, 'the plain scroll was left to the browser').toBe(true);
});

Then('a hint over the map reads {string}', async ({ page }, text: string) => {
  await expect(page.locator('.map-hint')).toHaveText(text);
});

const hexNote = (page: Page) => page.locator('.leaflet-tooltip.maptip');
const mapClear = (page: Page) => page.getByRole('button', { name: 'Clear map selection' });

/** The hex whose label lists exactly this location ID among its IDs. */
async function hexOf(page: Page, id: string): Promise<Locator> {
  const labels = await page.locator('path.hx').evaluateAll((paths) => paths.map((p) => p.getAttribute('aria-label') ?? ''));
  const i = labels.findIndex((l) => l.split(':')[0].split(', ').includes(id));
  expect(i, `hex holding ${id}`).toBeGreaterThanOrEqual(0);
  return page.locator('path.hx').nth(i);
}

Then('the map shows hexes with the counts {string} and {string}', async ({ page }, a: string, b: string) => {
  await expect
    .poll(async () => (await page.locator('.hexlabel:not(.out) span').allInnerTexts()).sort())
    .toEqual([a, b].sort());
});

When('I hover the hex holding {string}', async ({ page }, id: string) => {
  await (await hexOf(page, id)).hover();
});

Then('the hex note says {string}', async ({ page }, text: string) => {
  await expect(hexNote(page).locator('b').first()).toHaveText(text);
});

Then(
  'the hex note lists {string} {string} with {int} photos and {int} detections',
  async ({ page }, id: string, name: string, photos: number, detections: number) => {
    const row = hexNote(page).locator('tr').filter({ has: page.locator('td.m', { hasText: new RegExp(`^${id}$`) }) });
    await expect(row.locator('td')).toHaveText([id, name, String(photos), String(detections)]);
  },
);

When('I click the hex holding {string}', async ({ page }, id: string) => {
  await (await hexOf(page, id)).click();
});

Then('the hex holding {string} is outlined as selected', async ({ page }, id: string) => {
  const hex = await hexOf(page, id);
  await expect(hex).toHaveClass(/\bsel\b/);
  await expect(hex).toHaveAttribute('aria-pressed', 'true');
});

Then('the hex holding {string} is not outlined as selected', async ({ page }, id: string) => {
  const hex = await hexOf(page, id);
  await expect(hex).not.toHaveClass(/\bsel\b/);
  await expect(hex).toHaveAttribute('aria-pressed', 'false');
});

Then(/^the map shows (\d+) hex(?:es)?$/, async ({ page }, n: string) => {
  await expect(page.locator('path.hx')).toHaveCount(Number(n));
});

When('I press "× Clear" on the map', async ({ page }) => {
  await mapClear(page).click();
});

Then('the map has no "× Clear"', async ({ page }) => {
  await expect(mapClear(page)).toHaveCount(0);
});

Then(/^"Select area" is switched (on|off)$/, async ({ page }, state: string) => {
  await expect(page.getByRole('button', { name: 'Select area' })).toHaveAttribute('aria-pressed', String(state === 'on'));
  await expect(page.locator('.boxlayer')).toHaveCount(state === 'on' ? 1 : 0);
});

When('I drag a rectangle over the middle of the hex holding {string}', async ({ page }, id: string) => {
  const box = (await (await hexOf(page, id)).boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(cx - 20, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 20, { steps: 6 });
  await page.mouse.up();
});

Then('the map offers no {string} view', async ({ page }, mode: string) => {
  await expect(page.getByRole('group', { name: 'Map shows' })).toHaveCount(0);
  await expect(page.locator('#map').getByRole('button', { name: mode, exact: true })).toHaveCount(0);
});

Then('the map says {string}', async ({ page }, text: string) => {
  await expect(page.locator('.map-note')).toHaveText(text);
});

When('I note where the hex holding {string} is', async ({ page, scratch }, id: string) => {
  scratch.hexBox = await (await hexOf(page, id)).boundingBox();
});

Then('the hex holding {string} has not moved', async ({ page, scratch }, id: string) => {
  expect(await (await hexOf(page, id)).boundingBox()).toEqual(scratch.hexBox);
});

Then(
  'the basemaps are {string}, {string}, {string}, {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string, d: string, e: string, f: string) => {
    await expect(page.getByLabel('Basemap').locator('option')).toHaveText([a, b, c, d, e, f]);
  },
);

Then('the map credit reads {string}', async ({ page }, text: string) => {
  await expect(page.locator('.map-credit')).toHaveText(text);
});

When('I choose the {string} basemap', async ({ page }, name: string) => {
  await page.getByLabel('Basemap').selectOption({ label: name });
});

Then('no tile came from a real tile server', async ({ tiles }) => {
  await expect.poll(() => tiles.requested.length).toBeGreaterThan(0);
  expect(tiles.requested.every((url) => tiles.answered.includes(url))).toBe(true);
  expect(tiles.requested.some((url) => url.includes('World_Imagery'))).toBe(true);
});

When('I point at the Locations row {string}', async ({ page }, id: string) => {
  await tableRows(page).filter({ has: page.locator('td', { hasText: new RegExp(`^${id}$`) }) }).locator('td').first().hover();
});

When('I point away from the table', async ({ page }) => {
  await page.mouse.move(2, 2);
});

Then('the hex holding {string} is lit', async ({ page }, id: string) => {
  await expect(await hexOf(page, id)).toHaveClass(/\bhl\b/);
});

Then('no hex is lit', async ({ page }) => {
  await expect(page.locator('path.hx.hl')).toHaveCount(0);
});

// --- Effort strip -------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthIndex = (label: string) => {
  const [name, year] = label.split(' ');
  return Number(year) * 12 + MONTHS.indexOf(name);
};
const strip = (page: Page) => page.locator('svg.effort');

async function monthCenter(page: Page, label: string): Promise<[number, number]> {
  const bar = (await strip(page).locator(`g[data-month="${monthIndex(label)}"] rect`).first().boundingBox())!;
  return [bar.x + bar.width / 2, bar.y + bar.height / 2];
}

When('I drag the strip from {string} to {string}', async ({ page }, from: string, to: string) => {
  const [x0, y0] = await monthCenter(page, from);
  const [x1] = await monthCenter(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y0, { steps: 8 });
  await page.mouse.up();
});

When('I click {string} on the strip', async ({ page }, month: string) => {
  const [x, y] = await monthCenter(page, month);
  await page.mouse.click(x, y);
});

Then('the strip marks {string} to {string}', async ({ page }, from: string, to: string) => {
  const bracket = strip(page).locator('g.bracket');
  await expect(bracket).toHaveAttribute('data-from', String(monthIndex(from)));
  await expect(bracket).toHaveAttribute('data-to', String(monthIndex(to)));
});

When('I press "× Clear" on the strip', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear dates', exact: true }).click();
});

When('I move to the strip with the keyboard', async ({ page }) => {
  await strip(page).focus();
});

When('I press the {string} key on the strip', async ({ page }, key: string) => {
  await strip(page).press(key);
});

Then('the strip shows {int} months with photos', async ({ page }, n: number) => {
  await expect(strip(page).locator('g[data-month]')).toHaveCount(n);
});

const legend = (page: Page) => page.getByRole('region', { name: 'Camera effort' }).locator('.tl-legend');

Then('the strip draws nothing inside its bars', async ({ page }) => {
  await expect(strip(page).locator('rect.match')).toHaveCount(0);
  await expect(legend(page).locator('.sw.match')).toHaveCount(0);
});

Then('the strip draws {string} inside {int} months', async ({ page }, name: string, n: number) => {
  await expect(legend(page).locator('span', { has: page.locator('.sw.match') })).toHaveText(name);
  await expect(strip(page).locator('rect.match')).toHaveCount(n);
});

const activityOf = (page: Page, id: string) =>
  tableRows(page).filter({ has: page.locator('td', { hasText: new RegExp(`^${id}$`) }) }).locator('.spark');

Then('the Activity of {string} shows {int} months with nothing inside', async ({ page }, id: string, n: number) => {
  await expect(activityOf(page, id).locator('g[data-match]')).toHaveCount(n);
  await expect(activityOf(page, id).locator('rect.match')).toHaveCount(0);
});

Then(/^the Activity of "([^"]+)" draws "([^"]+)" inside (\d+) months?$/, async ({ page }, id: string, name: string, n: string) => {
  await expect(activityOf(page, id).locator('rect.match')).toHaveCount(Number(n));
  await activityOf(page, id).hover();
  await expect(page.locator('.tip[role="tooltip"]')).toContainText(`${name}:`);
});

When('I point at the Activity of {string}', async ({ page }, id: string) => {
  const row = tableRows(page).filter({ has: page.locator('td', { hasText: new RegExp(`^${id}$`) }) });
  await row.locator('.spark').hover();
});

Then('I see the note {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('tooltip')).toContainText(text);
});

// --- In view --------------------------------------------------------------------

const inView = (page: Page) => page.getByRole('region', { name: 'In view' });

Then('"In view" reads {string} {string}', async ({ page }, label: string, value: string) => {
  const stat = inView(page).locator('.stat').filter({ has: page.locator('.k', { hasText: new RegExp(`^${label}`) }) });
  await expect(stat.locator('.v')).toHaveText(value, { normalizeWhitespace: true });
});

Then('{string} explains {string}', async ({ page }, label: string, text: string) => {
  const stat = inView(page).locator('.stat').filter({ has: page.locator('.k', { hasText: new RegExp(`^${label}`) }) });
  await expect(stat).toHaveAttribute('title', text);
});

const topSpecies = (page: Page, name: string) => inView(page).locator('.spbar').filter({ hasText: name });

When('I press {string} in the top species', async ({ page }, name: string) => {
  await topSpecies(page, name).click();
});

Then('{string} is pressed in the top species', async ({ page }, name: string) => {
  await expect(topSpecies(page, name)).toHaveAttribute('aria-pressed', 'true');
});

When('I move to {string} in the top species and press Enter', async ({ page }, name: string) => {
  await topSpecies(page, name).focus();
  await page.keyboard.press('Enter');
});

Then('the Locations table still lists every location with photos', async ({ page }) => {
  await expect(tableRows(page)).toHaveCount(5);
});
