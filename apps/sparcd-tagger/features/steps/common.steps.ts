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

Given('the connected account is ready for attribution', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await expect(page.locator('#user')).toHaveValue('testkey');
  await sectionTab(page, 'Tag').click();
  await expect(page.getByTestId('automatic-save')).toBeVisible();
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
