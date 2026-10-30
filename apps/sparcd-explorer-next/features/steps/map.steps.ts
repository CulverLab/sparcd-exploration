// The map, the effort strip, the figures and the Species table's shortcut.

import type { Locator, Page } from '@playwright/test';
import { exactSitesOrigin } from './support/s3mock';
import { Then, USERNAME, When, columnValues, expect, openCollections, signIn, tableRows } from './support/world';

// --- Map ------------------------------------------------------------------------

/** Notes the map's zoom, for "the map is zoomed in" and "the map is not zoomed" to compare with. */
async function noteZoom(page: Page): Promise<Locator> {
  const map = page.locator('.leafmap');
  await expect(map).toHaveAttribute('data-zoom', /\d/);
  await map.evaluate((el) => ((el as HTMLElement).dataset.zoomBefore = (el as HTMLElement).dataset.zoom));
  return map;
}

const zoomOf = (page: Page) =>
  page.locator('.leafmap').evaluate((el) => ({ before: Number((el as HTMLElement).dataset.zoomBefore), now: Number((el as HTMLElement).dataset.zoom) }));

type Pinch = { widths: number[]; endsDuring: number; pageHandled: boolean };
type Wheels = { onMap: boolean; prevented: boolean }[];

When('I pinch to zoom in over the map', async ({ page, scratch }) => {
  const map = await noteZoom(page);
  // A trackpad pinch arrives as a run of wheel events with ctrlKey set, a frame apart; the page handled
  // one unless it was cancelled. A hex's width tracks the zoom mid-gesture, and each zoom end writes data-zoom.
  scratch.pinch = await map.evaluate(async (el): Promise<Pinch> => {
    const w = window as unknown as { zoomEnds: number };
    w.zoomEnds = 0;
    new MutationObserver((records) => (w.zoomEnds += records.length)).observe(el, { attributeFilter: ['data-zoom'] });
    const hex = el.querySelector('path.hx')!;
    const r = el.getBoundingClientRect();
    const widths = [hex.getBoundingClientRect().width];
    let pageHandled = false;
    for (let i = 0; i < 6; i++) {
      const e = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
      pageHandled = el.dispatchEvent(e) || pageHandled;
      await new Promise(requestAnimationFrame);
      widths.push(hex.getBoundingClientRect().width);
    }
    return { widths, endsDuring: w.zoomEnds, pageHandled };
  });
});

Then('the map zoomed in step by step while the fingers moved', ({ scratch }) => {
  const { widths, endsDuring } = scratch.pinch as Pinch;
  for (let i = 1; i < widths.length; i++) expect(widths[i], `hex width after wheel event ${i}`).toBeGreaterThan(widths[i - 1]);
  expect(endsDuring, 'zoom ends before the fingers stopped').toBe(0);
});

Then('the map is zoomed in', async ({ page }) => {
  await expect.poll(async () => { const z = await zoomOf(page); return z.now - z.before; }).toBeGreaterThan(0);
});

Then('the zoom ended once', async ({ page }) => {
  // Well past the pinch's 150 ms idle wait.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { zoomEnds: number }).zoomEnds)).toBe(1);
});

Then('the browser did not zoom the page', ({ scratch }) => {
  expect((scratch.pinch as Pinch).pageHandled, 'the pinch was kept from the browser').toBe(false);
});

Then('the map is not zoomed', async ({ page }) => {
  await page.waitForTimeout(400);
  const z = await zoomOf(page);
  expect(z.now).toBe(z.before);
});

Then('a hint over the map reads {string}', async ({ page }, text: string) => {
  await expect(page.locator('.maphint')).toHaveText(text);
});

Then('the map has no hint', async ({ page }) => {
  await expect(page.locator('.maphint')).toHaveCount(0);
});

/** A hex's top-left corner from the map's. */
async function hexOnMap(page: Page, id: string): Promise<{ x: number; y: number }> {
  const hex = (await (await hexOf(page, id)).boundingBox())!;
  const map = (await page.locator('.leafmap').boundingBox())!;
  return { x: hex.x - map.x, y: hex.y - map.y };
}

When('I note where the hex holding {string} sits on the map', async ({ page, scratch }, id: string) => {
  scratch.hexOnMap = await hexOnMap(page, id);
});

When('I scroll over the map without pinching', async ({ page, scratch }) => {
  await page.evaluate(() => scrollTo(0, 0));
  const box = (await (await noteZoom(page)).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  scratch.scroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 100);
});

Then('the hex holding {string} has moved up on the map', async ({ page, scratch }, id: string) => {
  const before = scratch.hexOnMap as { x: number; y: number };
  await expect.poll(async () => (await hexOnMap(page, id)).y).toBeLessThan(before.y - 50);
  expect(Math.abs((await hexOnMap(page, id)).x - before.x)).toBeLessThanOrEqual(1);
});

Then('the page stayed where it was', async ({ page, scratch }) => {
  expect(await page.evaluate(() => scrollY)).toBe(scratch.scroll);
});

