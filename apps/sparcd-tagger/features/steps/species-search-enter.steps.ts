import { parseObservations } from '@sparcd/camtrap';
import {
  Given, Then, expect, openWorkspace, openSettings, sectionTab, focusFrame,
  enterFocusView, closeFocusView, gridCell, focusedTile, speciesApply, speciesFilter,
} from './support/world';
import { autoAdvanceCheckbox, sortSpeciesByRecentCheckbox, waitForAutomaticSave } from './support/flows';
import { BUCKET, SETTINGS_BUCKET, PREFIX_A, SPECIES_JSON, OBS_A, observationsCsv } from './support/data';

const RABBIT = 'Oryctolagus cuniculus';
const JACKRABBIT = 'Lepus californicus';
const recentFox = 'Vulpes alpha';
const rows = [
  { name: 'Black-tailed Jackrabbit', scientificName: JACKRABBIT },
  { name: 'Rabbit', scientificName: RABBIT },
  // Same common name and score: Fuse retains input order, not recency.
  { name: 'Fox', scientificName: 'Vulpes beta' },
  { name: 'Fox', scientificName: recentFox },
].map(row => ({ ...row, speciesIconURL: '', keyBinding: null }));
const panel = (page: import('@playwright/test').Page) => page.locator('[data-testid="species-panel"]:visible');
const csvKey = `${PREFIX_A}observations.csv`;
async function expectFocusedFile(page: import('@playwright/test').Page, filename: string) {
  const viewer = page.getByRole('dialog', { name: 'Focus image viewer' });
  if (await viewer.count()) await expect(viewer.locator('div[title]').first()).toHaveAttribute('title', filename);
  else await expect(focusedTile(page)).toHaveAttribute('title', filename);
}

Given('a species search vocabulary with ranked, fuzzy, and tied matches', async ({ s3 }) => {
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify([...rows, ...JSON.parse(SPECIES_JSON)]), 'application/json');
  s3.put(BUCKET, csvKey, observationsCsv(PREFIX_A, [...OBS_A, {
    ...OBS_A[0], id: 'search-rabbit', scientificName: RABBIT, count: 7, comments: '[COMMONNAME:Rabbit]',
  }]), 'text/csv');
});

Given('the Enter search workspace uses {string} ordering in {string}', async ({ page }, sort: string, view: string) => {
  await openWorkspace(page);
  await openSettings(page);
  await sortSpeciesByRecentCheckbox(page).setChecked(sort === 'recent-first');
  await autoAdvanceCheckbox(page).uncheck();
  await sectionTab(page, 'Tag').click();
  // Make less relevant and tied results recently used before searching on a clean frame.
  await focusFrame(page, 'IMG005.JPG');
  await speciesApply(page, JACKRABBIT).click();
  await speciesApply(page, recentFox).click();
  await waitForAutomaticSave(page);
  await expect(panel(page).locator('button[title^="Select "] span.italic').first()).toHaveText(sort === 'recent-first' ? recentFox : JACKRABBIT);
  await focusFrame(page, 'IMG002.JPG');
  if (view === 'Focus') await enterFocusView(page);
});

Then('searching {string} displays {string} first and Enter applies it', async ({ page, s3 }, query: string, scientificName: string) => {
  await speciesFilter(page).fill(query);
  await expect(panel(page).locator('button[title^="Select "] span.italic').first()).toHaveText(scientificName);
  if (query === 'rabit') expect([...rows, ...JSON.parse(SPECIES_JSON)].some(row =>
    row.name.toLowerCase().includes(query) || row.scientificName.toLowerCase().includes(query))).toBe(false);
  await speciesFilter(page).press('Enter');
  await expect(speciesFilter(page)).not.toBeFocused();
  await waitForAutomaticSave(page);
  const tags = parseObservations(s3.text(BUCKET, csvKey)).filter(row => row.mediaId.endsWith('/IMG002.JPG') && row.scientificName);
  expect(tags.map(row => [row.scientificName, row.count])).toEqual([[scientificName, 1]]);
  await expectFocusedFile(page, 'IMG002.JPG');
});

