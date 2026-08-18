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

When('identifications are added, corrected or removed', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await focusFrame(page, 'IMG001.JPG');
  await page
    .locator('span.inline-flex')
    .filter({ hasText: 'Mule Deer' })
    .first()
    .locator('input[type="number"]')
    .fill('4');
  await focusFrame(page, 'IMG003.JPG');
  await page.getByRole('button', { name: 'Remove Ghost' }).click();
});

Then(
  "each change is written to this browser's local store shortly after it is made",
  async ({ page }) => {
    await waitForDirtyDrafts(page, 3);
    const drafts = (await readStore(page, 'drafts')) as {
      mediaPath: string;
      observations: { scientificName: string; count: number }[];
    }[];
    const by = (f: string) => drafts.find((d) => d.mediaPath.endsWith(f))!;
    expect(by('IMG002.JPG').observations.map((o) => o.scientificName)).toEqual(['Canis latrans']);
    expect(by('IMG001.JPG').observations[0].count).toBe(4);
    expect(by('IMG003.JPG').observations).toEqual([]);
  },
);

Then('the workspace states how many local edits are unsaved', async ({ page }) => {
  await expect(page.getByText(/3 unsaved · discard/)).toBeVisible();
});

// --- Explicit save ----------------------------------------------------------

When('the save action is used', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await page.keyboard.press('ControlOrMeta+s');
});

Then('any edit still waiting to be written is written immediately', async ({ page }) => {
  const drafts = (await readStore(page, 'drafts')) as { mediaPath: string; dirty: boolean }[];
  expect(drafts.some((d) => d.mediaPath.endsWith('IMG002.JPG') && d.dirty)).toBe(true);
});

Then('the workspace confirms that the work was saved', async ({ page }) => {
  await expect(page.getByText('saved ✓')).toBeVisible();
});

// --- Survives a reload ------------------------------------------------------

Given('local edits were made to an upload', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await waitForDirtyDrafts(page, 1);
});

When('the tab is closed and the same upload is opened again in that browser', async ({ page }) => {
  await page.reload();
  await connect(page);
  await selectCollection(page);
  await openUpload(page);
});

Then('the local edits are shown again on their images', async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

Then('they are still listed as unsynced', async ({ page }) => {
  await expect(page.getByText(/1 unsaved · discard/)).toBeVisible();
  await expect(gridCell(page, 'IMG002.JPG').locator('[title="unsaved edit"]')).toBeVisible();
});

// --- History listing --------------------------------------------------------

When('the History section is opened', async ({ page }) => {
  await sectionTab(page, 'History').click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});

When('History is opened', async ({ page }) => {
  await sectionTab(page, 'History').click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});

Then('every upload with unsaved local edits is listed', async ({ page }) => {
  // Edit two different uploads, so the list is genuinely cross-upload.
  await sectionTab(page, 'Browse').click();
  await uploadRow(page, 'priortagger').click();
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await sectionTab(page, 'Browse').click();
  await uploadRow(page, 'fielduser').click();
  await expect(gridCell(page, 'FOX001.JPG')).toBeVisible();
  await gridCell(page, 'FOX001.JPG').click();
  await speciesApply(page, 'Pecari tajacu').click();
  await waitForDirtyDrafts(page, 2);
  await sectionTab(page, 'History').click();
  await expect(historyEntries(page)).toHaveCount(2);
  await expect(historyEntries(page).filter({ hasText: 'priortagger' })).toHaveCount(1);
  await expect(historyEntries(page).filter({ hasText: 'fielduser' })).toHaveCount(1);
});

Then(
  'each entry shows how many edits it holds, how many carry a species, and when it was last edited',
  async ({ page }) => {
    const entry = historyEntries(page).filter({ hasText: 'priortagger' });
    await expect(entry).toContainText('1 unsaved');
    await expect(entry).toContainText('1 tagged');
    await expect(entry).toContainText(/edited \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    await expect(entry).toContainText(BUCKET);
  },
);

Then('the most recently edited upload is listed first', async ({ page }) => {
  await expect(historyEntries(page).first()).toContainText('fielduser');
});

Given('History lists an upload with unsaved edits', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await waitForDirtyDrafts(page, 1);
  await sectionTab(page, 'History').click();
  await expect(historyEntries(page)).toHaveCount(1);
});

When('that upload is opened from History', async ({ page }) => {
  await historyEntries(page).first().getByRole('button', { name: 'Open →' }).click();
});

Then(
  'the tagging workspace opens on that upload with its local edits intact',
  async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sync…' })).toBeVisible();
    await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
    await expect(page.getByText(/1 unsaved · discard/)).toBeVisible();
  },
);

