import type { Page } from '@playwright/test';
import {
  Given,
  When,
  Then,
  expect,
  sectionTab,
  focusFrame,
  gridCell,
  speciesApply,
  uploadRow,
} from './support/world';
import {
  BUCKET,
  PREFIX_A,
  PREFIX_B,
  OBS_A,
  observationsCsv,
  SNAPSHOT_PREFIX,
  PARTIAL_SNAPSHOT_PREFIX,
  SNAPSHOT_STAMP,
  SNAPSHOT_USER,
} from './support/data';
import { readStore, settingsDryRunCheckbox, waitForDirtyDrafts } from './support/flows';

const snapshotDialog = (page: Page) =>
  page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: /Snapshots|Restore snapshot/ }) });

const snapshotItems = (page: Page) => snapshotDialog(page).locator('ul > li');

async function openSnapshots(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Snapshots…' }).click();
  await expect(snapshotDialog(page)).toBeVisible();
  await expect(page.getByText('Listing snapshots…')).toBeHidden();
}

// --- Listing ----------------------------------------------------------------

When('the snapshots list is opened', async ({ page }) => {
  await openSnapshots(page);
});

Then('every complete snapshot of this upload is listed, most recent first', async ({ page }) => {
  await expect(snapshotItems(page)).toHaveCount(1);
  await expect(snapshotItems(page).first()).toContainText('2024-02-01 12:00:00');
});

Then(
  'each entry states when it was taken, by which tagger identity, and how many files it holds',
  async ({ page }) => {
    const item = snapshotItems(page).first();
    await expect(item).toContainText('2024-02-01 12:00:00');
    await expect(item).toContainText(SNAPSHOT_USER);
    await expect(item).toContainText('3 files');
  },
);

Given('a snapshot was interrupted before it was fully written', async ({ s3 }) => {
  expect(s3.has(BUCKET, `${PARTIAL_SNAPSHOT_PREFIX}media.csv`)).toBe(true);
  expect(s3.has(BUCKET, `${PARTIAL_SNAPSHOT_PREFIX}manifest.json`)).toBe(false);
});

Then('it is not listed as recoverable', async ({ page }) => {
  await openSnapshots(page);
  await expect(snapshotItems(page)).toHaveCount(1);
  await expect(snapshotDialog(page)).not.toContainText('2024-03-01');
});

Given('no sync has ever been run for this upload', async ({ page, s3 }) => {
  expect(s3.keys(BUCKET, `${PREFIX_B}.sparcd-tagger-snapshots/`)).toHaveLength(0);
  await sectionTab(page, 'Browse').click();
  await uploadRow(page, 'fielduser').click();
  await expect(gridCell(page, 'FOX001.JPG')).toBeVisible();
});

Then('it states that snapshots are created the first time the upload is synced', async ({ page }) => {
  await expect(
    page.getByText('No snapshots yet. They are created the first time you sync this upload.'),
  ).toBeVisible();
});

// --- Restore preview --------------------------------------------------------

When('a snapshot is chosen for restore', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await sectionTab(page, 'Tag').click();
  await openSnapshots(page);
  await snapshotItems(page).first().getByRole('button', { name: 'Restore…' }).click();
  await expect(page.getByText('Comparing the snapshot to the current files…')).toBeHidden();
});

Then('it is compared against the currently stored files without writing anything', async ({
  page,
  s3,
}) => {
  await expect(page.getByText(/Would restore \d+ file\(s\)/)).toBeVisible();
  expect(s3.puts).toHaveLength(0);
});

Then('the files it would rewrite are listed', async ({ page }) => {
  await expect(page.getByText(/Would restore/)).toContainText('observations, uploadMeta');
});

Then('where the pre-restore snapshot would be filed is shown', async ({ page }) => {
  await expect(page.getByText(/current state snapshotted →/)).toContainText(
    `${PREFIX_A}.sparcd-tagger-snapshots/jgonzalez/`,
  );
});

// --- Restore gating ---------------------------------------------------------

Given('a snapshot has been chosen', async ({ page }) => {
  await openSnapshots(page);
  await snapshotItems(page).first().getByRole('button', { name: 'Restore…' }).click();
  await expect(page.getByText('Comparing the snapshot to the current files…')).toBeHidden();
});

