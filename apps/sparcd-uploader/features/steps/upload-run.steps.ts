import { Given, When, Then, expect } from './fixtures';
import type { App } from './app';
import { manyJpegs, publishableBatch, slowVideo, standardBatch } from './batches';
import { rescanFromUpload, writtenCsvRows } from './helpers';
import { BUCKET_A, COLLECTION_A_NAME, UUID_A } from './fixtures-data';

const UPLOADS_PREFIX = `Collections/${UUID_A}/Uploads/`;
const METADATA_NAMES = [
  'deployments.csv',
  'media.csv',
  'observations.csv',
  'UploadMeta.json',
  'UploadComplete.json',
];

const mediaPuts = (app: App) =>
  app.s3.puts.filter((p) => !METADATA_NAMES.some((n) => p.key.endsWith(n)));

Given(
  'a batch has a collection, a deployment, an uploader identity and capture times',
  async ({ app }) => {
    await app.connect();
    // The batch carries one deliberately slow file: as-built the publish phase
    // is only reachable while examination is still running (CORRECTIONS.md).
    await app.dropFolder(publishableBatch());
    await expect(app.fileListPane()).toBeVisible();
  },
);

Given('the New upload section is showing the Upload step', async ({ app }) => {
  await app.walkToUploadStep({ uploader: 'Ada Lovelace', description: 'July retrieval' });
});

// --- dry run ---------------------------------------------------------------

Given('the upload has not been started', async ({ app }) => {
  await expect(app.page.getByRole('button', { name: /^Start (dry run|upload)$/ })).toBeVisible();
  expect(app.s3.puts).toHaveLength(0);
});

Then('dry run is switched on by default', async ({ app }) => {
  await expect(app.dryRunCheckbox()).toBeChecked();
  await expect(app.page.getByRole('button', { name: 'Start dry run' })).toBeVisible();
});

Then(
  'starting it lists every object that would be written, with its size and fingerprint',
  async ({ app }) => {
    await app.startRunWhileInspecting();
    await app.waitForRunPhase('done');
    const log = await app.logText();
    for (const name of ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'BIG_CLIP.MP4']) {
      expect(log).toMatch(new RegExp(`PUT ${BUCKET_A}/${UPLOADS_PREFIX}[^\\s]*${name} \\(\\d+ B, sha256 [0-9a-f]{12}…\\)`));
    }
    for (const name of METADATA_NAMES) expect(log).toContain(`/${name} (`);
  },
);

Then('nothing is written to storage', async ({ app }) => {
  expect(app.s3.puts).toHaveLength(0);
  expect(app.s3.multipart.size).toBe(0);
});

Then('the run is not recorded in History', async ({ app }) => {
  expect(await app.readBatchRecords()).toHaveLength(0);
  await app.gotoSection('History');
  await expect(app.page.getByText('No uploads yet')).toBeVisible();
});

When('dry run is switched off', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
});

Then(
  "the tool states that the credentials must permit append-only writes, reads and listing for the target collection's bucket",
  async ({ app }) => {
    await expect(app.page.getByText(/Wet upload uses the connected credentials directly/)).toContainText(
      `append-only PUT/HEAD/LIST for ${BUCKET_A}`,
    );
  },
);

Then('that the bucket must allow this web origin', async ({ app }) => {
  await expect(app.page.getByText(/Wet upload uses the connected credentials directly/)).toContainText(
    'must allow this web origin with CORS',
  );
});

// --- a complete real upload ------------------------------------------------

When('a real upload is started and completes', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('done');
});

Then(
  'every media file of the batch is stored under a single upload folder in the chosen collection',
  async ({ app }) => {
    const keys = mediaPuts(app).map((p) => p.key);
    expect(keys).toHaveLength(4);
    const folders = new Set(keys.map((k) => k.slice(0, k.indexOf('/', UPLOADS_PREFIX.length) + 1)));
    expect(folders.size).toBe(1);
    expect([...folders][0]).toMatch(new RegExp(`^${UPLOADS_PREFIX}`));
    for (const p of app.s3.puts) expect(p.bucket).toBe(BUCKET_A);
  },
);

