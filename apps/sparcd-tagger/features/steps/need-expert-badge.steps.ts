import type { Page, Locator } from '@playwright/test';
import { Given, When, Then, expect, gridCell, listRow, focusFrame, openWorkspace, ENDPOINT } from './support/world';
import { runLiveSync } from './support/flows';
import { BUCKET, PREFIX_A } from './support/data';
import { installS3Mock } from './support/s3mock';

const name = "Toggle needing an expert's opinion";
const toggle = (page: Page) => page.getByRole('button', { name, exact: true });
const badge = (root: Page | Locator) => root.getByTestId('need-expert-badge');
const check = (root: Locator) => root.getByTestId('classification-checkmark');
const focus = (page: Page) => page.getByTestId('focus-drop-zone');

async function goldenrod(mark: Locator) {
  await expect(mark).toBeVisible();
  const style = await mark.evaluate(el => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, color: s.color, pointer: s.pointerEvents, tabIndex: (el as HTMLElement).tabIndex };
  });
  expect(style.background).toBe('rgba(0, 0, 0, 0)');
  const rgb = style.color.match(/[\d.]+/g)!.map(Number);
  expect(rgb[0]).toBeGreaterThan(rgb[1]); expect(rgb[1]).toBeGreaterThan(rgb[2]);
  expect(style.pointer).toBe('none'); expect(style.tabIndex).toBe(-1);
  await expect(mark).toHaveAttribute('aria-label', 'Needs expert opinion');
  await expect(mark.locator('svg')).toBeVisible();
}