Then('a restore cannot be run without a tagger identity', async ({ page }) => {
  await expect(page.getByText('Set a Tagger identity in Settings first')).toBeVisible();
  await expect(page.getByRole('button', { name: /Restore now|Run dry-run/ })).toBeDisabled();
});

Then(
  'while the dry-run setting is on, running it reports that nothing was written',
  async ({ page, s3 }) => {
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await sectionTab(page, 'Settings').click();
    await expect(settingsDryRunCheckbox(page)).toBeChecked();
    await page.locator('#user').fill('jgonzalez');
    await sectionTab(page, 'Tag').click();
    await openSnapshots(page);
    await snapshotItems(page).first().getByRole('button', { name: 'Restore…' }).click();
    await page.getByRole('button', { name: 'Run dry-run' }).click();
    await expect(page.getByText('Dry-run complete — nothing was written.')).toBeVisible();
    expect(s3.puts).toHaveLength(0);
  },
);

// --- Live restore -----------------------------------------------------------

When('a snapshot is restored', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await sectionTab(page, 'Tag').click();
  await openSnapshots(page);
  await snapshotItems(page).first().getByRole('button', { name: 'Restore…' }).click();
  await expect(page.getByText('Comparing the snapshot to the current files…')).toBeHidden();
  const dryRun = page
    .locator('label')
    .filter({ hasText: 'Dry-run — log the writes' })
    .locator('input[type="checkbox"]');
  if (await dryRun.count()) await dryRun.uncheck();
  await page.getByRole('button', { name: 'Restore now' }).click();
  await expect(
    page.getByText('Restored — canonical files replaced from the snapshot.'),
  ).toBeVisible();
});

Then(
  'the current stored files are first copied to a new snapshot filed under the restoring identity',
  async ({ s3 }) => {
    const snaps = s3.puts.filter((p) => p.key.includes('.sparcd-tagger-snapshots/jgonzalez/'));
    expect(snaps.map((p) => p.key.split('/').pop())).toEqual([
      'media.csv',
      'observations.csv',
      'UploadMeta.json',
      'manifest.json',
    ]);
    // The copy holds the state that was there before the restore.
    expect(snaps[1].body).toBe(observationsCsv(PREFIX_A, OBS_A));
  },
);

Then("only then are the snapshot's versions written back in place", async ({ s3 }) => {
  const lastSnapshot = s3.puts.findLastIndex((p) => p.key.includes('.sparcd-tagger-snapshots/'));
  const canonical = s3.puts.filter((p) => !p.key.includes('.sparcd-tagger-snapshots/'));
  expect(canonical.length).toBeGreaterThan(0);
  expect(s3.puts.indexOf(canonical[0])).toBeGreaterThan(lastSnapshot);
  expect(canonical.every((p) => p.ifMatch !== undefined)).toBe(true);
  // The bytes written back are the snapshot's, verbatim.
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(
    s3.text(BUCKET, `${SNAPSHOT_PREFIX}observations.csv`),
  );
});

Given('the stored files changed since the restore was previewed', async ({ page, s3 }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await settingsDryRunCheckbox(page).uncheck();
  await sectionTab(page, 'Tag').click();
  await openSnapshots(page);
  await snapshotItems(page).first().getByRole('button', { name: 'Restore…' }).click();
  await expect(page.getByText('Comparing the snapshot to the current files…')).toBeHidden();
  // A third party rewrites the canonical file between preview and run. The
  // restore takes IfMatch against the ETag it just read, so the write is refused.
  s3.put(BUCKET, `${PREFIX_A}observations.csv`, 'rewritten elsewhere', 'text/csv');
});

When('the restore is run', async ({ page }) => {
  await page.getByRole('button', { name: 'Restore now' }).click();
  await expect(page.getByText(/Conflict|Restored/)).toBeVisible();
});

Then('the restore replaces the files it re-read at the moment it ran', async ({ page, s3 }) => {
  await expect(
    page.getByText('Restored — canonical files replaced from the snapshot.'),
  ).toBeVisible();
  // The third party's bytes are gone: the restore never saw them at preview
  // time, re-read them at run time, and wrote the snapshot over them.
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(
    s3.text(BUCKET, `${SNAPSHOT_PREFIX}observations.csv`),
  );
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).not.toBe('rewritten elsewhere');
});

