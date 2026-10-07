import type { Page } from '@playwright/test';
import { parseObservations, parseMedia, parseCsvRows, serializeCsvRows, OBS_COL } from '@sparcd/camtrap';
import {
  Given,
  When,
  Then,
  expect,
  openWorkspace,
  focusFrame,
  gridCell,
  listRow,
  speciesApply,
  sectionTab,
  enterFocusView,
  selectCollection,
  openUpload,
} from './support/world';
import { BUCKET, PREFIX_A, MEDIA_A } from './support/data';
import { openSyncDialog, setSyncDryRun, readStore, waitForDirtyDrafts, waitForSyncDialogClosed } from './support/flows';

/** One cell of the preview's Added / Changed / Removed / Time-corrected / Confirmed grid. */
const summaryCell = (page: Page, label: string) =>
  page.locator('div.border.text-center').filter({ hasText: label });

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const appliedChip = (page: Page, label: string) =>
  page.locator('span.inline-flex:not([data-testid="applied-species-summary"])').filter({ hasText: label }).first();

async function expandApplied(page: Page): Promise<void> {
  const summary = page.locator('button[title="Show all applied species"]');
  if (await summary.count()) await summary.click();
}

async function draftSpecies(page: Page, fileName: string): Promise<string[]> {
  const rows = (await readStore(page, 'drafts')) as {
    mediaPath: string;
    observations: { scientificName: string }[];
  }[];
  const row = rows.find((r) => r.mediaPath.endsWith(fileName));
  return (row?.observations ?? []).map((o) => o.scientificName);
}

const showList = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: '☰ List' }).click();
};

Given('an upload with existing identifications is open in the tagging workspace', async ({ page }) => {
  await openWorkspace(page);
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer');
});

Given('an upload from a producer that never populates observation_type is open in the tagging workspace', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
  await selectCollection(page);
  await openUpload(page, 'videoproducer');
});

// --- What existing identifications look like --------------------------------

Then("each image's tile shows the species already recorded for it", async ({ page }) => {
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
  await expect(gridCell(page, 'IMG003.JPG')).toContainText('Ghost');
  await expect(gridCell(page, 'IMG004.JPG')).toContainText('Mountain Lion');
});

Then('images without observations remain untagged', async ({ page }) => {
  await showList(page);
  for (const fileName of ['IMG002.JPG', 'IMG005.JPG', 'VID001.MP4']) {
    await expect(listRow(page, fileName)).toContainText('untagged');
  }
});

Then('an image with several species shows the first with a count of the rest', async ({ page }) => {
  await expect(gridCell(page, 'IMG004.JPG')).toContainText('Mountain Lion +1');
});

Then('an image with no species is labelled "untagged" in the list view', async ({ page }) => {
  await showList(page);
  await expect(listRow(page, 'IMG002.JPG')).toContainText('untagged');
  // Deviation, verified: a GRID tile with no species shows its file name
  // instead of the word "untagged".
  await page.getByRole('button', { name: '▦ Grid' }).click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('IMG002.JPG');
  await expect(gridCell(page, 'IMG002.JPG')).not.toContainText('untagged');
});

Given('an image with existing identifications is focused', async ({ page }) => {
  await focusFrame(page, 'IMG004.JPG');
});

Given('an image with mixed reviewed and unreviewed identifications is focused', async ({ page }) => {
  await focusFrame(page, 'IMG004.JPG');
  await expandApplied(page);
});

Then('each identification shows whether it is reviewed', async ({ page }) => {
  await expect(appliedChip(page, 'Coyote').getByText(/Reviewed by fielduser/)).toBeVisible();
  await expect(appliedChip(page, 'Mountain Lion').getByText('Not reviewed', { exact: true })).toBeVisible();
});

Then('the image tile reports a mixed review status', async ({ page }) => {
  await expect(gridCell(page, 'IMG004.JPG').locator('[data-column="review-status"]')).toHaveText('Mixed review');
});

Then('the list row reports a mixed review status', async ({ page }) => {
  await showList(page);
  await expect(listRow(page, 'IMG004.JPG').locator('[data-column="review-status"]')).toHaveText('Mixed review');
});

Then('an identification without a review event is labelled not reviewed', async ({ page }) => {
  await expect(listRow(page, 'IMG003.JPG').locator('[data-column="review-status"]')).toHaveText('Not reviewed');
});

