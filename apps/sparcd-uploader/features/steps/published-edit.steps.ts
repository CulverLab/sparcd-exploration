import { Given, When, Then, expect } from './fixtures';
import type { App } from './app';
import { standardBatch } from './batches';
import {
  BUCKET_A,
  COLLECTION_A_NAME,
  PRIOR_UPLOAD_PREFIX,
  USED_LOCATION_ID,
  USED_LOCATION_NAME,
  UUID_A,
  deploymentsCsv,
  mediaCsv,
  uploadMetaJson,
} from './fixtures-data';

const NEWER_STAMP = '2026.03.04.10.00.00_otherperson';
const NEWER_PREFIX = `Collections/${UUID_A}/Uploads/${NEWER_STAMP}/`;

function seedSecondUpload(app: App): void {
  app.s3.put(BUCKET_A, `${NEWER_PREFIX}deployments.csv`, deploymentsCsv(UUID_A, USED_LOCATION_ID, USED_LOCATION_NAME), { contentType: 'text/csv' });
  app.s3.put(BUCKET_A, `${NEWER_PREFIX}media.csv`, mediaCsv(UUID_A, USED_LOCATION_ID, NEWER_PREFIX, ['IMG_9001.JPG']), { contentType: 'text/csv' });
  app.s3.put(BUCKET_A, `${NEWER_PREFIX}observations.csv`, '', { contentType: 'text/csv' });
  app.s3.put(
    BUCKET_A,
    `${NEWER_PREFIX}UploadMeta.json`,
    uploadMetaJson({
      user: 'otherperson',
      description: 'North gate camera',
      imageCount: 4,
      imagesWithSpecies: 3,
      bucket: BUCKET_A,
      uploadPath: NEWER_PREFIX.replace(/\/$/, ''),
      editComments: ['Edited by someone on 2026-02-01 08:00:00'],
    }),
    { contentType: 'application/json' },
  );
}

async function selectCollectionInHistory(app: App): Promise<void> {
  await app.gotoSection('History');
  await app.publishedCollectionSelect().selectOption({ label: COLLECTION_A_NAME });
  await expect(app.page.getByText('Published uploads')).toBeVisible();
  await expect(uploadCards(app).first()).toBeVisible({ timeout: 30_000 });
}

// Keyed on the header line, which every card shows in every mode — the action
// buttons are replaced while a card is being edited.
const uploadCards = (app: App) =>
  app.page.locator('ul li').filter({ hasText: /on 2026-01-02 at 09:00/ });
const cardFor = (app: App, uploader: string) => uploadCards(app).filter({ hasText: uploader });

/** Turn the global dry-run flag off; it only has a control on the Upload step. */
async function switchDryRunOff(app: App): Promise<void> {
  await app.gotoSection('New upload');
  await app.dryRunCheckbox().uncheck();
  await selectCollectionInHistory(app);
}

Given('a collection with published uploads has been selected in History', async ({ app }) => {
  seedSecondUpload(app);
  // The dry-run flag lives on the Upload step, so a batch has to exist before a
  // correction can be made for real. Park one there first.
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
  await app.walkToUploadStep({ uploader: 'Ada Lovelace' });
  await selectCollectionInHistory(app);
});

// --- listing and searching -------------------------------------------------

Then(
  'each published upload is listed with its uploader, its upload date, its description, how many of its images carry a species, and its deployment',
  async ({ app }) => {
    const card = cardFor(app, 'otherperson');
    await expect(card).toContainText('otherperson on 2026-01-02 at 09:00');
    await expect(card).toContainText('3/4 images tagged with species.');
    await expect(card).toContainText('North gate camera');
    await expect(card).toContainText(NEWER_STAMP);
    await expect(card).toContainText(`${UUID_A}:${USED_LOCATION_ID}`);
  },
);