Then(
  'every replacement still carries the precondition that catches a change made mid-write',
  async ({ s3 }) => {
    const canonical = s3.puts.filter((p) => !p.key.includes('.sparcd-tagger-snapshots/'));
    expect(canonical.length).toBeGreaterThan(0);
    expect(canonical.every((p) => !!p.ifMatch)).toBe(true);
    // And the pre-restore snapshot captured the third party's state, so it is
    // recoverable rather than lost.
    const snaps = s3.puts.filter((p) => p.key.includes('.sparcd-tagger-snapshots/jgonzalez/'));
    expect(snaps.find((p) => p.key.endsWith('observations.csv'))!.body).toBe('rewritten elsewhere');
  },
);

Given('the chosen snapshot matches the currently stored files', async ({ page, s3 }) => {
  for (const name of ['media.csv', 'observations.csv', 'UploadMeta.json']) {
    s3.put(BUCKET, `${SNAPSHOT_PREFIX}${name}`, s3.text(BUCKET, `${PREFIX_A}${name}`), 'text/csv');
  }
  await openSnapshots(page);
  await snapshotItems(page).first().getByRole('button', { name: 'Restore…' }).click();
});

Then('the restore reports that there is nothing to restore', async ({ page, s3 }) => {
  await expect(
    page.getByText('This snapshot already matches the current canonical files — nothing to restore.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Restore now|Run dry-run/ })).toBeDisabled();
  expect(s3.puts).toHaveLength(0);
});

Given('local edits exist for the upload', async ({ page }) => {
  await focusFrame(page, 'IMG005.JPG');
  await speciesApply(page, 'Pecari tajacu').click();
  await waitForDirtyDrafts(page, 1);
});

Then('those local edits are left in place', async ({ page }) => {
  const drafts = (await readStore(page, 'drafts')) as {
    mediaPath: string;
    dirty: boolean;
    observations: { scientificName: string }[];
  }[];
  const row = drafts.find((d) => d.mediaPath.endsWith('IMG005.JPG'))!;
  expect(row.dirty).toBe(true);
  expect(row.observations.map((o) => o.scientificName)).toEqual(['Pecari tajacu']);
});

Then('the workspace reloads the restored files beneath them', async ({ page }) => {
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  // The snapshot holds only the Mule Deer row, so the other prior tags are gone
  // while the local edit on IMG005 survives.
  await expect(gridCell(page, 'IMG004.JPG')).not.toContainText('Mountain Lion');
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
  await expect(gridCell(page, 'IMG005.JPG')).toContainText('Javelina');
});

// --- Cross-upload recovery browser ------------------------------------------

Then(
  'every upload in the chosen collection that has a recoverable snapshot is listed',
  async ({ page }) => {
    const section = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Synced snapshots' }) });
    await expect(section.locator('> ul > li')).toHaveCount(1);
    await expect(section).toContainText('2024.01.15.10.00.00_priortagger');
    await expect(section).not.toContainText('fielduser');
  },
);

Then("each upload's snapshots are shown with their time, identity and file count", async ({
  page,
}) => {
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Synced snapshots' }) });
  await expect(section).toContainText('2024-02-01 12:00:00');
  await expect(section).toContainText(SNAPSHOT_USER);
  await expect(section).toContainText('3 files');
});

Then(
  "choosing one opens that upload's tagging workspace with its snapshots list ready",
  async ({ page }) => {
    await page.getByRole('button', { name: 'Restore… →' }).click();
    await expect(page.getByRole('button', { name: 'Sync…' })).toBeVisible();
    await expect(snapshotDialog(page)).toBeVisible();
    await expect(snapshotItems(page).first()).toContainText(SNAPSHOT_STAMP.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2'));
  },
);

Given("one upload's snapshots cannot be listed", async ({ page, s3 }) => {
  // Give upload B a snapshot prefix whose manifest is unreadable, so its
  // listing fails while upload A's still resolves.
  s3.put(BUCKET, `${PREFIX_B}.sparcd-tagger-snapshots/someone/2024-04-04T04-04-04/media.csv`, 'x', 'text/csv');
  await sectionTab(page, 'History').click();
  await expect(page.getByRole('heading', { name: 'Synced snapshots' })).toBeVisible();
});

Then("the other uploads' snapshots are still listed", async ({ page }) => {
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Synced snapshots' }) });
  await expect(section).toContainText('2024.01.15.10.00.00_priortagger');
  await expect(section).toContainText('2024-02-01 12:00:00');
  await expect(section).not.toContainText('2024-04-04');
});