Then('each recorded species is shown with its count', async ({ page }) => {
  await expandApplied(page);
  await expect(appliedChip(page, 'Mountain Lion').locator('input[type="number"]')).toHaveValue('1');
  await expect(appliedChip(page, 'Coyote').locator('input[type="number"]')).toHaveValue('3');
});

Then('a species recorded as a free-text request is marked as requested', async ({ page }) => {
  await expect(appliedChip(page, 'Coyote')).toContainText('requested');
});

Then('several species collapse to a summary that can be expanded', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse applied species' }).click();
  const summary = page.locator('[data-testid="applied-species-summary"]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('+1 more');
  // The entire summary row is the click target — not just the arrow glyph.
  await summary.click();
  await expect(appliedChip(page, 'Coyote')).toBeVisible();
});

// --- Corrections ------------------------------------------------------------

Given('the focused image records a species with a count', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await expect(appliedChip(page, 'Mule Deer').locator('input[type="number"]')).toHaveValue('2');
});

Given('the focused image carries an existing species to correct', async ({ page }) => {
  await focusFrame(page, 'IMG004.JPG');
  await expandApplied(page);
  await expect(appliedChip(page, 'Mountain Lion')).toBeVisible();
});

When('the existing species is replaced with another species', async ({ page }) => {
  await page.getByRole('button', { name: 'Remove Mountain Lion' }).click();
  await speciesApply(page, 'Pecari tajacu').click();
  await expect.poll(async () => (await draftSpecies(page, 'IMG004.JPG')).sort()).toEqual([
    'Canis latrans',
    'Pecari tajacu',
  ]);
  await waitForDirtyDrafts(page, 1);
});

Then('the stored replacement records the previous species as corrected', async ({ s3 }) => {
  const observations = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  const replacement = observations.find(
    (o) => o.mediaId.endsWith('IMG004.JPG') && o.scientificName === 'Pecari tajacu',
  );
  expect(replacement).toBeTruthy();
  expect(replacement!.tags).toContain('[CORRECTED_FROM:Puma concolor]');
  expect(
    observations.some((o) => o.mediaId.endsWith('IMG004.JPG') && o.scientificName === 'Puma concolor'),
  ).toBe(false);
  // The swap is recorded once, as the correction; no row also marks it removed.
  expect(
    observations.some((o) => o.mediaId.endsWith('IMG004.JPG') && o.tags.includes('[REMOVED:Puma concolor]')),
  ).toBe(false);
});

When('the count is changed', async ({ page }) => {
  await appliedChip(page, 'Mule Deer').locator('input[type="number"]').fill('5');
});

Then('the new count is held against that species for that image', async ({ page }) => {
  await expect(appliedChip(page, 'Mule Deer').locator('input[type="number"]')).toHaveValue('5');
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×5');
  await expect
    .poll(async () => {
      const rows = (await readStore(page, 'drafts')) as {
        mediaPath: string;
        observations: { scientificName: string; count: number }[];
      }[];
      const row = rows.find((r) => r.mediaPath.endsWith('IMG001.JPG'));
      return row?.observations.find((o) => o.scientificName === 'Odocoileus hemionus')?.count;
    })
    .toBe(5);
});

Then('a count below one is not accepted', async ({ page }) => {
  const input = appliedChip(page, 'Mule Deer').locator('input[type="number"]');
  await expect(input).toHaveAttribute('min', '1');
  await input.fill('0');
  await expect(input).toHaveValue('1');
  await expect(gridCell(page, 'IMG001.JPG')).not.toContainText('×0');
});

Given('the focused image carries several species', async ({ page }) => {
  await focusFrame(page, 'IMG004.JPG');
  await expandApplied(page);
  await expect(appliedChip(page, 'Mountain Lion')).toBeVisible();
  await expect(appliedChip(page, 'Coyote')).toBeVisible();
});

When('one of them is removed', async ({ page }) => {
  await page.getByRole('button', { name: 'Remove Coyote' }).click();
});

Then('only that species is dropped', async ({ page }) => {
  await expect(appliedChip(page, 'Coyote')).toHaveCount(0);
  await expect.poll(async () => draftSpecies(page, 'IMG004.JPG')).toEqual(['Puma concolor']);
});