Then('the list can be filtered by uploader, description, upload folder or deployment', async ({ app }) => {
  const search = app.page.getByPlaceholder(/Search uploads by uploader/);
  await search.fill('otherperson');
  await expect(uploadCards(app)).toHaveCount(1);
  await search.fill('Original description');
  await expect(uploadCards(app)).toHaveCount(1);
  await expect(uploadCards(app).first()).toContainText('priorperson');
  await search.fill('2026.03.04');
  await expect(uploadCards(app)).toHaveCount(1);
  await search.fill(`${UUID_A}:${USED_LOCATION_ID}`);
  await expect(uploadCards(app)).toHaveCount(2);
  await search.fill('');
});

Then('the newest upload is listed first', async ({ app }) => {
  await expect(uploadCards(app)).toHaveCount(2);
  await expect(uploadCards(app).nth(0)).toContainText(NEWER_STAMP);
  await expect(uploadCards(app).nth(1)).toContainText('2026.01.02.09.00.00_priorperson');
});

// --- correcting a description ----------------------------------------------

When('a new description is saved for an upload', async ({ app }) => {
  await switchDryRunOff(app);
  app.notes.metaBefore = JSON.parse(app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}UploadMeta.json`)!);
  const card = cardFor(app, 'priorperson');
  await card.getByRole('button', { name: 'Edit description' }).click();
  await card.locator('textarea').fill('Corrected: south ridge, January retrieval');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.page.getByText('Applied. The published upload is updated.')).toBeVisible();
});

Then("the upload's metadata file carries the new description", async ({ app }) => {
  const meta = JSON.parse(app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}UploadMeta.json`)!);
  expect(meta.description).toBe('Corrected: south ridge, January retrieval');
});

Then('every other value in that file is left exactly as it was', async ({ app }) => {
  const before = app.notes.metaBefore as Record<string, unknown>;
  const after = JSON.parse(app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}UploadMeta.json`)!);
  expect(Object.keys(after)).toEqual(Object.keys(before));
  for (const key of Object.keys(before)) {
    if (key === 'description' || key === 'editComments') continue;
    expect(after[key]).toEqual(before[key]);
  }
});

// --- re-pointing a deployment ----------------------------------------------

When('a different location is chosen for a published upload', async ({ app }) => {
  await switchDryRunOff(app);
  app.notes.mediaBefore = app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}media.csv`)!;
  const card = cardFor(app, 'priorperson');
  await card.getByRole('button', { name: 'Correct location' }).click();
  await card.locator('button[aria-haspopup="listbox"]').click();
  await card.locator('ul[role="listbox"] li[role="option"]').filter({ hasText: 'Bear Canyon' }).first().click();
  await card.getByRole('button', { name: 'Re-stamp', exact: true }).click();
  await expect(app.page.getByText('Applied. The published upload is updated.')).toBeVisible();
});

Then(
  "the deployment row is rewritten with that location's identifier, name, coordinates and elevation",
  async ({ app }) => {
    const csv = app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}deployments.csv`)!;
    expect(csv).toContain(`"${UUID_A}:BEAR1"`);
    expect(csv).toContain('"BEAR1"');
    expect(csv).toContain('"Bear Canyon"');
    expect(csv).toContain('"-110.700000"');
    expect(csv).toContain('"32.400000"');
    expect(csv).toContain('"1200.000000"');
    expect(csv.split('\n').filter((l) => l.trim())).toHaveLength(1);
  },
);

Then(
  'the deployment reference on every media and observation row is updated to match',
  async ({ app }) => {
    const media = app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}media.csv`)!;
    for (const row of media.split('\n').filter((l) => l.trim())) {
      expect(row.split(',')[1]).toBe(`"${UUID_A}:BEAR1"`);
    }
    expect(app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}observations.csv`)).toBe('');
  },
);

Then('no other column or row in those files is changed', async ({ app }) => {
  const before = (app.notes.mediaBefore as string).split('\n').filter((l) => l.trim());
  const after = app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}media.csv`)!.split('\n').filter((l) => l.trim());
  expect(after).toHaveLength(before.length);
  for (let i = 0; i < before.length; i++) {
    const b = before[i].split(',');
    const a = after[i].split(',');
    expect(a).toHaveLength(b.length);
    for (let c = 0; c < b.length; c++) {
      if (c === 1) continue; // the deployment_id column is the one being corrected
      expect(a[c]).toBe(b[c]);
    }
  }
});

