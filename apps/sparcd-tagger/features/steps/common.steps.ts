// Steps shared by more than one feature file.

import {
  Given,
  expect,
  openWorkspace,
  focusFrame,
  gridCell,
  sectionTab,
  positionReadout,
} from './support/world';
import { settingsDryRunCheckbox, burstCheckbox } from './support/flows';

Given('an upload is open in the tagging workspace', async ({ page }) => {
  await openWorkspace(page);
});

Given('an image is focused', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
});

Given('several images are selected', async ({ page }) => {
  await gridCell(page, 'IMG001.JPG').click();
  await gridCell(page, 'IMG003.JPG').click({ modifiers: ['Shift'] });
  await expect(positionReadout(page)).toHaveText('3 selected');
});

Given('a tagger identity has been set in Settings', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await sectionTab(page, 'Tag').click();
  await expect(page.getByRole('button', { name: 'Sync…' })).toBeVisible();
});

Given('the dry-run setting has been switched off', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await settingsDryRunCheckbox(page).uncheck();
  await sectionTab(page, 'Tag').click();
  await expect(page.getByRole('button', { name: 'Sync…' })).toBeVisible();
});

Given('burst grouping is switched on in Settings', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await burstCheckbox(page).check();
  await sectionTab(page, 'Tag').click();
  await expect(page.getByText(/^Burst 1 ·/)).toBeVisible();
});

Given('burst grouping is switched on', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await burstCheckbox(page).check();
  await sectionTab(page, 'Tag').click();
  await expect(page.getByText(/^Burst 1 ·/)).toBeVisible();
});

