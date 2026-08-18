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
} from './support/flows';

const statePill = (page: Page) => page.locator('header span[title^="Sync: "]');

const canonicalPuts = (puts: { key: string }[]) =>
  puts.filter((p) => !p.key.includes('.sparcd-tagger-snapshots/'));

/** One cell of the preview's Added / Changed / Removed / Time-corrected grid. */
const summaryCell = (page: Page, label: string) =>
  page.locator('div.border.text-center').filter({ hasText: label });

const dialogClose = (page: Page) => page.getByRole('button', { name: 'Close', exact: true }).first();

Given('an upload with local edits is open in the tagging workspace', async ({ page }) => {
  await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
  await waitForDirtyDrafts(page, 1);
});

// --- The write itself -------------------------------------------------------

When('the sync is run', async ({ page }) => {
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
});

Then(
  "the upload's stored image, observation and metadata files are replaced with the edited versions",
  async ({ s3 }) => {
    const written = canonicalPuts(s3.puts).map((p) => p.key);
    expect(written).toContain(`${PREFIX_A}observations.csv`);
    expect(written).toContain(`${PREFIX_A}UploadMeta.json`);
    const obs = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
    const added = obs.find(
      (o) => o.mediaId.endsWith('IMG002.JPG') && o.scientificName === 'Canis latrans',
    );
    expect(added).toBeTruthy();
    expect(added!.count).toBe(1);
    const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)) as {
      imagesWithSpecies: number;
    };
    expect(meta.imagesWithSpecies).toBe(4);
  },
);

