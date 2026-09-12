import type { Page } from '@playwright/test';
import { Given, When, Then, expect, sectionTab, listRow, openSettings } from './support/world';
import { settingsRadio } from './support/flows';

const correctedTimeText = (page: Page) => page.locator('span.font-mono.font-\\[600\\]').first();

const shiftPreview = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Time shift"] div.border.bg-panel').first();

Given('the date format is switched to Numeric date in Settings', async ({ page }) => {
  await openSettings(page);
  await settingsRadio(page, 'Numeric date').check();
  await sectionTab(page, 'Tag').click();
});

Given('the time format is switched to 12-hour in Settings', async ({ page }) => {
  await openSettings(page);
  await settingsRadio(page, '12-hour (AM/PM)').check();
  await sectionTab(page, 'Tag').click();
});

Given('the date format is switched to Month Day Short Year in Settings', async ({ page }) => {
  await openSettings(page);
  await settingsRadio(page, 'Month Day Short Year').check();
  await sectionTab(page, 'Tag').click();
});

Given('the time format is switched to 12-hour with seconds in Settings', async ({ page }) => {
  await openSettings(page);
  await settingsRadio(page, '12-hour with seconds (AM/PM)').check();
  await sectionTab(page, 'Tag').click();
});

Given('distance units are switched to feet in Settings', async ({ page }) => {
  await openSettings(page);
  await settingsRadio(page, 'Feet').check();
  await sectionTab(page, 'Tag').click();
});

When('the enlarged Focus view is opened', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adjust time' })).toBeVisible();
});

Then('the date format defaults to ISO local date', async ({ page }) => {
  await expect(settingsRadio(page, 'ISO local date')).toBeChecked();
});

Then('the time format defaults to 24-hour', async ({ page }) => {
  await expect(settingsRadio(page, '24-hour')).toBeChecked();
});

Then("the focused image's corrected time is shown in that date order", async ({ page }) => {
  await expect(correctedTimeText(page)).toContainText('1/10/2024');
});

Then('the Overview list shows capture times in that date order', async ({ page }) => {
  await expect(listRow(page, 'IMG002.JPG').locator('[data-column="timestamp"]')).toContainText(
    '1/10/2024',
  );
});

Then("the focused image's corrected time carries an AM\\/PM marker", async ({ page }) => {
  await expect(correctedTimeText(page)).toContainText('AM');
});

Then('a choice of meters or feet is offered for distance units', async ({ page }) => {
  await expect(settingsRadio(page, 'Meters')).toBeVisible();
  await expect(settingsRadio(page, 'Feet')).toBeVisible();
});

Then('the shift preview shows times with an AM\\/PM marker', async ({ page }) => {
  await expect(shiftPreview(page)).toContainText(/AM|PM/);
});

Then('burst bands show their time span with an AM\\/PM marker', async ({ page }) => {
  await expect(page.getByText(/^Burst \d+ ·/).first()).toContainText(/AM|PM/);
});

When('the browser is reloaded', async ({ page }) => {
  await page.reload();
});

Then('the selected display preferences are retained', async ({ page }) => {
  await expect(settingsRadio(page, 'Month Day Short Year')).toBeChecked();
  await expect(settingsRadio(page, '12-hour with seconds (AM/PM)')).toBeChecked();
  await expect(settingsRadio(page, 'Feet')).toBeChecked();
});
