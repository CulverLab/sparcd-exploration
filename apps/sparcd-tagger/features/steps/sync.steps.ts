import type { Page } from '@playwright/test';
import { parseObservations, parseMedia } from '@sparcd/camtrap';
import {
  Given,
  When,
  Then,
  expect,
  openWorkspace,
  focusFrame,
  gridCell,
  speciesApply,
  sectionTab,
  uploadRow,
} from './support/world';
import {
  BUCKET,
  PREFIX_A,
  OBS_A,
  MEDIA_A,
  COLLECTION_NAME,
  STAMP_A,
  observationsCsv,
  mediaCsv,
} from './support/data';
import { sha256 } from './support/s3mock';
import {
  openSyncDialog,
  setSyncDryRun,
  settingsDryRunCheckbox,
  readStore,
  writeStore,
  waitForDirtyDrafts,
  waitForSyncDialogClosed,
} from './support/flows';

const statePill = (page: Page) => page.getByRole('status', { name: /^Sync status: / });

const canonicalPuts = (puts: { key: string }[]) =>
  puts.filter(
    (p) => !p.key.includes('.sparcd-tagger-snapshots/') && !p.key.includes('.sparcd-tagger-original/'),
  );

/** One cell of the preview's Added / Changed / Removed / Time-corrected grid. */
const summaryCell = (page: Page, label: string) =>
  page.locator('div.border.text-center').filter({ hasText: label });

const dialogClose = (page: Page) => page.getByRole('button', { name: 'Close', exact: true }).first();

// A live sync is over once its dialog offers Close, or has already closed
// itself (#304) — a slow refresh uses up the whole auto-close window.
async function syncFinished(page: Page): Promise<boolean> {
  const footerClose = page.locator('footer').getByRole('button', { name: 'Close', exact: true });
  if (await footerClose.count()) return true;
  return (await page.getByRole('heading', { name: 'Sync to S3' }).count()) === 0;
}



Given('the next canonical media HEAD fails without an S3 error code', async ({ s3 }) => {
  s3.failHeads(`${PREFIX_A}media.csv`);
});

Given('the next canonical media GET is denied with AccessDenied', async ({ s3 }) => {
  s3.failGetsWith(`${PREFIX_A}media.csv`, 0, 403, 'AccessDenied');
});





// --- The write itself -------------------------------------------------------







// --- Auto-close after a live sync (#304) ------------------------------------





const POST_SYNC_REFRESH_DELAY_MS = 1_500;

















// --- Preview ----------------------------------------------------------------

















// --- Dry-run gate -----------------------------------------------------------









// --- Nothing to sync --------------------------------------------------------







// --- Conflict ---------------------------------------------------------------













// --- Snapshot before replace ------------------------------------------------







// --- Only changed files are rewritten ---------------------------------------











// --- Post-sync consistency --------------------------------------------------









// --- Species stays visible across the post-sync refresh (#306) --------------

// A live sync reads `observations.csv` twice: once inside `performSync`
// itself (re-grounding the sync-conflict base right after the write) and
// again via `SyncDialog`'s own `invalidateQueries` call (refreshing the
// on-screen `TagImage[]`). The delay below applies to every matching request,
// so it holds open BOTH reads in sequence — the race this guards against
// (a clean draft rendered against a not-yet-refreshed base) can only land in
// the second of those two windows, not the first.
const REFRESH_DELAY_MS = 1200;







/** The corrected timestamp rendered in the Focus footer for its active frame. */
async function focusShownTime(page: Page): Promise<string> {
  const text = (await page.getByTestId('focus-timestamp').innerText()) ?? '';
  return text.match(/\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}(?::\d{2})?/)?.[0] ?? text.split('\n')[0].trim();
}



























// --- Busy dialog ------------------------------------------------------------





// --- Resume an interrupted sync ---------------------------------------------











// --- Backend that will not honour IfMatch -----------------------------------













// --- State pill -------------------------------------------------------------






// --- Blank-row upload diff counts (issue #89) --------------------------------
