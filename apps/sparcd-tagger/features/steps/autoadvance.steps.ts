import type { Page } from '@playwright/test';
import {
  Given,
  When,
  Then,
  expect,
  sectionTab,
  focusedTile,
  speciesApply,
  openSettings,
} from './support/world';
import { autoAdvanceCheckbox } from './support/flows';

const focusedName = async (page: Page): Promise<string> =>
  (await focusedTile(page).first().getAttribute('title')) ?? '';

Given('auto-advance is switched on in Settings', async ({ page }) => {
  await openSettings(page);
  await autoAdvanceCheckbox(page).check();
  await sectionTab(page, 'Tag').click();
});

Given('the current focus is noted', async ({ page, scratch }) => {
  scratch.focusedBefore = await focusedName(page);
});

Then('auto-advance is unchecked in Settings', async ({ page }) => {
  await expect(autoAdvanceCheckbox(page)).not.toBeChecked();
});

When('a species not already on that image is applied from the panel', async ({ page }) => {
  await speciesApply(page, 'Canis latrans').click();
});

When('that species is applied again from the panel', async ({ page }) => {
  await speciesApply(page, 'Odocoileus hemionus').click();
});

When('a species is applied to the selection', async ({ page }) => {
  await speciesApply(page, 'Canis latrans').click();
});

Then('focus moves to the next image in the list', async ({ page, scratch }) => {
  await expect.poll(() => focusedName(page)).not.toBe(scratch.focusedBefore as string);
});

Then('focus stays on the same image', async ({ page, scratch }) => {
  await expect.poll(() => focusedName(page)).toBe(scratch.focusedBefore as string);
});