Then('the remaining species and their counts are preserved', async ({ page }) => {
  await expect(appliedChip(page, 'Mountain Lion').locator('input[type="number"]')).toHaveValue('1');
  await expect(gridCell(page, 'IMG004.JPG')).toContainText('Mountain Lion');
  await expect(gridCell(page, 'IMG004.JPG')).not.toContainText('+1');
});

Then('the removed species is absent from the stored image and marked as removed', async ({ s3 }) => {
  const obs = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  expect(obs.some((o) => o.mediaId.endsWith('IMG004.JPG') && o.scientificName === 'Canis latrans')).toBe(false);
  const remaining = obs.find((o) => o.mediaId.endsWith('IMG004.JPG') && o.scientificName === 'Puma concolor');
  expect(remaining?.tags).toContain('[REMOVED:Canis latrans]');
});

// --- Clear Species ------------------------------------------------------------------

// The Focus footer's own control and the applied-species strip's control
// (AppliedSpecies.tsx) both say "Clear Species" now and do the same thing —
// disambiguate by title, since the two accessible names collide.
const focusClearSpecies = (page: Page) => page.getByTitle('Remove every species from this image');

Given('the focused image carries at least one species', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await enterFocusView(page);
  await expect(focusClearSpecies(page)).toBeEnabled();
});

When('Clear Species is used', async ({ page }) => {
  await focusClearSpecies(page).click();
});

Then('the image is left with no species', async ({ page }) => {
  await expect.poll(async () => draftSpecies(page, 'IMG001.JPG')).toEqual([]);
});

Then('it reads as untagged again', async ({ page }) => {
  await expect(listRow(page, 'IMG001.JPG')).toContainText('untagged');
});

Then('the Clear Species control is unavailable on an image that has none', async ({ page }) => {
  await expect(focusClearSpecies(page)).toBeDisabled();
  await listRow(page, 'IMG004.JPG').click();
  await expect(focusClearSpecies(page)).toBeEnabled();
});

When('identifications are cleared', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await focusClearSpecies(page).click();
});

Then('every selected image is left with no species', async ({ page }) => {
  for (const f of ['IMG001.JPG', 'IMG002.JPG', 'IMG003.JPG']) {
    await expect.poll(async () => draftSpecies(page, f)).toEqual([]);
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(gridCell(page, 'IMG001.JPG')).not.toContainText('Mule Deer');
  await expect(gridCell(page, 'IMG003.JPG')).not.toContainText('Ghost');
});

// --- Questionable -----------------------------------------------------------

When('it is marked questionable', async ({ page }) => {
  await page.keyboard.press('Shift+Space');
});

Then("the image's tile carries a questionable marker", async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG').locator('[title="questionable"]')).toBeVisible();
});

Then('the marker can be toggled off again', async ({ page }) => {
  await page.keyboard.press('Shift+Space');
  await expect(gridCell(page, 'IMG002.JPG').locator('[title="questionable"]')).toHaveCount(0);
});

Then('a selection of images can be marked in one action', async ({ page }) => {
  await gridCell(page, 'IMG001.JPG').click();
  await gridCell(page, 'IMG003.JPG').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+Space');
  for (const f of ['IMG001.JPG', 'IMG002.JPG', 'IMG003.JPG']) {
    await expect(gridCell(page, f).locator('[title="questionable"]')).toBeVisible();
  }
});

// --- Confirmation records a review (#368) -----------------------------------

Given('an existing identification is re-applied unchanged', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await speciesApply(page, 'Odocoileus hemionus').click();
});

Given('an existing identification has original attribution', async ({ page, s3 }) => {
  const key = `${PREFIX_A}observations.csv`;
  const rows = parseCsvRows(s3.text(BUCKET, key));
  const row = rows.find((cells) => cells[OBS_COL.mediaId]?.endsWith('IMG001.JPG'))!;
  row[OBS_COL.classifiedBy] = 'fielduser';
  row[OBS_COL.classificationTimestamp] = '2024-01-11T00:00:00.000Z';
  s3.put(BUCKET, key, serializeCsvRows(rows), 'text/csv');
  await page.reload();
  await openWorkspace(page);
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer');
  await expect(page.locator('[aria-label="Originally identified by fielduser"]')).toBeVisible();
});

