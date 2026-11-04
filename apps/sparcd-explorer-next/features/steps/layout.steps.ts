// The calm layout: the title, Map and View menus, where the moved controls went, and nothing moving.

import type { Page } from '@playwright/test';
import { Given, Then, When, expect, filterBar, mapMenu, openCollections, popover, titleMenu, viewMenu } from './support/world';

const titleButton = (page: Page) => page.locator('#collname');
const mapButton = (page: Page) => page.locator('#map').getByRole('button', { name: 'Map', exact: true });
const viewButton = (page: Page) => page.locator('#table .viewbtn');
const entries = (menu: ReturnType<typeof popover>) => menu.locator('.menu > button');
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');

// --- The title menu ------------------------------------------------------------

When('I open the title menu', async ({ page }) => {
  await titleMenu(page);
});

Then('the title menu lists {string} with {string}', async ({ page }, name: string, counts: string) => {
  const row = (await titleMenu(page)).locator('.bclist li').filter({ has: page.getByRole('button', { name, exact: true }) });
  await expect(row.locator('.bc-n')).toHaveText(counts);
});

Then('the title menu has the entries {string}', async ({ page }, list: string) => {
  await expect(entries(await titleMenu(page))).toHaveText(list.split(', '));
});

Then('the title menu offers {string}', async ({ page }, name: string) => {
  await expect((await titleMenu(page)).getByRole('button', { name })).toBeVisible();
});

When('I press {string} in the title menu', async ({ page }, name: string) => {
  await (await titleMenu(page)).getByRole('button', { name }).click();
});

Then('the title menu has no {string}', async ({ page }, name: string) => {
  await expect((await titleMenu(page)).getByRole('heading', { name })).toHaveCount(0);
});

When('I move to the collection title and press {string}', async ({ page }, key: string) => {
  await titleButton(page).focus();
  await page.keyboard.press(key);
});

Then('the focus is on the collection title', async ({ page }) => {
  await expect(titleButton(page)).toBeFocused();
});

// --- Keyboard ------------------------------------------------------------------

When('I press {string} on the focused control', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

Then('the focus is on {string}', async ({ page }, text: string) => {
  await expect.poll(() => focused(page)).toBe(text);
});

Then('no menu is open', async ({ page }) => {
  await expect(page.locator('.pop')).toHaveCount(0);
});

// --- The Map menu --------------------------------------------------------------

When('I open the Map menu', async ({ page }) => {
  await mapMenu(page);
});

When('I move to the Map button and press {string}', async ({ page }, key: string) => {
  await mapButton(page).focus();
  await page.keyboard.press(key);
});

Then('the focus is on the Map button', async ({ page }) => {
  await expect(mapButton(page)).toBeFocused();
});

Then('{string} is the choice in {string}', async ({ page }, name: string, group: string) => {
  await expect(page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
});

When('I choose {string} in {string}', async ({ page }, name: string, group: string) => {
  await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true }).click();
});

Then('the map shows sites', async ({ page }) => {
  await expect(page.locator('path.st').first()).toBeAttached();
});

Then("the map's only buttons are {string}", async ({ page }, list: string) => {
  await page.keyboard.press('Escape');
  const names = await page.locator('#map button').evaluateAll((all) => all.map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim()));
  expect(names).toEqual(list.split(', '));
});

Then('the page says nothing of {string}', async ({ page }, text: string) => {
  await expect(page.locator('#map').getByText(text)).toHaveCount(0);
});

// --- The View menu -------------------------------------------------------------

When('I open the View menu', async ({ page }) => {
  await viewMenu(page);
});

When('I move to the View button and press {string}', async ({ page }, key: string) => {
  await viewButton(page).focus();
  await page.keyboard.press(key);
});

Then('the focus is on the View button', async ({ page }) => {
  await expect(viewButton(page)).toBeFocused();
});

Then('the focus is in the Columns editor', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: /^Columns/ }).locator(':focus')).toHaveCount(1);
});

Then('the View menu has the entries {string}', async ({ page }, list: string) => {
  await expect(entries(await viewMenu(page))).toHaveText(list.split(', '));
});

Then('the View menu has the switch {string}', async ({ page }, name: string) => {
  await expect((await viewMenu(page)).getByRole('switch', { name })).toBeVisible();
});

Then('the View menu has no switch', async ({ page }) => {
  await expect((await viewMenu(page)).getByRole('switch')).toHaveCount(0);
});

Then('the View menu has no {string}', async ({ page }, name: string) => {
  await expect((await viewMenu(page)).getByRole('group', { name })).toHaveCount(0);
});

Then('the View menu has {string} and {string}', async ({ page }, a: string, b: string) => {
  const menu = await viewMenu(page);
  await expect(menu.getByRole('group', { name: a })).toBeVisible();
  await expect(menu.getByRole('group', { name: b })).toBeVisible();
});

When('I press {string} in the View menu', async ({ page }, name: string) => {
  await (await viewMenu(page)).getByRole('button', { name, exact: true }).click();
});