Then("the folder is named for the moment of upload and the uploader's identity", async ({ app }) => {
  const key = mediaPuts(app)[0].key;
  const folder = key.slice(UPLOADS_PREFIX.length).split('/')[0];
  expect(folder).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}_ada-lovelace$/);
});

Then("each stored object's path is the one recorded for it in the media table", async ({ app }) => {
  const rows = writtenCsvRows(app, 'media.csv');
  const recorded = rows.map((r) => r[5]).sort();
  const stored = mediaPuts(app).map((p) => p.key).sort();
  expect(recorded).toEqual(stored);
  for (const row of rows) expect(row[0]).toBe(row[5]); // media_id == file_path
});

// --- verification ----------------------------------------------------------

When('a file has been uploaded', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('done');
});

Then("the tool re-reads the stored object's size and recorded fingerprint", async ({ app }) => {
  for (const put of mediaPuts(app)) {
    expect(app.s3.heads).toContain(`${put.bucket}/${put.key}`);
    expect(put.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
});

Then('a mismatch is treated as a failure of that file, not as a success', async ({ app }) => {
  // Re-run against storage that quietly rewrites one object's recorded digest
  // after accepting the write.
  app.s3.afterPut = (_bucket, key, obj) => {
    if (key.endsWith('IMG_0002.JPG')) obj.meta.sha256 = 'f'.repeat(64);
  };
  const metadataBefore = app.s3.puts.filter((p) => METADATA_NAMES.some((n) => p.key.endsWith(n))).length;
  await rescanFromUpload(app, standardBatch());
  await app.dryRunCheckbox().uncheck();
  await app.startRun();
  await expect(app.page.getByText(/sha256 metadata mismatch/).first()).toBeVisible({ timeout: 60_000 });
  const rows = await app.page.locator('div[data-index]').allTextContents();
  const mismatched = rows.find((r) => r.includes('IMG_0002.JPG'))!;
  expect(mismatched).not.toContain('done');
  expect(
    app.s3.puts.filter((p) => METADATA_NAMES.some((n) => p.key.endsWith(n))).length,
  ).toBe(metadataBefore);
});

// --- streaming past Inspect ------------------------------------------------

Given('some files are still being examined', async ({ app }) => {
  await expect(app.page.getByText(/still being inspected/)).toBeVisible();
});

When('the upload is started', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  app.notes.putsAtStart = app.s3.puts.length;
  await app.startRunWhileInspecting();
});

Then('files that have already been examined start uploading immediately', async ({ app }) => {
  await expect.poll(() => mediaPuts(app).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  expect(app.s3.puts.every((p) => !p.key.endsWith('BIG_CLIP.MP4'))).toBe(true);
});

Then("each remaining file starts as soon as its own examination finishes", async ({ app }) => {
  await expect.poll(() => mediaPuts(app).length, { timeout: 60_000 }).toBe(4);
  expect(mediaPuts(app).some((p) => p.key.endsWith('BIG_CLIP.MP4'))).toBe(true);
});

Then('the tool reports how many files are still being examined', async ({ app }) => {
  await app.waitForRunPhase('done');
  // The note is gone once every file has been examined.
  await expect(app.page.getByText(/still being inspected/)).toHaveCount(0);
});

// --- publish ordering ------------------------------------------------------

Given('a real upload is running', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
});

Then(
  'the metadata files are written only after every file in the batch has been stored and verified',
  async ({ app }) => {
    await app.waitForRunPhase('done');
    const keys = app.s3.puts.map((p) => p.key);
    const firstMetadata = keys.findIndex((k) => METADATA_NAMES.some((n) => k.endsWith(n)));
    expect(firstMetadata).toBe(4); // the four media objects come first
    for (const put of mediaPuts(app)) expect(app.s3.heads).toContain(`${put.bucket}/${put.key}`);
  },
);

Then(
  'they are written in a fixed order, with the upload metadata file last but one and the completion record last',
  async ({ app }) => {
    const tail = app.s3.puts.slice(4).map((p) => p.key.split('/').pop());
    expect(tail).toEqual(METADATA_NAMES);
  },
);

// --- partial runs ----------------------------------------------------------

Given('a real upload in which some files failed after their retries', async ({ app }) => {
  app.s3.putHooks.push((_b, key) =>
    key.endsWith('IMG_0002.JPG') ? { status: 400, code: 'InvalidRequest', message: 'refused' } : undefined,
  );
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('partial', 120_000);
});

Then('no metadata files are written', async ({ app }) => {
  expect(app.s3.puts.some((p) => METADATA_NAMES.some((n) => p.key.endsWith(n)))).toBe(false);
});

Then('the run is reported as partial, stating how many files failed', async ({ app }) => {
  await expect(app.runPhase()).toHaveText('partial');
  await expect(app.page.getByText(/1 of 4 files failed to upload/)).toBeVisible();
});

Then(
  'the tool states that the upload is not yet visible and can be completed by retrying the failed files',
  async ({ app }) => {
    await expect(
      app.page.getByText(/Metadata was not published, so this upload is not yet visible; retry the failed files to complete it\./),
    ).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Retry failed files' })).toBeVisible();
  },
);

// --- abandoned runs --------------------------------------------------------

Given('a real upload that was cancelled or ended in failure', async ({ app }) => {
  app.s3.putDelayMs = 150;
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await expect.poll(() => app.s3.puts.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await app.page.getByRole('button', { name: 'Cancel' }).click();
  await expect(app.page.getByText('cancelled').first()).toBeVisible();
});

Then('no upload metadata file was written for it', async ({ app }) => {
  expect(app.s3.puts.some((p) => p.key.endsWith('UploadMeta.json'))).toBe(false);
});

Then('nothing reading the collection sees a new upload there', async ({ app }) => {
  await app.gotoSection('History');
  await app.publishedCollectionSelect().selectOption({ label: COLLECTION_A_NAME });
  const cards = app.page.locator('ul li').filter({ hasText: 'Edit description' });
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('priorperson');
});

// --- untagged batches ------------------------------------------------------

When('a batch is published', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('done');
});

Then('an empty observations table is written alongside the media table', async ({ app }) => {
  const observations = app.s3.puts.find((p) => p.key.endsWith('observations.csv'))!;
  expect(observations).toBeTruthy();
  expect(observations.body).toBe('');
  expect(writtenCsvRows(app, 'media.csv')).toHaveLength(4);
});

Then('the upload metadata records that none of its images carry a species', async ({ app }) => {
  const meta = JSON.parse(app.s3.puts.find((p) => p.key.endsWith('UploadMeta.json'))!.body);
  expect(meta.imagesWithSpecies).toBe(0);
  expect(meta.imageCount).toBe(4);
});

// --- progress reporting ----------------------------------------------------

Given('a run is in progress', async ({ app }) => {
  app.s3.putDelayMs = 200;
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await expect(app.runPhase()).toHaveText('uploading');
});

Then('each file shows its own state and percentage', async ({ app }) => {
  const states = await app.page.locator('div[data-index] span.text-right').allTextContents();
  expect(states.length).toBeGreaterThan(0);
  expect(states.some((s) => /^\d+%$/.test(s) || ['pending', 'done', 'inspecting', 'verifying'].includes(s))).toBe(true);
});

Then(
  'the batch shows bytes uploaded against the total, and counts of done, skipped and failed files',
  async ({ app }) => {
    await expect(app.page.getByText(/[\d.]+ (B|KB|MB|GB) \/ [\d.]+ (B|KB|MB|GB)/)).toBeVisible();
    await expect(app.page.getByText(/\d+ done/)).toBeVisible();
  },
);

Then(
  'an activity log records each retry, each warning and each metadata write as it happens',
  async ({ app }) => {
    await app.waitForRunPhase('done', 120_000);
    const log = await app.logText();
    for (const name of METADATA_NAMES) expect(log).toContain(`/${name}`);
    expect(log).toContain('wrote ');
    // A successful blob write is deliberately not logged in a wet run.
    expect(log).not.toContain('IMG_0001.JPG');
  },
);

// --- concurrency -----------------------------------------------------------

Then('the number of parallel uploads can be set between 4 and 16', async ({ app }) => {
  const slider = app.page.locator('input[type="range"]');
  await expect(slider).toHaveAttribute('min', '4');
  await expect(slider).toHaveAttribute('max', '16');
  await slider.fill('12');
  await expect(app.page.getByText('12', { exact: true })).toBeVisible();
});

Then('it defaults to 8', async ({ app }) => {
  await app.reopen();
  await expect(app.connectForm()).toBeVisible();
  await app.fillConnection();
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
  await app.walkToUploadStep();
  await expect(app.page.locator('input[type="range"]')).toHaveValue('8');
});

Then('it cannot be changed while a run is in progress', async ({ app }) => {
  await app.startRun();
  await expect(app.runPhase()).toHaveText('uploading');
  await expect(app.page.locator('input[type="range"]')).toBeDisabled();
  await expect(app.dryRunCheckbox()).toBeDisabled();
});

// --- retries and hard failures ---------------------------------------------

Given(
  "a file's upload fails with a network error, a server error or a clock-skew rejection",
  async ({ app }) => {
    app.s3.putHooks.push((_b, key) =>
      key.endsWith('IMG_0002.JPG')
        ? { status: 503, code: 'ServiceUnavailable', message: 'try later' }
        : undefined,
    );
    await app.dryRunCheckbox().uncheck();
    await app.startRunWhileInspecting();
    await app.waitForRunPhase('partial', 120_000);
  },
);

Then('it is retried up to five attempts with an increasing, randomized delay', async ({ app }) => {
  const log = await app.logText();
  for (const attempt of [2, 3, 4, 5]) {
    expect(log).toMatch(new RegExp(`retry [^\\s]*IMG_0002\\.JPG \\(attempt ${attempt}\\) after \\d+ms`));
  }
  expect(log).not.toContain('(attempt 6)');
  const delays = [...log.matchAll(/after (\d+)ms/g)].map((m) => Number(m[1]));
  expect(delays).toHaveLength(4);
  expect(Math.max(...delays)).toBeGreaterThan(Math.min(...delays));
});

Then('the retry is recorded in the activity log', async ({ app }) => {
  expect(await app.logText()).toContain('retry');
  expect(await app.logText()).toMatch(/failed [^\s]*IMG_0002\.JPG/);
});

Given("a file's upload is refused for lack of permission", async ({ app }) => {
  await rescanFromUpload(app, [...manyJpegs(24), slowVideo()]);
  await app.page.locator('input[type="range"]').fill('4');
  app.s3.putDelayMs = 40;
  app.s3.putHooks.push((_b, key) =>
    key.endsWith('IMG_0000.JPG') ? { status: 403, code: 'AccessDenied', message: 'Access Denied' } : undefined,
  );
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('error', 120_000);
});

Then('the run stops immediately without working through the remaining files', async ({ app }) => {
  expect(mediaPuts(app).length).toBeLessThan(24);
  expect(app.s3.puts.some((p) => METADATA_NAMES.some((n) => p.key.endsWith(n)))).toBe(false);
});

Then('the failure is reported', async ({ app }) => {
  await expect(app.runPhase()).toHaveText('error');
  await expect(app.page.getByText(/Access Denied|AccessDenied|Forbidden|403/).first()).toBeVisible();
});

Given('ten files have failed independently in one run', async ({ app }) => {
  await rescanFromUpload(app, [...manyJpegs(14), slowVideo()]);
  app.s3.putHooks.push((_b, key) =>
    key.endsWith('.JPG') ? { status: 400, code: 'InvalidRequest', message: 'nope' } : undefined,
  );
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('error', 120_000);
});

Then(
  'the run stops and reports that the problem looks systemic rather than per-file',
  async ({ app }) => {
    await expect(
      app.page.getByText(/aborted after 10 file failures — the problem looks systemic, not per-file/).first(),
    ).toBeVisible();
  },
);

// --- never overwrite -------------------------------------------------------

Given('an object already exists at a path the run intends to write', async ({ app }) => {
  // Storage already holds something at the key the run is about to claim.
  app.s3.putHooks.push((bucket, key) => {
    if (key.endsWith('IMG_0002.JPG') && !app.s3.has(bucket, key)) {
      app.s3.put(bucket, key, 'someone else was here first');
    }
    return undefined;
  });
});

When('a fresh upload attempts that write', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('error', 120_000);
});