// --- Discarding -------------------------------------------------------------

Given('an upload holds unsaved local edits', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await waitForDirtyDrafts(page, 1);
});

When('discarding them is chosen and confirmed', async ({ page }) => {
  page.once('dialog', (d) => d.accept());
  await page.getByText(/1 unsaved · discard/).click();
  await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
});

Then('those local edits are removed from this browser', async ({ page }) => {
  await expect.poll(async () => (await readStore(page, 'drafts')).length).toBe(0);
});

Then('the upload reads from the stored identifications again', async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG')).not.toContainText('Coyote');
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
});

Then('the stored collection was never changed by the discarded edits', async ({ s3 }) => {
  expect(s3.puts).toHaveLength(0);
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(observationsCsv(PREFIX_A, OBS_A));
});

When('discarding local edits is chosen', async ({ page, scratch }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await focusFrame(page, 'IMG005.JPG');
  await speciesApply(page, 'Pecari tajacu').click();
  await waitForDirtyDrafts(page, 2);
  const messages: string[] = [];
  page.once('dialog', async (d) => {
    messages.push(d.message());
    await d.dismiss();
  });
  await page.getByText(/2 unsaved · discard/).click();
  scratch.confirmMessages = messages;
});

Then('the number of edits about to be discarded is stated', async ({ scratch }) => {
  await expect
    .poll(() => (scratch.confirmMessages as string[]).join(' '))
    .toContain('Discard 2 local edit(s)');
});

Then('nothing is discarded unless the action is confirmed', async ({ page }) => {
  await expect(page.getByText(/2 unsaved · discard/)).toBeVisible();
  expect((await readStore(page, 'drafts')).length).toBe(2);
});

// --- Pinned conflict base ---------------------------------------------------

Given('local edits are outstanding for an upload', async ({ page, scratch }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await waitForDirtyDrafts(page, 1);
  const uploads = (await readStore(page, 'uploads')) as { observationsETag: string }[];
  scratch.groundedETag = uploads[0].observationsETag;
});

When("the upload's stored files are refreshed in the background", async ({ page, s3 }) => {
  // Something else rewrites the canonical file, then the workspace re-reads it.
  s3.put(
    BUCKET,
    `${PREFIX_A}observations.csv`,
    `${observationsCsv(PREFIX_A, OBS_A)}\n`,
    'text/csv',
  );
  await page.reload();
  await connect(page);
  await selectCollection(page);
  await openUpload(page);
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

Then('the version the edits were made against is not silently advanced', async ({
  page,
  scratch,
  s3,
}) => {
  const uploads = (await readStore(page, 'uploads')) as { observationsETag: string }[];
  expect(uploads[0].observationsETag).toBe(scratch.groundedETag as string);
  expect(uploads[0].observationsETag).not.toBe(
    `"${s3.etag(BUCKET, `${PREFIX_A}observations.csv`)}"`,
  );
});

Then('any change made elsewhere surfaces as a conflict when a sync is attempted', async ({
  page,
}) => {
  await openSyncDialog(page);
  await expect(page.getByText('Conflict — the upload changed since you loaded it.')).toBeVisible();
});

// --- Nothing outstanding ----------------------------------------------------

Given('no upload in this browser holds unsaved edits', async ({ page }) => {
  expect(await readStore(page, 'drafts')).toHaveLength(0);
});

Then('it states that there are no unsaved local edits', async ({ page }) => {
  await expect(page.getByText('No unsaved local edits. Everything here is clean.')).toBeVisible();
});