// --- snapshots -------------------------------------------------------------

When('a correction is applied', async ({ app }) => {
  if (app.notes.dryRun !== true) await switchDryRunOff(app);
  const card = cardFor(app, 'priorperson');
  await card.getByRole('button', { name: 'Edit description' }).click();
  await card.locator('textarea').fill('A corrected description');
  await card.getByRole('button', { name: /^Save( \(dry run\))?$/ }).click();
  await expect(
    app.page.getByText(/Applied|Dry run — would replace|does not enforce IfMatch/),
  ).toBeVisible();
});

Then(
  'the current contents of each file about to change are written to an immutable snapshot first, together with a manifest naming them',
  async ({ app }) => {
    const snapshots = app.s3.puts.filter((p) => p.key.includes('.sparcd-uploader-snapshots/'));
    expect(snapshots.map((p) => p.key.split('/').pop())).toEqual(['UploadMeta.json', 'manifest.json']);
    expect(snapshots[0].body).toContain('"description": "Original description"');
    expect(snapshots[0].ifNoneMatch).toBe('*');
    const manifest = JSON.parse(snapshots[1].body);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files.map((f: { name: string }) => f.name)).toEqual(['UploadMeta.json']);
    expect(manifest.user).toBe('Ada Lovelace');
  },
);

Then('only then is the change applied', async ({ app }) => {
  const keys = app.s3.puts.map((p) => p.key);
  const lastSnapshot = keys.map((k) => k.includes('.sparcd-uploader-snapshots/')).lastIndexOf(true);
  const canonical = keys.indexOf(`${PRIOR_UPLOAD_PREFIX}UploadMeta.json`);
  expect(canonical).toBeGreaterThan(lastSnapshot);
  expect(app.s3.puts[canonical].ifMatch).toBeTruthy();
});

// --- conflicts -------------------------------------------------------------

Given('a file to be corrected changed after it was loaded for review', async ({ app }) => {
  await switchDryRunOff(app);
  // Storage rewrites the object between the form's read and the guarded write.
  let armed = true;
  app.s3.onGet = (bucket, key) => {
    if (armed && key === `${PRIOR_UPLOAD_PREFIX}UploadMeta.json`) {
      armed = false;
      app.s3.put(
        bucket,
        key,
        uploadMetaJson({
          user: 'priorperson',
          description: 'Changed by somebody else',
          imageCount: 2,
          imagesWithSpecies: 0,
          bucket: BUCKET_A,
          uploadPath: PRIOR_UPLOAD_PREFIX.replace(/\/$/, ''),
        }),
        { contentType: 'application/json' },
      );
    }
  };
});

When('the correction is applied', async ({ app }) => {
  const card = cardFor(app, 'priorperson');
  await card.getByRole('button', { name: 'Edit description' }).click();
  await card.locator('textarea').fill('My correction');
  app.notes.putsBefore = app.s3.puts.length;
  await card.getByRole('button', { name: 'Save', exact: true }).click();
});

Then('it is refused as a conflict', async ({ app }) => {
  await expect(
    app.page.getByText(/Conflict on uploadMeta: the canonical file changed since this upload was loaded/),
  ).toBeVisible();
});

Then('nothing is written — not even a snapshot', async ({ app }) => {
  expect(app.s3.puts.length).toBe(app.notes.putsBefore as number);
  expect(app.s3.puts.some((p) => p.key.includes('.sparcd-uploader-snapshots/'))).toBe(false);
});

Then('the tool asks for a reload and a retry', async ({ app }) => {
  await expect(app.page.getByText(/Reload and retry — nothing was written\./)).toBeVisible();
});