Then('the write is refused rather than replacing the existing object', async ({ app }) => {
  const clash = [...app.s3.objects.entries()].find(([k]) => k.endsWith('IMG_0002.JPG'))!;
  expect(clash[1].body.toString('utf8')).toBe('someone else was here first');
  expect(app.s3.puts.some((p) => p.key.endsWith('IMG_0002.JPG'))).toBe(false);
});

Then('the run reports the failure', async ({ app }) => {
  await expect(app.runPhase()).toHaveText('error');
  await expect(app.page.getByText(/Object already exists at/).first()).toBeVisible();
});

// --- cancelling ------------------------------------------------------------

When('a run is cancelled', async ({ app }) => {
  app.s3.putDelayMs = 200;
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await expect.poll(() => app.s3.puts.length, { timeout: 30_000 }).toBeGreaterThan(0);
  app.notes.storedAtCancel = app.s3.writtenKeys();
  await app.page.getByRole('button', { name: 'Cancel' }).click();
});

Then('in-flight transfers are abandoned', async ({ app }) => {
  await expect(app.page.getByText('cancelled').first()).toBeVisible();
  const after = app.s3.puts.length;
  await app.page.waitForTimeout(1500);
  expect(app.s3.puts.length).toBe(after);
  expect(app.s3.puts.some((p) => p.key.endsWith('UploadMeta.json'))).toBe(false);
});