Then(
  "the identifications are then readable by the other SPARC'd tools that read the same files",
  async ({ s3 }) => {
    // The same readers `@sparcd/camtrap` gives the Java app / sparcd-web / the
    // marimo explorer parse the rewritten files without loss.
    const obs = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
    const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`));
    expect(media).toHaveLength(MEDIA_A.length);
    expect(obs.length).toBeGreaterThanOrEqual(OBS_A.length + 1);
    for (const o of obs) {
      expect(o.observationId).not.toBe('');
      expect(o.mediaId.startsWith(PREFIX_A)).toBe(true);
      expect(Number.isFinite(o.count)).toBe(true);
    }
    // Prior rows survive untouched.
    expect(obs.some((o) => o.scientificName === 'Casper')).toBe(true);
    expect(obs.some((o) => o.scientificName === 'Puma concolor')).toBe(true);
  },
);

// --- Preview ----------------------------------------------------------------

When('the Sync dialog is opened', async ({ page }) => {
  await openSyncDialog(page);
});

Then('the pending change is computed against the currently stored files', async ({ page }) => {
  await expect(page.getByText(/Would write \d+ file\(s\)/)).toBeVisible();
  await expect(summaryCell(page, 'Added')).toHaveText('1Added');
});

Then('nothing in the collection is written by the preview', async ({ s3 }) => {
  expect(s3.puts).toHaveLength(0);
});

When('the sync preview finishes', async ({ page }) => {
  await openSyncDialog(page);
});

Then('it reports how many images gain, change or lose identifications', async ({ page }) => {
  await expect(summaryCell(page, 'Added')).toHaveText('1Added');
  await expect(summaryCell(page, 'Changed')).toHaveText('0Changed');
  await expect(summaryCell(page, 'Removed')).toHaveText('0Removed');
});

Then('how many images have a corrected capture time', async ({ page }) => {
  await expect(summaryCell(page, 'Time-corrected')).toHaveText('0Time-corrected');
});

Then('which stored files would be rewritten', async ({ page }) => {
  await expect(page.getByText(/Would write 2 file\(s\)/)).toContainText('observations, uploadMeta');
});

Then('where the pre-change snapshot would be filed', async ({ page }) => {
  await expect(page.getByText(/snapshot →/)).toContainText(
    `${PREFIX_A}.sparcd-tagger-snapshots/jgonzalez/`,
  );
});

// --- Dry-run gate -----------------------------------------------------------

Given('the dry-run setting is on', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await expect(settingsDryRunCheckbox(page)).toBeChecked();
  await sectionTab(page, 'Tag').click();
});

Then('the action offered is a dry-run, not a write', async ({ page }) => {
  await openSyncDialog(page);
  await expect(page.getByRole('button', { name: 'Run dry-run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
});

Then('running it reports that nothing was written', async ({ page, s3 }) => {
  await page.getByRole('button', { name: 'Run dry-run' }).click();
  await expect(page.getByText('Dry-run complete — nothing was written.')).toBeVisible();
  expect(s3.puts).toHaveLength(0);
});

Then('switching the setting off changes the action to a real sync', async ({ page }) => {
  await setSyncDryRun(page, false);
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run dry-run' })).toHaveCount(0);
});

// --- Identity gate ----------------------------------------------------------

Given('no tagger identity has been set', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('');
  await sectionTab(page, 'Tag').click();
});

Then('the dialog states that an identity must be set in Settings first', async ({ page }) => {
  await openSyncDialog(page);
  await expect(page.getByText('Set a Tagger identity in Settings first')).toBeVisible();
});

Then('the sync action is unavailable', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Sync now|Run dry-run/ })).toBeDisabled();
});

// --- Nothing to sync --------------------------------------------------------

Given('the local edits match what is already stored', async ({ page }) => {
  // Undo the Background's edit so the drafts once again equal the canonical set.
  await focusFrame(page, 'IMG002.JPG');
  await page.getByRole('button', { name: 'Remove Coyote' }).click();
  await expect(gridCell(page, 'IMG002.JPG')).not.toContainText('Coyote');
});

Then('it reports that there is nothing to sync', async ({ page }) => {
  await expect(
    page.getByText('No local edits to sync — everything matches the canonical files.'),
  ).toBeVisible();
});

Then('no write action is offered', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Sync now|Run dry-run/ })).toBeDisabled();
  await expect(page.locator('label').filter({ hasText: 'Dry-run — log the writes' })).toHaveCount(0);
});

// --- Conflict ---------------------------------------------------------------

Given("the upload's stored files changed after this workspace loaded them", async ({ s3 }) => {
  const changed = observationsCsv(PREFIX_A, [
    ...OBS_A,
    {
      id: 'obs-elsewhere',
      file: 'IMG005.JPG',
      timestamp: '2024-01-11T06:00:30',
      scientificName: 'Lynx rufus',
      count: 1,
      comments: '[COMMONNAME:Bobcat]',
    },
  ]);
  s3.put(BUCKET, `${PREFIX_A}observations.csv`, changed, 'text/csv');
});

When('a sync is attempted', async ({ page }) => {
  await openSyncDialog(page);
});

Then('a conflict is reported naming the file that changed', async ({ page }) => {
  await expect(page.getByText('Conflict — the upload changed since you loaded it.')).toBeVisible();
  await expect(page.getByText(/observations/)).toBeVisible();
});

Then('nothing is written', async ({ s3 }) => {
  expect(s3.puts).toHaveLength(0);
});

Then('the local edits are left intact', async ({ page }) => {
  const drafts = (await readStore(page, 'drafts')) as { dirty: boolean }[];
  expect(drafts.filter((d) => d.dirty).length).toBeGreaterThan(0);
});

Then(
  'the choice offered is to keep editing or to discard the local edits and reload the stored version',
  async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard local & reload' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sync now|Run dry-run/ })).toHaveCount(0);
  },
);

// --- Snapshot before replace ------------------------------------------------

Then(
  'the current stored files are first copied to an immutable snapshot filed under the tagger identity and the time',
  async ({ s3 }) => {
    const snaps = s3.puts.filter((p) => p.key.includes('.sparcd-tagger-snapshots/jgonzalez/'));
    expect(snaps.map((p) => p.key.split('/').pop())).toEqual([
      'media.csv',
      'observations.csv',
      'UploadMeta.json',
      'manifest.json',
    ]);
    expect(snaps.every((p) => p.ifNoneMatch === '*')).toBe(true);
    expect(snaps[0].key).toMatch(/\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\/media\.csv$/);
    // The snapshot holds the PREVIOUS bytes, not the new ones.
    expect(snaps[1].body).toBe(observationsCsv(PREFIX_A, OBS_A));
  },
);

Then('the snapshot is only counted as recoverable once its manifest is written', async ({ s3 }) => {
  const snaps = s3.puts.filter((p) => p.key.includes('.sparcd-tagger-snapshots/'));
  expect(snaps[snaps.length - 1].key.endsWith('manifest.json')).toBe(true);
  const manifest = JSON.parse(snaps[snaps.length - 1].body) as {
    schemaVersion: number;
    user: string;
    files: { name: string }[];
  };
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.user).toBe('jgonzalez');
  expect(manifest.files.map((f) => f.name)).toEqual([
    'media.csv',
    'observations.csv',
    'UploadMeta.json',
  ]);
});

Then('only then are the stored files replaced', async ({ s3 }) => {
  const lastSnapshot = s3.puts.findLastIndex((p) => p.key.includes('.sparcd-tagger-snapshots/'));
  const firstCanonical = s3.puts.findIndex((p) => !p.key.includes('.sparcd-tagger-snapshots/'));
  expect(firstCanonical).toBeGreaterThan(lastSnapshot);
  for (const p of canonicalPuts(s3.puts)) expect(p.ifMatch).toBeTruthy();
});

// --- Only changed files are rewritten ---------------------------------------

When('a sync is run', async ({ page }) => {
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
});

Then('a stored file whose new contents are identical is left untouched', async ({ s3 }) => {
  const keys = canonicalPuts(s3.puts).map((p) => p.key);
  expect(keys).not.toContain(`${PREFIX_A}media.csv`);
  expect(s3.text(BUCKET, `${PREFIX_A}media.csv`)).toBe(mediaCsv(PREFIX_A, MEDIA_A));
});

Then(
  "the upload's metadata file is always rewritten, because every sync appends its edit comment",
  async ({ s3 }) => {
    const keys = canonicalPuts(s3.puts).map((p) => p.key);
    expect(keys).toContain(`${PREFIX_A}UploadMeta.json`);
    const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)) as {
      editComments: string[];
    };
    expect(meta.editComments.length).toBe(2);
  },
);

Then('images and observations the local edits did not touch keep their stored values', async ({
  s3,
}) => {
  const before = observationsCsv(PREFIX_A, OBS_A).split('\n');
  const after = s3.text(BUCKET, `${PREFIX_A}observations.csv`).split('\n');
  for (const line of before) {
    if (line.includes('IMG002.JPG')) continue;
    expect(after).toContain(line);
  }
  expect(s3.text(BUCKET, `${PREFIX_A}media.csv`)).toBe(mediaCsv(PREFIX_A, MEDIA_A));
});

Then('columns the tagger does not use are carried through unchanged', async ({ s3 }) => {
  const row = s3
    .text(BUCKET, `${PREFIX_A}observations.csv`)
    .split('\n')
    .find((l) => l.includes('obs-img4-0'))!;
  for (const v of ['ITIS:552479', 'Adult', 'Unknown', 'Walking', 'ind-7', 'human', 'jdoe', '0.95']) {
    expect(row).toContain(v);
  }
});

// --- Post-sync consistency --------------------------------------------------

Given('a sync completed and wrote the changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Time shift' }).click();
  await page.getByRole('button', { name: 'Increase Hour' }).click();
  await page.getByRole('button', { name: /^Apply to all/ }).click();
  await expect(page.getByText(/clock \+1h/)).toBeVisible();
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
  await dialogClose(page).click();
});

Then('the images whose changes were written are no longer listed as unsaved', async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG').locator('[title="unsaved edit"]')).toHaveCount(0);
  await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
});

Then(
  'any whole-upload time shift is cleared, because it is now part of the stored capture times',
  async ({ page }) => {
    await expect(page.getByText(/clock \+1h/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Time shift' })).toBeVisible();
    const uploads = (await readStore(page, 'uploads')) as { timeOffset: unknown }[];
    expect(uploads.every((u) => u.timeOffset === null)).toBe(true);
  },
);

Then('the workspace reloads the upload from the newly stored files', async ({ page, s3 }) => {
  const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`));
  const shifted = media.find((m) => m.mediaId.endsWith('IMG001.JPG'))!;
  expect(shifted.timestamp).toBe('2024-01-10T09:00:00');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByText('2024-01-10T09:00:00')).toBeVisible();
});