// --- edit history ----------------------------------------------------------

When('a description correction is applied', async ({ app }) => {
  await switchDryRunOff(app);
  const card = cardFor(app, 'otherperson');
  await card.getByRole('button', { name: 'Edit description' }).click();
  await card.locator('textarea').fill('North gate camera, corrected');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.page.getByText('Applied. The published upload is updated.')).toBeVisible();
});

Then(
  "a note recording who edited it and when is appended to the upload's metadata file",
  async ({ app }) => {
    const meta = JSON.parse(app.s3.text(BUCKET_A, `${NEWER_PREFIX}UploadMeta.json`)!);
    expect(meta.editComments.at(-1)).toMatch(
      /^Edited by Ada Lovelace on \d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/,
    );
  },
);

Then('previously recorded edits are kept and can be listed on the upload', async ({ app }) => {
  const meta = JSON.parse(app.s3.text(BUCKET_A, `${NEWER_PREFIX}UploadMeta.json`)!);
  expect(meta.editComments[0]).toBe('Edited by someone on 2026-02-01 08:00:00');
  expect(meta.editComments).toHaveLength(2);
  const card = cardFor(app, 'otherperson');
  await card.getByRole('button', { name: /2 edits/ }).click();
  await expect(card).toContainText('Edited by someone on 2026-02-01 08:00:00');
});

// --- no-ops ----------------------------------------------------------------

When('a correction is applied whose values already match what is stored', async ({ app }) => {
  await switchDryRunOff(app);
  app.notes.putsBefore = app.s3.puts.length;
  // Re-point the upload at the location it is already assigned to. (A
  // description save can never be a no-op: it always appends an edit comment,
  // so its bytes always differ.)
  const card = cardFor(app, 'priorperson');
  await card.getByRole('button', { name: 'Correct location' }).click();
  await card.locator('button[aria-haspopup="listbox"]').click();
  await card
    .locator('ul[role="listbox"] li[role="option"]')
    .filter({ hasText: USED_LOCATION_NAME })
    .first()
    .click();
  await card.getByRole('button', { name: 'Re-stamp', exact: true }).click();
});

Then('the tool reports that there is nothing to change', async ({ app }) => {
  await expect(app.page.getByText('Nothing to change — the values already match.')).toBeVisible();
});

Then('no snapshot and no change is written', async ({ app }) => {
  expect(app.s3.puts.length).toBe(app.notes.putsBefore as number);
});

// --- dry run ---------------------------------------------------------------

Given('dry run is switched on', async ({ app }) => {
  app.notes.dryRun = true;
  await app.gotoSection('New upload');
  await app.dryRunCheckbox().check();
  await selectCollectionInHistory(app);
});

Then('the tool lists the files it would replace', async ({ app }) => {
  await expect(
    app.page.getByText('Dry run — would replace UploadMeta.json (nothing written).'),
  ).toBeVisible();
});

Then('nothing is written, not even a snapshot', async ({ app }) => {
  expect(app.s3.puts).toHaveLength(0);
});

// --- an endpoint that will not enforce the guard ---------------------------

Given('the storage endpoint does not enforce the conditional-replacement guard', async ({ app }) => {
  await switchDryRunOff(app);
  app.s3.rejectConditionalReplace = true;
  app.notes.dryRun = false;
});

Then('the tool reports that corrections are unsupported on that endpoint', async ({ app }) => {
  await expect(
    app.page.getByText('The endpoint does not enforce IfMatch — published edits are disabled here.'),
  ).toBeVisible();
});

Then('no unguarded overwrite is attempted', async ({ app }) => {
  const meta = JSON.parse(app.s3.text(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}UploadMeta.json`)!);
  expect(meta.description).toBe('Original description');
  expect(app.s3.puts.every((p) => p.key.includes('.sparcd-uploader-snapshots/'))).toBe(true);
});
