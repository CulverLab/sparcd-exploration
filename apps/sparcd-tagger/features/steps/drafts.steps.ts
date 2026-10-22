import type { Page } from '@playwright/test';
import {
  Given,
  When,
  Then,
  expect,
  connect,
  selectCollection,
  openUpload,
  sectionTab,
  focusFrame,
  gridCell,
  speciesApply,
  uploadRow,
} from './support/world';
import { BUCKET, PREFIX_A, OBS_A, observationsCsv } from './support/data';
import { openSyncDialog, readStore, waitForDirtyDrafts } from './support/flows';

const historyEntries = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Unsynced local edits' }) })
    .locator('ul > li');

// --- Every edit is kept locally ---------------------------------------------







// --- Explicit save ----------------------------------------------------------







// --- Survives a reload ------------------------------------------------------









// --- Recovery listing --------------------------------------------------------

When('the Recovery section is opened', async ({ page }) => {
  await sectionTab(page, 'Recovery').click();
  await expect(page.getByRole('heading', { name: 'Recovery' })).toBeVisible();
});















// --- Discarding -------------------------------------------------------------























// --- Pinned conflict base ---------------------------------------------------









// --- Nothing outstanding ----------------------------------------------------