Then('the Tagged control sits in the tab row', async ({ page }) => {
  await expect(page.locator('#table .tbl-head').getByRole('group', { name: 'Tagged' })).toBeVisible();
});

// --- The effort strip on the Charts tab ------------------------------------------

Then('there is no effort strip', async ({ page }) => {
  await expect(page.locator('svg.effort')).toHaveCount(0);
});

Then('the strip is the first thing in the Charts', async ({ page }) => {
  await expect(page.locator('.charts > :first-child svg.effort')).toBeVisible();
});

// --- Pickers ---------------------------------------------------------------------

Then('the sidebar has no year buttons', async ({ page }) => {
  await expect(filterBar(page).getByRole('group', { name: 'Years' })).toHaveCount(0);
});

Then('the year {int} is pressed in the dates picker', async ({ page }, year: number) => {
  const button = popover(page, 'Dates').getByRole('group', { name: 'Years' }).getByRole('button', { name: new RegExp(`^${year}`) });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

Then('the sidebar has no Photo files switch', async ({ page }) => {
  await expect(filterBar(page).getByRole('radiogroup')).toHaveCount(0);
  await expect(filterBar(page).getByRole('group', { name: 'Photos whose files are missing' })).toHaveCount(0);
});

When('I open the files filter', async ({ page }) => {
  await filterBar(page).getByRole('button', { name: /^Photo files/ }).click();
});

Then('the sidebar reads {string}', async ({ page }, list: string) => {
  await expect(filterBar(page).locator('.side-more, .fsec-label')).toHaveText(list.split(', '));
});

// --- Nothing moves ---------------------------------------------------------------

const WATCHED = [
  '#filtersbtn',
  '.top .resetslot',
  '.appsw',
  '#collname',
  '#reportbtn',
  '[aria-label="Display settings"]',
  '.avatar',
  '#figures',
  '.fig.ph',
  '.fig.sp',
  '.fig.lo',
  '.fig.da',
  '#map',
  '.zoomctl',
  '.mapctl',
  '#table .tbl-head',
  '#table .tabs',
  '#table .viewbtn',
  '.side-head',
  '.fsec',
  '.side-more',
];

const whereEverythingIs = (page: Page) =>
  page.evaluate((selectors) => {
    const out: Record<string, number[]> = {};
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        out[`${sel} ${i}`] = [r.x, r.y, r.width, r.height];
      });
    }
    return out;
  }, WATCHED);

Given('I have opened {int} collections', async ({ page }, n: number) => {
  if (n === 2) await openCollections(page, 'Alpha Basin', 'Bravo Flats');
  else {
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await page.locator('.choose-foot .bigbtn').click();
    await page.locator('#sticky-top').waitFor({ timeout: 40_000 });
  }
  await expect(page.locator('#collname')).toContainText(n === 2 ? 'Alpha Basin + Bravo Flats' : '+ ');
});

When('I note where everything on the page is', async ({ page, scratch }) => {
  await page.evaluate(() => document.fonts.ready.then(() => scrollTo(0, 0)));
  scratch.everything = await whereEverythingIs(page);
});

Then('nothing on the page has moved', async ({ page, scratch }) => {
  await page.evaluate(() => scrollTo(0, 0));
  const before = scratch.everything as Record<string, number[]>;
  const now = await whereEverythingIs(page);
  expect(Object.keys(now)).toEqual(Object.keys(before));
  for (const [key, box] of Object.entries(now)) {
    box.forEach((v, i) => expect(Math.abs(v - before[key][i]), `${key} ${['x', 'y', 'width', 'height'][i]}`).toBeLessThanOrEqual(1));
  }
});

Then('the tab row is one line', async ({ page }) => {
  const row = (await page.locator('#table .tbl-head').boundingBox())!;
  expect(row.height).toBeLessThanOrEqual(51);
  const count = (await page.locator('#table .rowcount').boundingBox())!;
  const tabs = (await page.locator('#table .tabs').boundingBox())!;
  expect(count.y).toBeLessThan(tabs.y + tabs.height);
});

Then('the tab row peeks at the bottom of the first screen', async ({ page }) => {
  const tabs = (await page.locator('#table .tabs').boundingBox())!;
  const size = page.viewportSize()!;
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(size.height);
  expect(tabs.y).toBeGreaterThan(size.height / 2);
});

Then('the tab row sits just under the top bar', async ({ page }) => {
  await expect
    .poll(async () => {
      const bar = (await page.locator('#sticky-top').boundingBox())!;
      const row = (await page.locator('#table .tbl-head').boundingBox())!;
      return Math.round(row.y - (bar.y + bar.height));
    })
    .toBe(0);
});

Then('the first screen has no horizontal overflow', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

// --- Phones ----------------------------------------------------------------------

Then('the row above the figures has {string}', async ({ page }, list: string) => {
  const names = await page.locator('.phoneacts button').evaluateAll((all) => all.map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim()));
  expect(names).toEqual(list.split(', '));
  const figures = (await page.locator('#figures').boundingBox())!;
  const row = (await page.locator('.phoneacts').boundingBox())!;
  expect(row.y + row.height).toBeLessThanOrEqual(figures.y + 1);
});
