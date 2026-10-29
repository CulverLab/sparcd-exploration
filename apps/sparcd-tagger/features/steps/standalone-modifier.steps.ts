import type { Page } from '@playwright/test';
import { parseObservations } from '@sparcd/camtrap';
import {
  Given, Then, expect, openWorkspace, openSettings, sectionTab, focusFrame, focusedTile,
  gridCell, selectedTiles, enterFocusView, closeFocusView, speciesAssignKey, speciesBadge, speciesFilter,
} from './support/world';
import { autoAdvanceCheckbox, waitForAutomaticSave } from './support/flows';
import { BUCKET, PREFIX_A, SETTINGS_BUCKET, SPECIES_JSON } from './support/data';

const keyCode = (modifier: string, side = 'Left') => `${modifier}${side}`;
const tap = async (page: Page, modifier: string, side = 'Left') => {
  await page.keyboard.down(keyCode(modifier, side));
  await page.keyboard.up(keyCode(modifier, side));
};
const rowsFor = (csv: string, file: string) => parseObservations(csv).filter(row => row.mediaId.endsWith(`/${file}`));
const csvKey = `${PREFIX_A}observations.csv`;
async function expectFocused(page: Page, file: string) {
  const viewer = page.getByRole('dialog', { name: 'Focus image viewer' });
  if (await viewer.count()) await expect(viewer.locator('div[title]').first()).toHaveAttribute('title', file);
  else await expect(focusedTile(page)).toHaveAttribute('title', file);
}

Given('a modifier tagging workspace in {string}', async ({ page }, view: string) => {
  await openWorkspace(page);
  await openSettings(page); await autoAdvanceCheckbox(page).uncheck();
  await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG002.JPG');
  if (view === 'Focus') await enterFocusView(page);
});

Given('{string} is assigned to Ghost with a standalone tap', async ({ page, s3 }, modifier: string) => {
  const before = s3.text(BUCKET, csvKey);
  await speciesAssignKey(page, 'Casper').click();
  const hint = page.getByText('press a key, or tap Shift/Control…', { exact: true });
  await expect(hint).toBeVisible();
  await page.keyboard.down(keyCode(modifier));
  await expect(hint).toBeVisible();
  expect(s3.text(BUCKET, csvKey)).toBe(before);
  await page.keyboard.up(keyCode(modifier));
  await expect(speciesBadge(page, 'Casper')).toHaveText(modifier.toUpperCase());
  await expect(hint).toHaveCount(0);
  await waitForAutomaticSave(page);
  // Assignment consumes its release instead of also applying the new binding.
  expect(s3.text(BUCKET, csvKey)).toBe(before);
});

Then('holding {string} {string} leaves tags unchanged until release and Ghost stays at one', async ({ page, s3 }, side: string, modifier: string) => {
  // Existing numeric prefix rules still keep Ghost at one.
  await page.keyboard.press('1'); await page.keyboard.press('5');
  const before = s3.text(BUCKET, csvKey);
  await page.keyboard.down(keyCode(modifier, side));
  await page.keyboard.down(keyCode(modifier, side)); // OS repeat while held
  expect(s3.text(BUCKET, csvKey)).toBe(before);
  await expectFocused(page, 'IMG002.JPG');
  await page.keyboard.up(keyCode(modifier, side));
  await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').map(row => [row.scientificName, row.count])).toEqual([['Casper', 1]]);
  await tap(page, modifier, side); await tap(page, modifier, side);
  await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').map(row => [row.scientificName, row.count])).toEqual([['Casper', 1]]);
  await expectFocused(page, 'IMG002.JPG');
});

Given('the official Ghost binding is {string}', async ({ s3 }, modifier: string) => {
  const rows = JSON.parse(SPECIES_JSON).map((row: { scientificName: string; keyBinding: string | null }) => row.scientificName === 'Casper' ? { ...row, keyBinding: modifier.toUpperCase() } : row);
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify(rows), 'application/json');
});
Then('the official {string} binding works from either side', async ({ page, s3 }, modifier: string) => {
  await expect(speciesBadge(page, 'Casper')).toHaveText(modifier.toUpperCase());
  await tap(page, modifier); await tap(page, modifier, 'Right');
  await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').map(row => [row.scientificName, row.count])).toEqual([['Casper', 1]]);
});
Then('the saved {string} binding survives reload and tags with the opposite side', async ({ page, s3 }, modifier: string) => {
  await page.reload(); await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  await expect(speciesBadge(page, 'Casper')).toHaveText(modifier.toUpperCase());
  await tap(page, modifier, 'Right'); await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').map(row => [row.scientificName, row.count])).toEqual([['Casper', 1]]);
});