Given('the original upload data is captured before a review', async ({ s3, scratch }) => {
  // Keep this baseline scenario independent from the restore fixture's older
  // snapshots: the captured canonical files are the upload's first observed
  // state, so an unrelated historical snapshot must not become its source.
  for (const key of s3.keys(BUCKET, `${PREFIX_A}.sparcd-tagger-snapshots/`)) s3.delete(BUCKET, key);
  const mediaKey = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`))[0].mediaPath;
  scratch.originalBaseline = {
    media: s3.text(BUCKET, `${PREFIX_A}media.csv`),
    deployments: s3.text(BUCKET, `${PREFIX_A}deployments.csv`),
    observations: s3.text(BUCKET, `${PREFIX_A}observations.csv`),
    uploadMeta: s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`),
    imageKey: mediaKey,
    image: s3.get(BUCKET, mediaKey)?.body.toString('base64'),
  };
});

When('a sync is previewed', async ({ page }) => {
  await openSyncDialog(page);
});

Then('the preview reports one confirmed image and no other change', async ({ page }) => {
  await expect(summaryCell(page, 'Added')).toHaveText('0Added');
  await expect(summaryCell(page, 'Changed')).toHaveText('0Changed');
  await expect(summaryCell(page, 'Removed')).toHaveText('0Removed');
  await expect(summaryCell(page, 'Confirmed')).toHaveText('1Confirmed');
});

When('that sync is run live', async ({ page }) => {
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
});

Then(
  "the confirmed image's stored identification is stamped with the reviewer and the time of the review",
  async ({ s3 }) => {
    const obs = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
    const row = obs.find(
      (o) => o.mediaId.endsWith('IMG001.JPG') && o.scientificName === 'Odocoileus hemionus',
    );
    expect(row).toBeTruthy();
    expect(row!.classifiedBy).toBe('testkey');
    expect(row!.classificationTimestamp).toMatch(ISO_TIMESTAMP);
    expect(row!.reviewEvents).toEqual([{ reviewedBy: 'testkey', reviewedAt: expect.stringMatching(ISO_TIMESTAMP) }]);
  },
);

Then('the original identifier and separate review remain visible in the stored image', async ({ s3 }) => {
  const obs = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  const row = obs.find((o) => o.mediaId.endsWith('IMG001.JPG') && o.scientificName === 'Odocoileus hemionus');
  expect(row).toMatchObject({
    classifiedBy: 'fielduser',
    classificationTimestamp: '2024-01-11T00:00:00.000Z',
  });
  expect(row?.reviewEvents).toEqual([{ reviewedBy: 'testkey', reviewedAt: expect.stringMatching(ISO_TIMESTAMP) }]);
});

Then('the original uploaded data remains byte-for-byte intact', async ({ s3, scratch }) => {
  const original = scratch.originalBaseline as {
    media: string;
    deployments: string;
    observations: string;
    uploadMeta: string;
    imageKey: string;
    image: string;
  };
  expect(s3.text(BUCKET, `${PREFIX_A}.sparcd-tagger-original/media.csv`)).toBe(original.media);
  expect(s3.text(BUCKET, `${PREFIX_A}.sparcd-tagger-original/deployments.csv`)).toBe(original.deployments);
  expect(s3.text(BUCKET, `${PREFIX_A}.sparcd-tagger-original/observations.csv`)).toBe(original.observations);
  expect(s3.text(BUCKET, `${PREFIX_A}.sparcd-tagger-original/UploadMeta.json`)).toBe(original.uploadMeta);
  expect(s3.get(BUCKET, original.imageKey)?.body.toString('base64')).toBe(original.image);
  expect(s3.has(BUCKET, `${PREFIX_A}.sparcd-tagger-original/manifest.json`)).toBe(true);
  expect(s3.putsFor(`${PREFIX_A}.sparcd-tagger-original/`)).toHaveLength(5);
});

When('another review is made locally', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
});

function expectAuditSnapshot(s3: { puts: { key: string; body: string }[] }): void {
  const manifests = s3.puts.filter((put) =>
    put.key.includes('.sparcd-tagger-snapshots/testkey/') && put.key.endsWith('manifest.json'),
  );
  expect(manifests.length).toBeGreaterThan(0);
  for (const item of manifests) {
    const manifest = JSON.parse(item.body) as { user?: string; editStamp?: string };
    expect(manifest.user).toBe('testkey');
    expect(manifest.editStamp).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/);
  }
}