When('I scroll the page down from just above the map', async ({ page, scratch }) => {
  await page.evaluate(() => {
    scrollTo(0, 0);
    // After the map's own handler: whether each wheel event reached the map, and whether it was kept from the page.
    const log: Wheels = [];
    (window as unknown as { wheels: Wheels }).wheels = log;
    addEventListener('wheel', (e) => log.push({ onMap: !!(e.target as Element).closest('.leafmap'), prevented: e.defaultPrevented }), { passive: true });
  });
  const map = (await page.locator('.leafmap').boundingBox())!;
  // On the figures, just above the map's top edge.
  const y = map.y - 40;
  await page.mouse.move(map.x + 30, y);
  // The page scroll at which the map's top edge reaches the pointer.
  scratch.mapReachesPointer = map.y - y;
  // Small steps, as a trackpad sends them: the browser may scroll before it finds the event's target.
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 10);
    await page.waitForTimeout(20);
  }
});

Then('the page kept scrolling while the map was under the pointer', async ({ page, scratch }) => {
  const wheels = await page.evaluate(() => (window as unknown as { wheels: Wheels }).wheels);
  expect(wheels[0].onMap, 'the scroll started on the map').toBe(false);
  expect(wheels.filter((w) => w.onMap).length, 'wheel events over the map').toBeGreaterThan(2);
  expect(wheels.filter((w) => w.prevented), 'wheel events kept from the page').toEqual([]);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan((scratch.mapReachesPointer as number) + 60);
});

Then('the hex holding {string} sits where it did on the map', async ({ page, scratch }, id: string) => {
  const before = scratch.hexOnMap as { x: number; y: number };
  const now = await hexOnMap(page, id);
  expect(Math.abs(now.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - before.y)).toBeLessThanOrEqual(1);
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

When('I sign in to the server that shows exact sites and open {string}', async ({ page }, name: string) => {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await signIn(page, USERNAME, exactSitesOrigin());
  await expect(page.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
  await openCollections(page, name);
});

When('I show sites on the map', async ({ page }) => {
  await page.getByRole('group', { name: 'Map shows' }).getByRole('button', { name: 'Sites', exact: true }).click();
});

When('I drag a rectangle around the dot of {string}', async ({ page }, id: string) => {
  const box = (await page.locator(`path.st[data-site="${id}"]`).boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(cx - 10, cy - 10);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy + 10, { steps: 6 });
  await page.mouse.up();
});

Then('the map offers no {string} view', async ({ page }, mode: string) => {
  await expect(page.getByRole('group', { name: 'Map shows' })).toHaveCount(0);
  await expect(page.locator('#map').getByRole('button', { name: mode, exact: true })).toHaveCount(0);
});

Then('the map says {string}', async ({ page }, text: string) => {
  await expect(page.locator('.mapnote')).toHaveText(text);
});

/**
 * The hex's shape on the page. Playwright's box takes in the stroke, which widens when the pointer, left over the
 * map by a closing picker, rests on the hex; that isn't a move.
 */
const shapeBox = async (page: Page, id: string) =>
  (await hexOf(page, id)).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

When('I note where the hex holding {string} is', async ({ page, scratch }, id: string) => {
  scratch.hexBox = await shapeBox(page, id);
});

Then('the hex holding {string} has not moved', async ({ page, scratch }, id: string) => {
  expect(await shapeBox(page, id)).toEqual(scratch.hexBox);
});

Then(
  'the basemaps are {string}, {string}, {string}, {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string, d: string, e: string, f: string) => {
    await expect(page.getByLabel('Basemap').locator('option')).toHaveText([a, b, c, d, e, f]);
  },
);

Then('the map credit reads {string}', async ({ page }, text: string) => {
  await expect(page.locator('.mapcredit')).toHaveText(text);
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
  await expect(page.locator('.tip[role="tooltip"]')).toContainText(text);
});

// --- The figures and the Species table ---------------------------------------------

const figure = (page: Page, label: string) =>
  page.locator('#figures .fig').filter({ has: page.locator('.k', { hasText: new RegExp(`^${label}`) }) });

/** A figure's number, then its sub-lines that say something: "11 64% tagged", "5 of 5". */
Then('the {string} figure reads {string}', async ({ page }, label: string, value: string) => {
  await expect
    .poll(() =>
      figure(page, label).evaluate((el) =>
        [el.querySelector('.v'), ...el.querySelectorAll('.of')].map((x) => x!.textContent!.trim()).filter(Boolean).join(' '),
      ),
    )
    .toBe(value);
});

Then('{string} explains {string}', async ({ page }, label: string, text: string) => {
  const help = figure(page, label).locator('.qmark');
  await help.focus();
  await expect(help.getByRole('tooltip')).toHaveText(text);
  await expect(help).toHaveAccessibleDescription(text);
});

const speciesName = (page: Page, name: string) => page.locator('#table .cellbtn').filter({ hasText: new RegExp(`^${name}$`) });

Then('the Species table lists the most detected first, each count with its bar', async ({ page }) => {
  const counts = (await columnValues(page, 'Detections')).map(Number);
  expect(counts.length).toBeGreaterThan(1);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  await expect(tableRows(page).locator('.numbar b')).toHaveCount(counts.length);
});

When('I press {string} in the Species table', async ({ page }, name: string) => {
  await speciesName(page, name).click();
});

Then('{string} is pressed in the Species table', async ({ page }, name: string) => {
  await expect(speciesName(page, name)).toHaveAttribute('aria-pressed', 'true');
});

When('I move to {string} in the Species table and press Enter', async ({ page }, name: string) => {
  await speciesName(page, name).focus();
  await page.keyboard.press('Enter');
});

Then('the Locations table still lists every location with photos', async ({ page }) => {
  await expect(tableRows(page)).toHaveCount(5);
});