Then('reassigning {string} requires confirmation and retains normal species counts', async ({ page, s3 }, modifier: string) => {
  const before = s3.text(BUCKET, csvKey);
  await speciesAssignKey(page, 'Canis latrans').click(); await tap(page, modifier);
  const confirm = page.getByRole('button', { name: 'Reassign key', exact: true });
  await expect(confirm).toBeVisible();
  await tap(page, modifier); expect(s3.text(BUCKET, csvKey)).toBe(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(speciesBadge(page, 'Casper')).toHaveText(modifier.toUpperCase());
  await speciesAssignKey(page, 'Canis latrans').click(); await tap(page, modifier);
  await confirm.click();
  await expect(speciesBadge(page, 'Canis latrans')).toHaveText(modifier.toUpperCase());
  expect(s3.text(BUCKET, csvKey)).toBe(before);
  await page.keyboard.press('1'); await page.keyboard.press('5'); await tap(page, modifier);
  await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').find(row => row.scientificName === 'Canis latrans')?.count).toBe(15);
  await tap(page, modifier); await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').find(row => row.scientificName === 'Canis latrans')?.count).toBe(16);
});

Then('{string} combinations retain existing shortcuts without tagging Ghost', async ({ page, s3 }, modifier: string) => {
  if (modifier === 'Shift') {
    await focusFrame(page, 'IMG001.JPG');
    await page.keyboard.down('ShiftLeft'); await gridCell(page, 'IMG002.JPG').click(); await page.keyboard.up('ShiftLeft');
    await expect(selectedTiles(page)).toHaveCount(2);
    await focusFrame(page, 'IMG002.JPG');
    await page.keyboard.press('Shift+Space');
    await expect(page.getByRole('button', { name: "Toggle needing an expert's opinion", exact: true })).toHaveAttribute('aria-pressed', 'true');
    await speciesFilter(page).fill('word'); await speciesFilter(page).press('Shift+KeyA');
    await expect(speciesFilter(page)).toHaveValue('wordA');
    await speciesFilter(page).press('Shift+Tab'); await expect(speciesFilter(page)).not.toBeFocused();
  } else {
    await page.keyboard.press('Control+a');
    expect(await selectedTiles(page).count()).toBeGreaterThan(0);
    await page.keyboard.press('Control+s');
  }
  await waitForAutomaticSave(page);
  expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').some(row => row.scientificName === 'Casper')).toBe(false);
});

Then('{string} taps in text entry and help dialogs make no tag changes', async ({ page, s3 }, modifier: string) => {
  const before = s3.text(BUCKET, csvKey);
  await speciesFilter(page).fill('test'); await tap(page, modifier);
  await expect(speciesFilter(page)).toHaveValue('test');
  await speciesFilter(page).fill('');
  await page.getByRole('button', { name: 'About the species list', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Using the species list', exact: true });
  await expect(help).toBeVisible(); await tap(page, modifier);
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape'); await waitForAutomaticSave(page);
  expect(s3.text(BUCKET, csvKey)).toBe(before);
});

Then('a {string} interrupts {string} without tagging', async ({ page, context, s3 }, interruption: string, modifier: string) => {
  const before = s3.text(BUCKET, csvKey);
  await page.keyboard.down(keyCode(modifier));
  if (interruption === 'pointer') await gridCell(page, 'IMG004.JPG').click();
  else if (interruption === 'wheel') await page.mouse.wheel(0, 80);
  else {
    // Playwright pins headless pages as focused. Disable that emulation while
    // another tab is active so Chrome emits a genuine page blur transition.
    const cdp = await context.newCDPSession(page);
    const other = await context.newPage();
    try {
      await other.bringToFront();
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
    } finally {
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await cdp.detach(); await other.close(); await page.bringToFront();
    }
  }
  await page.keyboard.up(keyCode(modifier)); await waitForAutomaticSave(page);
  expect(s3.text(BUCKET, csvKey)).toBe(before);
});

Then('{string} applies Ghost to the selection once and advances once', async ({ page, s3 }, modifier: string) => {
  const focus = await page.getByRole('dialog', { name: 'Focus image viewer' }).count() > 0;
  if (focus) await closeFocusView(page);
  await openSettings(page); await autoAdvanceCheckbox(page).check();
  await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG001.JPG');
  await gridCell(page, 'IMG002.JPG').click({ modifiers: ['ControlOrMeta'] });
  if (focus) await enterFocusView(page);
  await page.keyboard.down(keyCode(modifier));
  await expectFocused(page, 'IMG002.JPG');
  await page.keyboard.up(keyCode(modifier));
  await expectFocused(page, 'IMG003.JPG'); await waitForAutomaticSave(page);
  const observations = parseObservations(s3.text(BUCKET, csvKey));
  for (const name of ['IMG001.JPG', 'IMG002.JPG']) expect(observations.filter(row => row.mediaId.endsWith(`/${name}`)).map(row => [row.scientificName, row.count])).toEqual([['Casper', 1]]);
});

Then('{string} still tags after a Command shortcut with a missing letter release', async ({ page, s3 }, modifier: string) => {
  const before = s3.text(BUCKET, csvKey);
  await page.keyboard.down('MetaLeft');
  await page.keyboard.down('a');
  // Deliberately omit KeyA keyup until after the standalone tap, reproducing
  // the event stream macOS delivers when Command suppresses a letter release.
  try {
    await page.keyboard.up('MetaLeft');
    await waitForAutomaticSave(page);
    expect(s3.text(BUCKET, csvKey)).toBe(before);
    await tap(page, modifier, 'Right');
    await waitForAutomaticSave(page);
    expect(rowsFor(s3.text(BUCKET, csvKey), 'IMG002.JPG').map(row => [row.scientificName, row.count])).toEqual([['Casper', 1]]);
  } finally {
    await page.keyboard.up('a');
  }
});