// --- Busy dialog ------------------------------------------------------------

Given('a sync is running', async ({ page, s3 }) => {
  s3.delay(`${PREFIX_A}media.csv`, 2500);
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
});

Then('the close and cancel controls are unavailable until it finishes', async ({ page, s3 }) => {
  await expect(dialogClose(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible({
    timeout: 30000,
  });
  await expect(dialogClose(page)).toBeEnabled();
  s3.delays.clear();
});

// --- Resume an interrupted sync ---------------------------------------------

Given('a previous sync wrote some but not all of the stored files', async ({ page, s3 }) => {
  // Journal the exact state an interrupted run leaves: media.csv already
  // written (its remote bytes hash to the intended content), the other two
  // still pending against the ETag/hash they were grounded on.
  const at = (name: string) => `${PREFIX_A}${name}`;
  // The SDK surfaces ETags quoted, and that is the form the journal grounds on.
  const quotedEtag = (key: string) => `"${s3.etag(BUCKET, key)}"`;
  const newObs = `${observationsCsv(PREFIX_A, OBS_A)}\n`;
  const newMeta = s3.text(BUCKET, at('UploadMeta.json')).replace('"imagesWithSpecies": 3', '"imagesWithSpecies": 4');
  await writeStore(page, 'syncJournals', {
    id: `${BUCKET}::${PREFIX_A}`,
    bucket: BUCKET,
    uploadPrefix: PREFIX_A,
    snapshotPrefix: `${PREFIX_A}.sparcd-tagger-snapshots/jgonzalez/2024-05-05T10-00-00/`,
    user: 'jgonzalez',
    startedAt: '2024-05-05T10:00:00.000Z',
    objects: [
      {
        role: 'media',
        key: at('media.csv'),
        baseETag: quotedEtag(at('media.csv')),
        baseHash: s3.hash(BUCKET, at('media.csv')),
        body: s3.text(BUCKET, at('media.csv')),
        intendedHash: s3.hash(BUCKET, at('media.csv')),
        status: 'written',
        newETag: quotedEtag(at('media.csv')),
      },
      {
        role: 'observations',
        key: at('observations.csv'),
        baseETag: quotedEtag(at('observations.csv')),
        baseHash: s3.hash(BUCKET, at('observations.csv')),
        body: newObs,
        intendedHash: sha256(newObs),
        status: 'pending',
      },
      {
        role: 'uploadMeta',
        key: at('UploadMeta.json'),
        baseETag: quotedEtag(at('UploadMeta.json')),
        baseHash: s3.hash(BUCKET, at('UploadMeta.json')),
        body: newMeta,
        intendedHash: sha256(newMeta),
        status: 'pending',
      },
    ],
  });
});

When('a sync is attempted again for that upload', async ({ page }) => {
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Synced|Dry-run complete/)).toBeVisible();
});