Then('the run is reported as cancelled', async ({ app }) => {
  await expect(app.page.getByText('cancelled').first()).toBeVisible();
  await expect(app.runPhase()).toHaveText('error');
});

Then('files already stored remain stored', async ({ app }) => {
  for (const key of app.notes.storedAtCancel as string[]) {
    const [bucket, ...rest] = key.split('/');
    expect(app.s3.has(bucket, rest.join('/'))).toBe(true);
  }
});

// --- guards and the next batch ---------------------------------------------

Then('the Back button is disabled', async ({ app }) => {
  await expect(app.page.getByRole('button', { name: 'Back' })).toBeDisabled();
});

Given('a real upload has completed', async ({ app }) => {
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('done');
});

When('"Next batch" is chosen', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Next batch' }).click();
});

Then('the wizard returns to the Drop step with an empty batch', async ({ app }) => {
  await app.expectStep('Files');
  await expect(app.page.getByText('Drop a folder of media')).toBeVisible();
  await expect(app.fileListPane()).toHaveCount(0);
});

Then(
  'the collection, deployment, uploader identity, description and timezone of the previous batch are kept',
  async ({ app }) => {
    await app.dropFolder(standardBatch());
    await app.waitForInspected();
    await app.continueToAssign();
    await app.waitForCollections();
    await expect(app.collectionTrigger()).toContainText(COLLECTION_A_NAME);
    await expect(app.deploymentTrigger()).toContainText('Bear Canyon');
    await expect(app.page.getByPlaceholder('e.g. John Doe')).toHaveValue('Ada Lovelace');
    await expect(
      app.page.getByPlaceholder('What this batch is — site, date range, notes.'),
    ).toHaveValue('July retrieval');
    await expect(app.timeZoneSelect()).toHaveValue('America/Phoenix');
  },
);
