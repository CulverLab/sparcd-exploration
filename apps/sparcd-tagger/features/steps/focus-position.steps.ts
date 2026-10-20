import type { Page } from '@playwright/test';
import { When, Then, expect, enterFocusView, focusFrame, openUpload, sectionTab } from './support/world';

const viewer = (page: Page) => page.getByRole('dialog', { name: 'Focus image viewer' });
const progress = (page: Page) => viewer(page).getByRole('progressbar', { name: 'Image position' });
const closeFocus = async (page: Page) => {
  await viewer(page).getByRole('button', { name: 'Close Focus' }).click();
  await expect(viewer(page)).toHaveCount(0);
};

When('Focus opens on the first image for position coverage', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await enterFocusView(page);
});

Then('Focus position is {string} at {int} of {int}', async ({ page }, label: string, current: number, count: number) => {
  const bar = progress(page);
  await expect(bar).toHaveText(label);
  await expect(bar).toHaveAttribute('aria-valuemin', '1');
  await expect(bar).toHaveAttribute('aria-valuenow', String(current));
  await expect(bar).toHaveAttribute('aria-valuemax', String(count));
  await expect(bar).toHaveAttribute('aria-valuetext', label);
  await expect(bar).not.toHaveAttribute('tabindex', /.+/);
});

When('Focus moves to the last media item', async ({ page }) => {
  for (let index = 0; index < 3; index++) await viewer(page).getByRole('button', { name: 'Next image' }).click();
});
When('Focus moves to a middle media item', async ({ page }) => {
  for (let index = 0; index < 2; index++) await viewer(page).getByRole('button', { name: 'Next image' }).click();
});

When('Focus returns to the first media item', async ({ page }) => {
  for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowLeft');
});
When('Focus is closed with Escape after position coverage', async ({ page }) => {
  await page.keyboard.press('Escape');
});
Then('the Focus position bar is gone and the opener is focused', async ({ page }) => {
  await expect(viewer(page)).toHaveCount(0);
  await expect(progress(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeFocused();
});

Then('the focused media is the final video', async ({ page }) => {
  await expect(viewer(page)).toContainText('VID001.MP4');
  await expect(viewer(page).locator('video')).toBeVisible();
});
Then('the focused media is the first video', async ({ page }) => {
  await expect(viewer(page)).toContainText('VID001.MP4');
  await expect(viewer(page).locator('video')).toBeVisible();
});
Then('the Focus previous control is absent at the boundary', async ({ page }) => {
  await expect(viewer(page).getByRole('button', { name: 'Previous image' })).toHaveCount(0);
});
Then('the Focus next control is absent at the boundary', async ({ page }) => {
  await expect(viewer(page).getByRole('button', { name: 'Next image' })).toHaveCount(0);
});

When('Focus opens with a two-image date filter', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Capture year').fill('2024');
  await page.getByLabel('Capture month').fill('01');
  await page.getByLabel('Capture day').fill('11');
  await page.getByLabel('Capture hour').fill('06');
  await page.keyboard.press('Escape');
  await enterFocusView(page);
});
When('Focus advances one filtered image', async ({ page }) => {
  await page.keyboard.press('ArrowDown');
  await expect(viewer(page)).toContainText('IMG005.JPG');
});
When('the image filter is cleared after closing Focus', async ({ page }) => {
  await closeFocus(page);
  await page.getByRole('button', { name: /^Filter/ }).click();
  for (const field of ['Capture year', 'Capture month', 'Capture day', 'Capture hour']) await page.getByLabel(field).fill('');
  await page.keyboard.press('Escape');
  await enterFocusView(page);
});

When('Focus opens with an all-matching image filter', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Search in').selectOption('filename');
  await page.keyboard.press('Escape');
  await enterFocusView(page);
});

When('Focus opens after sorting video first', async ({ page }) => {
  await page.getByRole('button', { name: /^Date/ }).click();
  await focusFrame(page, 'VID001.MP4');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(viewer(page).locator('video')).toBeVisible();
});
When('Focus opens with a single-image filter', async ({ page }) => {
  await closeFocus(page);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Match text').fill('IMG003');
  await page.keyboard.press('Escape');
  await enterFocusView(page);
});

Then('the Focus position group is centered and the header controls do not overlap', async ({ page }) => {
  const [bar, dialog, title, close, rightControls] = await Promise.all([
    progress(page).boundingBox(), viewer(page).boundingBox(),
    viewer(page).locator('div[title="IMG001.JPG"]').boundingBox(),
    viewer(page).getByRole('button', { name: 'Close Focus' }).boundingBox(),
    viewer(page).getByRole('button', { name: 'Close Focus' }).locator('..').boundingBox(),
  ]);
  expect(bar && dialog && title && close && rightControls).toBeTruthy();
  expect(Math.abs(bar!.x + bar!.width / 2 - (dialog!.x + dialog!.width / 2))).toBeLessThanOrEqual(2);
  expect(bar!.x).toBeGreaterThanOrEqual(0);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(dialog!.width);
  if (bar!.y < close!.y + close!.height) {
    expect(bar!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
    expect(bar!.x + bar!.width).toBeLessThanOrEqual(rightControls!.x + 1);
  } else {
    expect(bar!.y).toBeGreaterThanOrEqual(close!.y + close!.height - 1);
  }
  expect(close!.x + close!.width).toBeLessThanOrEqual(dialog!.x + dialog!.width);
  await expect(viewer(page).getByRole('button', { name: 'Close Focus' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
When('the Focus window becomes narrow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});
When('the Focus window becomes tablet sized', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 950 });
});
When('the Focus window becomes medium desktop sized', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
});
When('the Focus window becomes very narrow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
});
When('the Focus header has long filenames and location information with an EXIF warning', async ({ page }) => {
  await viewer(page).evaluate((dialog) => {
    const title = dialog.querySelector<HTMLElement>('div[title="IMG001.JPG"]');
    const location = dialog.querySelector<HTMLElement>('span[aria-label^="Deployment:"], span[aria-label^="Location:"]');
    if (!title || !location) throw new Error('Focus header elements were not found');
    title.textContent = `Focus · ${'A'.repeat(90)}.JPG`;
    location.textContent = `Long survey location ${'B'.repeat(90)} (SAN15)`;
    const warning = document.createElement('span');
    warning.textContent = 'EXIF Modified';
    warning.className = 'shrink-0 font-body text-[10px] border border-rule px-1';
    location.after(warning);
  });
});
When('the second upload is opened for position coverage', async ({ page }) => {
  await closeFocus(page);
  await sectionTab(page, 'Browse').click();
  await openUpload(page, 'fielduser');
  await enterFocusView(page);
});
When('the image filter has no matches for position coverage', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Match text').fill('NO-MATCH-538');
  await page.keyboard.press('Escape');
});
Then('the empty-results state has no position bar', async ({ page }) => {
  await expect(page.getByRole('status').filter({ hasText: 'No images match these filters.' })).toHaveText('No images match these filters.');
  await expect(progress(page)).toHaveCount(0);
});