Given('expert badges are viewed at width {int} in {string} mode', async ({ page }, width: number, theme: string) => {
  await page.setViewportSize({ width, height: 950 });
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
  await focusFrame(page, 'IMG001.JPG');
});
Then('the expert toggle is available without an inactive badge', async ({ page }) => {
  await expect(toggle(page)).toBeVisible(); await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(badge(page)).toHaveCount(0);
  await toggle(page).focus();
  await expect(page.getByRole('tooltip', { name, exact: true })).toBeVisible();
});
When('the expert toggle marks the focused image', async ({ page }) => {
  await toggle(page).click(); await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
});
Then('a goldenrod circled question mark occupies the upper right of its grid image', async ({ page }) => {
  const tile = gridCell(page, 'IMG001.JPG'); await tile.scrollIntoViewIfNeeded();
  await goldenrod(badge(tile));
  const image = (await tile.locator('img').boundingBox())!; const b = (await badge(tile).boundingBox())!;
  expect(image.x + image.width - b.x - b.width).toBeGreaterThanOrEqual(0);
  expect(image.x + image.width - b.x - b.width).toBeLessThan(8);
  expect(b.y - image.y).toBeGreaterThanOrEqual(0); expect(b.y - image.y).toBeLessThan(8);
  expect(b.width / Math.min(image.width, image.height)).toBeCloseTo(1 / 3, 1);
  const c = (await check(tile).boundingBox())!; expect(c.x + c.width).toBeLessThan(b.x);
  await expect(tile).toHaveAccessibleName(/Has species.*Needs expert opinion/);
  expect((await tile.getAttribute('aria-label'))!.match(/Needs expert opinion/g)).toHaveLength(1);
  await expect(tile.getByRole('img', { name: 'Needs expert opinion', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `/tmp/555-grid-${page.viewportSize()!.width}-${await page.locator('html').getAttribute('class')}.png` });
});
Then('clicking the expert badge selects and opens the image without toggling it', async ({ page }) => {
  const tile = gridCell(page, 'IMG001.JPG');
  const b = (await badge(tile).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true'); await expect(tile).toHaveAttribute('aria-current', 'true');
  await badge(tile).scrollIntoViewIfNeeded(); const next = (await badge(tile).boundingBox())!;
  await page.mouse.dblclick(next.x + next.width / 2, next.y + next.height / 2);
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
});
Then('the regular Focus expert badge stays clear of viewer controls', async ({ page }) => {
  const mark = badge(focus(page)); await goldenrod(mark);
  const b = (await mark.boundingBox())!;
  expect(b.width).toBeLessThanOrEqual(56);
  const image = (await focus(page).locator('img').boundingBox())!;
  expect(b.width * b.height / (image.width * image.height)).toBeLessThan(0.04);
  for (const controlName of [/^Adjust/, /^Previous image$/, /^Next image$/, /^Zoom in$/, /^Zoom out$/, /^Open fullscreen$/]) {
    const control = page.getByRole('button', { name: controlName }); if (!await control.count()) continue;
    const c = (await control.boundingBox())!;
    expect(b.x < c.x + c.width && b.x + b.width > c.x && b.y < c.y + c.height && b.y + b.height > c.y).toBe(false);
  }
  await expect(toggle(page)).toBeVisible();
  await page.screenshot({ path: `/tmp/555-focus-${page.viewportSize()!.width}-${await page.locator('html').getAttribute('class')}.png` });
});
Then('the expert badge is absent from image-only fullscreen', async ({ page }) => {
  await page.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await expect(badge(page.locator('[data-focus-lightbox]'))).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
});
Then('expert badges follow filenames and classification badges in List', async ({ page }) => {
  await page.getByRole('button', { name: '☰ List', exact: true }).click();
  const row = listRow(page, 'IMG001.JPG'); const filename = row.locator('[data-column="filename"]');
  await goldenrod(badge(row));
  const c = (await check(row).boundingBox())!, b = (await badge(row).boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(c.x + c.width);
  await expect(filename.getByTestId('need-expert-badge')).toBeVisible();
  await expect(row.getByTestId('image-thumbnail').getByTestId('need-expert-badge')).toHaveCount(0);
  await expect(row).toHaveAccessibleName(/Has species.*Needs expert opinion/);
  await toggle(page).click(); await expect(badge(row)).toHaveCount(0); await expect(check(row)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: `/tmp/555-list-cleared-${page.viewportSize()!.width}.png` });
});
Then('an image without species shares its expert badge through sync fresh session and clearing', async ({ page, browser, s3 }) => {
  const original = s3.text(BUCKET, `${PREFIX_A}observations.csv`);
  await focusFrame(page, 'IMG002.JPG'); await toggle(page).click();
  await expect(badge(gridCell(page, 'IMG002.JPG'))).toBeVisible(); await expect(check(gridCell(page, 'IMG002.JPG'))).toHaveCount(0);
  await runLiveSync(page); await page.reload(); await openWorkspace(page);
  await expect(badge(gridCell(page, 'IMG002.JPG'))).toBeVisible();
  const context = await browser.newContext({ baseURL: ENDPOINT });
  try {
    const sibling = await context.newPage(); await installS3Mock(sibling, s3); await openWorkspace(sibling);
    await focusFrame(sibling, 'IMG002.JPG'); await expect(badge(gridCell(sibling, 'IMG002.JPG'))).toBeVisible();
    await expect(toggle(sibling)).toHaveAttribute('aria-pressed', 'true');
    await sibling.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(badge(focus(sibling))).toBeVisible(); await expect(check(focus(sibling))).toHaveCount(0);
    await toggle(sibling).click(); await expect(badge(focus(sibling))).toHaveCount(0);
    await expect(toggle(sibling)).toHaveAttribute('aria-pressed', 'false'); await runLiveSync(sibling);
  } finally { await context.close(); }
  await page.reload(); await openWorkspace(page);
  await expect(badge(gridCell(page, 'IMG002.JPG'))).toHaveCount(0);
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(original);
  expect(s3.puts.filter(put => put.key === `${PREFIX_A}observations.csv`)).toHaveLength(0);
});
Then('expert badge targeting preserves mixed selection and Shift Space behavior', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG'); await toggle(page).click();
  await gridCell(page, 'IMG001.JPG').click(); await gridCell(page, 'IMG003.JPG').click({ modifiers: ['Shift'] });
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'mixed');
  await expect(toggle(page)).toHaveAccessibleDescription(/3 selected images.*mixed/);
  await toggle(page).click();
  for (const file of ['IMG001.JPG', 'IMG002.JPG', 'IMG003.JPG']) await expect(badge(gridCell(page, file))).toBeVisible();
  await page.keyboard.press('Shift+Space');
  for (const file of ['IMG001.JPG', 'IMG002.JPG', 'IMG003.JPG']) await expect(badge(gridCell(page, file))).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
});
Then('touching an expert badge leaves the expert toggle state unchanged', async ({ browser, s3 }) => {
  const context = await browser.newContext({ baseURL: ENDPOINT, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); await installS3Mock(page, s3); await openWorkspace(page);
    await toggle(page).tap(); const tile = gridCell(page, 'IMG001.JPG'); await tile.scrollIntoViewIfNeeded();
    const b = (await badge(tile).boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(tile).toHaveAttribute('aria-current', 'true'); await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await tile.getByRole('button', { name: 'Open in focus view', exact: true }).tap();
    await expect(badge(focus(page))).toBeVisible(); await toggle(page).tap(); await expect(badge(focus(page))).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  } finally { await context.close(); }
});
Then('the expert badge stays in the fitted image upper right area', async ({ page }) => {
  const mark = badge(focus(page)); await goldenrod(mark);
  const image = (await focus(page).locator('img').boundingBox())!, b = (await mark.boundingBox())!;
  expect(image.x + image.width - b.x - b.width).toBeGreaterThanOrEqual(0);
  expect(image.x + image.width - b.x - b.width).toBeLessThan(image.height < 88 ? 52 : 8);
  expect(b.x).toBeGreaterThan(image.x + image.width / 2);
  expect(b.y - image.y).toBeGreaterThanOrEqual(0); expect(b.y - image.y).toBeLessThan(8);
  const c = (await check(focus(page)).boundingBox())!; expect(c.x + c.width).toBeLessThan(b.x);
});