Then('the live audit records the correction identity and time', async ({ s3 }) => {
  const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)) as { editComments: string[] };
  expect(meta.editComments.some((comment) => comment.includes('testkey'))).toBe(true);
  expectAuditSnapshot(s3);
});

Then('the live audit records the removal identity and time', async ({ s3 }) => {
  const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)) as { editComments: string[] };
  expect(meta.editComments.some((comment) => comment.includes('testkey'))).toBe(true);
  expectAuditSnapshot(s3);
});

Then(
  "the corrected image's stored identification is stamped with the reviewer and the time of the review",
  async ({ s3 }) => {
    const obs = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
    const row = obs.find(
      (o) => o.mediaId.endsWith('IMG002.JPG') && o.scientificName === 'Canis latrans',
    );
    expect(row).toBeTruthy();
    expect(row!.classifiedBy).toBe('testkey');
    expect(row!.classificationTimestamp).toMatch(ISO_TIMESTAMP);
  },
);

// --- Attribution ------------------------------------------------------------

Given('identifications were corrected locally', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await expect(page.locator('#user')).toHaveValue('tes…key');
  await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

When('a live sync is run', async ({ page }) => {
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
});

Then(
  'the upload\'s metadata gains an edit comment carrying the connected account and the time of the edit',
  async ({ s3 }) => {
    const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)) as {
      editComments: string[];
    };
    const last = meta.editComments[meta.editComments.length - 1];
    expect(last).toContain('testkey');
    expect(last).toMatch(/\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}/);
  },
);

Then('the pre-change snapshot of the upload is filed under that same identity', async ({ s3 }) => {
  const snapshots = s3.puts.filter((p) => p.key.includes('.sparcd-tagger-snapshots/'));
  expect(snapshots.length).toBeGreaterThan(0);
  for (const p of snapshots) expect(p.key).toContain('.sparcd-tagger-snapshots/testkey/');
  expect(snapshots.some((p) => p.key.endsWith('manifest.json'))).toBe(true);
});

// --- Unsaved-edit marker ----------------------------------------------------

Given("an image's identifications were changed in this browser", async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

Then('its tile carries an unsaved-edit marker', async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG').locator('[title="unsaved edit"]')).toBeVisible();
  await expect(gridCell(page, 'IMG005.JPG').locator('[title="unsaved edit"]')).toHaveCount(0);
});

Then('the marker is cleared for that image once its change has been synced', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await expect(page.locator('#user')).toHaveValue('tes…key');
  await sectionTab(page, 'Tag').click();
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
  await waitForSyncDialogClosed(page);
  await expect(gridCell(page, 'IMG002.JPG').locator('[title="unsaved edit"]')).toHaveCount(0);
});

// --- Blank-row uploads (issue #89) ------------------------------------------

Given('an upload with only uploader-written blank rows is open in the tagging workspace', async ({ page }) => {
  // Navigate to Browse explicitly — the H3 background may have already opened
  // a different workspace, and openAppConnected skips reconnection in that state,
  // leaving selectCollection unable to surface the upload list heading.
  await sectionTab(page, 'Browse').click();
  await selectCollection(page);
  await openUpload(page, 'newuploader');
  await expect(gridCell(page, 'IMG001.JPG')).not.toContainText('Deer');
  await expect(gridCell(page, 'IMG001.JPG')).not.toContainText('Coyote');
});

Then('every image tile is shown as untagged', async ({ page }) => {
  for (const m of MEDIA_A.filter((m) => !m.file.endsWith('.MP4'))) {
    // A tile with no species shows only its filename — "untagged" is list-view only.
    // The key assertion is that no species name bleeds through from the blank row.
    await expect(gridCell(page, m.file)).not.toContainText('×');
  }
});

Then('the list view labels every image "untagged"', async ({ page }) => {
  await page.getByRole('button', { name: '☰ List' }).click();
  for (const m of MEDIA_A) {
    await expect(listRow(page, m.file)).toContainText('untagged');
  }
});

When('the Sync dialog is opened for a blank-row upload', async ({ page }) => {
  await openSyncDialog(page);
});

Then('the sync reports there is nothing to sync', async ({ page }) => {
  await expect(
    page.getByText('No local edits to sync — everything matches the canonical files.'),
  ).toBeVisible();
});
