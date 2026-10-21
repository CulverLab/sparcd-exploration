import { Given, Then, expect, gridCell, listRow, focusFrame, enterFocusView, openSettings, sectionTab, openWorkspace, speciesApply, speciesFilter, selectedTiles, ENDPOINT } from './support/world';
import { runLiveSync } from './support/flows';
import { BUCKET, PREFIX_A, mediaKey } from './support/data';
import { makePng } from './support/png';
import { installS3Mock } from './support/s3mock';
import type { Locator, Page } from '@playwright/test';

const check = (root: Locator) => root.getByTestId('classification-checkmark');
const focus = (page: Page) => page.getByTestId('focus-drop-zone');

async function transparentGreen(badge: Locator) {
  await expect(badge).toBeVisible();
  const style = await badge.evaluate(el => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, color: s.color, pointer: s.pointerEvents, tabIndex: el.getAttribute('tabindex') };
  });
  expect(style.background).toBe('rgba(0, 0, 0, 0)');
  const rgb = style.color.match(/[\d.]+/g)!.map(Number);
  expect(rgb[1]).toBeGreaterThan(rgb[0]); expect(rgb[1]).toBeGreaterThan(rgb[2]);
  expect(style.pointer).toBe('none'); expect(style.tabIndex).toBeNull();
}