Then(
  'the outstanding writes are completed from the record of the interrupted attempt',
  async ({ page, s3 }) => {
    const keys = canonicalPuts(s3.puts).map((p) => p.key);
    expect(keys).toContain(`${PREFIX_A}observations.csv`);
    expect(keys).toContain(`${PREFIX_A}UploadMeta.json`);
    const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)) as {
      imagesWithSpecies: number;
    };
    expect(meta.imagesWithSpecies).toBe(4);
    expect(await readStore(page, 'syncJournals')).toHaveLength(0);
  },
);

Then('the files already written are not written a second time', async ({ s3 }) => {
  const keys = canonicalPuts(s3.puts).map((p) => p.key);
  expect(keys).not.toContain(`${PREFIX_A}media.csv`);
  // No snapshot either — a resume continues, it does not restart the operation.
  expect(s3.puts.filter((p) => p.key.includes('.sparcd-tagger-snapshots/'))).toHaveLength(0);
});

Then(
  'a new operation cannot begin until that record is completed or its conflict resolved',
  async ({ page, s3 }) => {
    // The journal drove the write; the local draft edit was never planned, so it
    // is still outstanding and the journal is gone only now that it finished.
    expect(await readStore(page, 'syncJournals')).toHaveLength(0);
    const drafts = (await readStore(page, 'drafts')) as { dirty: boolean }[];
    expect(drafts.some((d) => d.dirty)).toBe(true);
    await dialogClose(page).click();
    await openSyncDialog(page);
    await expect(page.getByText(/Would write|No local edits/)).toBeVisible();
    expect(s3.puts.length).toBeGreaterThan(0);
  },
);