Then('Enter with a {string} species filter leaves all tags unchanged', async ({ page, s3 }, kind: string) => {
  const before = s3.text(BUCKET, csvKey);
  await speciesFilter(page).fill(kind === 'empty' ? '' : kind === 'whitespace' ? '   ' : 'zzzzzzzzzz');
  if (kind === 'no results') {
    await expect(panel(page).locator('button[title^="Select "] span.italic')).toHaveCount(0);
    await expect(panel(page).getByText('Tag as requested species', { exact: true })).toBeVisible();
  }
  else await expect(panel(page).locator('button[title^="Select "] span.italic').first()).toBeVisible();
  await speciesFilter(page).press('Enter');
  await expect(speciesFilter(page)).not.toBeFocused();
  await waitForAutomaticSave(page);
  expect(s3.text(BUCKET, csvKey)).toBe(before);
  await expectFocusedFile(page, 'IMG002.JPG');
});

Then('Enter applies the top species to the selection without incrementing existing counts', async ({ page, s3 }) => {
  const focusView = page.getByRole('dialog', { name: 'Focus image viewer' });
  const inFocus = await focusView.count() > 0;
  if (inFocus) await closeFocusView(page);
  await focusFrame(page, 'IMG001.JPG');
  await gridCell(page, 'IMG002.JPG').click({ modifiers: ['ControlOrMeta'] });
  if (inFocus) await enterFocusView(page);
  await speciesFilter(page).fill('rabbit');
  await speciesFilter(page).press('Enter');
  await waitForAutomaticSave(page);
  const tags = parseObservations(s3.text(BUCKET, csvKey));
  expect(tags.filter(row => row.scientificName === RABBIT).map(row => [row.mediaId.split('/').pop(), row.count]).sort()).toEqual([
    ['IMG001.JPG', 7], ['IMG002.JPG', 1],
  ]);
  expect(tags.find(row => row.mediaId.endsWith('/IMG001.JPG') && row.scientificName === 'Odocoileus hemionus')?.count).toBe(2);
  const counts = (csv: string) => parseObservations(csv).map(row => [row.mediaId, row.scientificName, row.count]);
  const beforeRepeat = counts(s3.text(BUCKET, csvKey));
  await speciesFilter(page).press('Enter');
  await waitForAutomaticSave(page);
  expect(counts(s3.text(BUCKET, csvKey))).toEqual(beforeRepeat);
});

Then('applying the top displayed species with Enter advances focus once', async ({ page, s3 }) => {
  const inFocus = await page.getByRole('dialog', { name: 'Focus image viewer' }).count() > 0;
  if (inFocus) await closeFocusView(page);
  await openSettings(page); await autoAdvanceCheckbox(page).check();
  await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG002.JPG');
  if (inFocus) await enterFocusView(page);
  await speciesFilter(page).fill('rabbit');
  await speciesFilter(page).press('Enter');
  await expectFocusedFile(page, 'IMG003.JPG');
  await waitForAutomaticSave(page);
  const taggedFiles = parseObservations(s3.text(BUCKET, csvKey)).filter(row => row.scientificName === RABBIT).map(row => row.mediaId.split('/').pop()).sort();
  expect(taggedFiles).toEqual(['IMG001.JPG', 'IMG002.JPG']);
});

Then('the {string} dialog blocks Enter in the species filter', async ({ page, s3 }, kind: string) => {
  const before = s3.text(BUCKET, csvKey);
  await speciesFilter(page).fill('rabbit');
  if (kind === 'species help') await page.getByRole('button', { name: 'About the species list', exact: true }).click();
  else { await speciesFilter(page).press('Escape'); await page.keyboard.press('?'); }
  const dialog = page.locator(`[role="dialog"][aria-label="${kind === 'species help' ? 'Using the species list' : 'Keyboard shortcuts'}"]`);
  await expect(dialog).toBeVisible();
  await speciesFilter(page).evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await waitForAutomaticSave(page);
  expect(s3.text(BUCKET, csvKey)).toBe(before);
});