Given('the checkmark layout uses width {int} and theme {string}', async ({ page }, width: number, theme: string) => {
  await page.setViewportSize({ width, height: 950 });
  // The same theme class that App applies; this exercises both actual token sets.
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
  await focusFrame(page, 'IMG001.JPG');
  await page.getByRole('button', { name: "Toggle needing an expert's opinion", exact: true }).click();
});
Then('the classified grid image has a transparent green checkmark one third of its short side', async ({ page }) => {
  const tile = gridCell(page, 'IMG001.JPG'); const badge = check(tile);
  await transparentGreen(badge);
  await expect.poll(async () => {
    const image = await tile.locator('img').boundingBox(); const b = await badge.boundingBox();
    return b!.width / Math.min(image!.width, image!.height);
  }).toBeCloseTo(1 / 3, 1);
  const image = (await tile.locator('img').boundingBox())!; const b = (await badge.boundingBox())!;
  expect(b.x - image.x).toBeGreaterThanOrEqual(0); expect(b.x - image.x).toBeLessThan(8);
  expect(b.y - image.y).toBeGreaterThanOrEqual(0); expect(b.y - image.y).toBeLessThan(8);
  await expect(tile).toHaveAccessibleName(/Has species.*Needs expert opinion/);
  expect((await tile.getAttribute('aria-label'))!.match(/Has species/g)).toHaveLength(1);
  await expect(tile.getByRole('img', { name: /^Has species/ })).toHaveCount(0);
  await expect(check(gridCell(page, 'IMG002.JPG'))).toHaveCount(0);
  await expect(check(gridCell(page, 'IMG003.JPG'))).toBeVisible();
  await page.screenshot({ path: `/tmp/554-grid-${page.viewportSize()!.width}-${await page.locator('html').getAttribute('class')}.png` });
});
Then('badges preserve image selection and double-click opening', async ({ page }) => {
  const tile = gridCell(page, 'IMG001.JPG');
  await tile.scrollIntoViewIfNeeded();
  const b = (await check(tile).boundingBox())!;
  const selection = await selectedTiles(page).count();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(tile).toHaveAttribute('aria-current', 'true');
  expect(await selectedTiles(page).count()).toBe(selection);
  await check(tile).scrollIntoViewIfNeeded();
  const current = (await check(tile).boundingBox())!;
  await page.mouse.dblclick(current.x + current.width / 2, current.y + current.height / 2);
  await expect(page.getByRole('button', { name: 'Close Focus', exact: true })).toBeVisible();
});
Then('the Focus checkmark is small and leaves viewer controls usable', async ({ page }) => {
  const badge = check(focus(page)); await transparentGreen(badge);
  const b = (await badge.boundingBox())!;
  expect(b.width).toBeLessThanOrEqual(56); expect(b.width).toBeGreaterThan(20);
  for (const name of [/^Adjust/, /^Previous image$/, /^Next image$/, /^Zoom in$/, /^Zoom out$/, /^Open fullscreen$/]) {
    const control = page.getByRole('button', { name });
    if (!await control.count()) continue;
    const c = (await control.boundingBox())!;
    expect(b.x < c.x + c.width && b.x + b.width > c.x && b.y < c.y + c.height && b.y + b.height > c.y).toBe(false);
  }
  const image = (await focus(page).locator('img').boundingBox())!;
  expect(b.width * b.height / (image.width * image.height)).toBeLessThan(0.04);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByTitle('Reset to fit', { exact: true })).toBeVisible();
  await page.getByTitle('Reset to fit', { exact: true }).click();
  await expect(page.getByTitle('Reset to fit', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `/tmp/554-focus-${page.viewportSize()!.width}-${await page.locator('html').getAttribute('class')}.png` });
});
Then('image-only fullscreen contains no classification checkmark', async ({ page }) => {
  await page.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await expect(page.locator('[data-focus-lightbox]')).toBeVisible();
  await expect(check(page.locator('[data-focus-lightbox]'))).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
});
Then('list badges follow the filename in classification and expert order', async ({ page }) => {
  await page.getByRole('button', { name: '☰ List' }).click();
  const row = listRow(page, 'IMG001.JPG'); const filename = row.locator('[data-column="filename"]');
  await transparentGreen(check(row));
  expect(await filename.locator('[role="img"]').evaluateAll(nodes => nodes.map(el => el.getAttribute('title')))).toEqual([
    'Has species — one or more species, or an explicit no-species classification', 'Needs expert opinion',
  ]);
  const bounds = await filename.evaluate(el => {
    const text = el.firstElementChild!.getBoundingClientRect();
    const badge = el.querySelector('[data-testid="classification-checkmark"]')!.getBoundingClientRect();
    return { textRight: text.right, badgeLeft: badge.left, columnRight: el.getBoundingClientRect().right, badgeRight: badge.right };
  });
  expect(bounds.badgeLeft).toBeGreaterThanOrEqual(bounds.textRight);
  expect(bounds.badgeRight).toBeLessThanOrEqual(bounds.columnRight);
  await expect(row.getByTestId('image-thumbnail').locator('[role="img"]')).toHaveCount(0);
  await expect(row).toHaveAccessibleName(/Has species.*Needs expert opinion/);
  await page.screenshot({ path: `/tmp/554-list-${page.viewportSize()!.width}-${await page.locator('html').getAttribute('class')}.png` });
});
Then('classification checkmarks follow species edits Ghost Test clearing sync and reload', async ({ page }) => {
  await openSettings(page); await page.getByLabel('Move to the next image after assigning a species').uncheck();
  await sectionTab(page, 'Tag').click(); await focusFrame(page, 'IMG002.JPG');
  const tile = gridCell(page, 'IMG002.JPG'); await expect(check(tile)).toHaveCount(0);
  await page.getByRole('button', { name: "Toggle needing an expert's opinion", exact: true }).click();
  await expect(tile.locator('[title="Needs expert opinion"]')).toBeVisible(); await expect(check(tile)).toHaveCount(0);
  await speciesApply(page, 'Canis latrans').click(); await expect(check(tile)).toBeVisible();
  await speciesApply(page, 'Puma concolor').click();
  await page.getByRole('button', { name: 'Show all applied species' }).click();
  await page.getByRole('button', { name: 'Remove Coyote', exact: true }).click(); await expect(check(tile)).toBeVisible();
  await page.getByRole('button', { name: 'Remove Mountain Lion', exact: true }).click(); await expect(check(tile)).toHaveCount(0);
  await speciesApply(page, 'Casper').click(); await expect(check(tile)).toBeVisible();
  await page.getByRole('button', { name: 'Remove Ghost', exact: true }).click(); await expect(check(tile)).toHaveCount(0);
  await speciesFilter(page).fill('Test'); await page.getByTitle('Apply Tag as requested species', { exact: true }).click();
  await expect(check(tile)).toBeVisible();
  await runLiveSync(page); await page.reload(); await openWorkspace(page); await focusFrame(page, 'IMG002.JPG');
  await expect(check(tile)).toBeVisible();
  await page.getByRole('button', { name: 'Clear Species', exact: true }).click(); await expect(check(tile)).toHaveCount(0);
  await runLiveSync(page); await page.reload(); await openWorkspace(page); await expect(check(tile)).toHaveCount(0);
});
Given('the checkmark image is {int} by {int} at viewport width {int}', async ({ page, s3 }, width: number, height: number, viewport: number) => {
  s3.put(BUCKET, mediaKey(PREFIX_A, 'IMG001.JPG'), makePng(width, height, 180), 'image/png');
  await page.reload(); await openWorkspace(page); await page.setViewportSize({ width: viewport, height: 950 });
  await focusFrame(page, 'IMG001.JPG'); await enterFocusView(page);
});
Then('the Focus checkmark stays inside the fitted image upper left corner', async ({ page }) => {
  const badge = check(focus(page)); await expect(badge).toBeVisible();
  const image = (await focus(page).locator('img').boundingBox())!; const b = (await badge.boundingBox())!;
  const pane = (await focus(page).boundingBox())!;
  expect(image.x).toBeGreaterThanOrEqual(pane.x); expect(image.y).toBeGreaterThanOrEqual(pane.y);
  expect(image.x + image.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(image.y + image.height).toBeLessThanOrEqual(pane.y + pane.height);
  expect(b.x - image.x).toBeGreaterThanOrEqual(0); expect(b.x - image.x).toBeLessThan(8);
  expect(b.y - image.y).toBeGreaterThanOrEqual(0); expect(b.y - image.y).toBeLessThan(8);
  expect(b.x + b.width).toBeLessThan(image.x + image.width); expect(b.y + b.height).toBeLessThan(image.y + image.height);
  await page.screenshot({ path: `/tmp/554-letterbox-${Math.round(image.width)}-${Math.round(image.height)}.png` });
});
Then('touch input passes through classification checkmarks', async ({ browser, s3 }) => {
  const context = await browser.newContext({ baseURL: ENDPOINT, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); await installS3Mock(page, s3); await openWorkspace(page);
    const tile = gridCell(page, 'IMG003.JPG'); const b = (await check(tile).boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(tile).toHaveAttribute('aria-current', 'true');
    await tile.getByRole('button', { name: 'Open in focus view', exact: true }).tap();
    await expect(check(focus(page))).toBeVisible();
  } finally { await context.close(); }
});