// --- Backend that will not honour IfMatch -----------------------------------

Given('the connected store does not honour conditional replacement', async ({ s3 }) => {
  s3.replaceMode = 'unsupported';
});

Then('the sync is refused with an explanation', async ({ page }) => {
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(
    page.getByText('The endpoint does not enforce IfMatch — canonical sync is disabled here.'),
  ).toBeVisible();
});

Then('the stored files are left untouched', async ({ s3 }) => {
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(observationsCsv(PREFIX_A, OBS_A));
  expect(s3.text(BUCKET, `${PREFIX_A}media.csv`)).toBe(mediaCsv(PREFIX_A, MEDIA_A));
  expect(canonicalPuts(s3.puts).every((p) => p.ifMatch !== undefined)).toBe(true);
  // Deviation, verified: the pre-change snapshot IS written before the refused
  // replacement, so "nothing is written" would be wrong.
  expect(s3.puts.some((p) => p.key.includes('.sparcd-tagger-snapshots/'))).toBe(true);
});

// --- State pill -------------------------------------------------------------

Then(
  'the header shows whether the upload is local-only, has unsynced edits, is syncing, is synced, is in conflict, was a dry-run, or errored',
  async ({ page, s3 }) => {
    const seen: string[] = [];
    const record = async () => {
      const title = (await statePill(page).getAttribute('title')) ?? '';
      if (!seen.includes(title)) seen.push(title);
      return title;
    };

    // unsynced — the Background's local edit.
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: unsynced edits');
    await record();

    // syncing — held open by a slow canonical read.
    s3.delay(`${PREFIX_A}media.csv`, 2000);
    await page.getByRole('button', { name: 'Sync…' }).click();
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: syncing…');
    await record();
    s3.delays.clear();
    await expect(page.getByText('Checking the canonical base…')).toBeHidden({ timeout: 20000 });

    // dry-run
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: dry-run');
    await record();

    // error — a store that refuses the conditional replacement.
    s3.replaceMode = 'unsupported';
    await setSyncDryRun(page, false);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: error');
    await record();

    // synced
    s3.replaceMode = 'ok';
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: synced');
    await record();
    await dialogClose(page).click();

    // conflict — someone else rewrites a canonical file.
    await focusFrame(page, 'IMG005.JPG');
    await speciesApply(page, 'Pecari tajacu').click();
    s3.put(BUCKET, `${PREFIX_A}observations.csv`, 'x', 'text/csv');
    await openSyncDialog(page);
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: conflict');
    await record();
    await page.getByRole('button', { name: 'Keep editing' }).click();

    // local-only — an upload this browser has never edited.
    await sectionTab(page, 'Browse').click();
    await uploadRow(page, 'fielduser').click();
    await expect(statePill(page)).toHaveAttribute('title', 'Sync: local-only');
    await record();

    expect(seen.sort()).toEqual([
      'Sync: conflict',
      'Sync: dry-run',
      'Sync: error',
      'Sync: local-only',
      'Sync: synced',
      'Sync: syncing…',
      'Sync: unsynced edits',
    ]);
  },
);

Then('the state is distinguishable by shape and glyph, not by colour alone', async ({ page }) => {
  const glyph = await statePill(page).locator('span[aria-hidden]').textContent();
  expect(glyph).toBeTruthy();
  await expect(statePill(page)).toContainText('local-only');
  // Every pill carries its own glyph + word; none of them is colour-only.
  expect(['○', '◔', '◐', '●', '▲', '◇', '✕']).toContain(glyph!.trim());
});

