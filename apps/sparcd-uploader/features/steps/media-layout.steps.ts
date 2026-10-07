import { createHash } from 'node:crypto';
import { Given, When, Then, expect } from './fixtures';
import type { App, FileSpec } from './app';
import { jpegAt, jpegNoTime, standardBatch } from './batches';
import {
  BUCKET_A,
  COLLECTION_A_NAME,
  COLLECTION_C_NAME,
  DATA_BUCKET,
  UUID_A,
  UUID_C,
  seedDataBucket,
} from './fixtures-data';
import { FAILING_FILE, rescanFromUpload, writtenCsvRows } from './helpers';

const METADATA_NAMES = ['deployments.csv', 'media.csv', 'observations.csv', 'UploadMeta.json', 'UploadComplete.json'];
const isMetadata = (key: string) => METADATA_NAMES.some((n) => key.endsWith(`/${n}`));

// standardBatch() was taken at 12:00, 12:05 and 12:10 camera time.
const STANDARD_STAMPS = ['20260701120000', '20260701120500', '20260701121000'];

const hashOf = (spec: FileSpec): string => createHash('sha256').update(spec.bytes!).digest('hex');

/** Where the Media layout stores a file's bytes, for a given camera-time stamp. */
const mediaKeyOf = (spec: FileSpec, stamp: string): string =>
  `Media/${hashOf(spec)}/${stamp}-${spec.path.split('/').pop()}`;

const imagePuts = (app: App, from = 0) => app.s3.puts.slice(from).filter((p) => !isMetadata(p.key));

/** The rows of the media.csv written last. */
const lastMediaRows = (app: App): string[][] =>
  writtenCsvRows(app, app.s3.puts.filter((p) => p.key.endsWith('/media.csv')).at(-1)!.key);

async function uploadTo(
  app: App,
  collection: string,
  specs: FileSpec[],
  phase: 'done' | 'partial' = 'done',
): Promise<void> {
  await app.dropFolder(specs);
  await expect(app.fileListToggle()).toBeVisible({ timeout: 30_000 });
  await app.continueToAssign();
  await app.waitForCollections();
  await app.openCollectionList();
  await app.page.locator('ul[role="listbox"] li[role="option"]').filter({ hasText: collection }).click();
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await app.continueToUpload();
  await app.dryRunCheckbox().uncheck();
  await app.startRun();
  await app.waitForRunPhase(phase, 120_000);
}

async function uploadAgain(app: App, specs: FileSpec[]): Promise<void> {
  await rescanFromUpload(app, specs);
  await expect(app.page.locator('dl').filter({ hasText: 'Collection' })).toContainText(COLLECTION_C_NAME);
  await app.dryRunCheckbox().uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
}

Given('the store has a data bucket holding a collection', async ({ app }) => {
  seedDataBucket(app.s3);
  await app.connect();
});

// --- a new upload ----------------------------------------------------------

When('a batch is uploaded to the data-bucket collection', async ({ app }) => {
  await uploadTo(app, COLLECTION_C_NAME, standardBatch());
});

Then(
  'each image is stored once under its content hash in the data bucket, named for its camera time and filename',
  async ({ app }) => {
    const expected = standardBatch().map((s, i) => [DATA_BUCKET, mediaKeyOf(s, STANDARD_STAMPS[i])]);
    expect(imagePuts(app).map((p) => [p.bucket, p.key]).sort()).toEqual(expected.sort());
  },
);

Then('the metadata files are written to the upload folder in the data bucket', async ({ app }) => {
  const metadata = app.s3.puts.filter((p) => isMetadata(p.key));
  expect(metadata).toHaveLength(5);
  const folders = new Set(metadata.map((p) => `${p.bucket}/${p.key.slice(0, p.key.lastIndexOf('/'))}`));
  expect([...folders]).toHaveLength(1);
  expect([...folders][0]).toMatch(new RegExp(`^${DATA_BUCKET}/Collections/${UUID_C}/Uploads/[^/]+_ada-lovelace$`));
});

Then('media.csv names each image by its stored key', async ({ app }) => {
  const rows = lastMediaRows(app);
  expect(rows.map((r) => r[0]).sort()).toEqual(imagePuts(app).map((p) => p.key).sort());
  for (const r of rows) expect(r[5]).toBe(r[0]); // file_path is the same key
});

Then('media.csv is the last object written', async ({ app }) => {
  expect(app.s3.puts.at(-1)!.key).toMatch(/\/media\.csv$/);
});

Then('every object written carries a content type', async ({ app }) => {
  for (const p of app.s3.puts) {
    expect(p.contentType, p.key).toMatch(isMetadata(p.key) ? /^(text\/csv|application\/json)/ : /^image\/jpeg/);
  }
});

// --- the same bytes again --------------------------------------------------

Given('a batch was uploaded to the data-bucket collection', async ({ app }) => {
  await uploadTo(app, COLLECTION_C_NAME, standardBatch());
  app.notes.firstKeys = imagePuts(app).map((p) => p.key).sort();
  app.notes.putsBefore = app.s3.puts.length;
});

When('the same files are uploaded to it again', async ({ app }) => {
  await uploadAgain(app, standardBatch());
});

When('the same images are uploaded to it again under other names', async ({ app }) => {
  await uploadAgain(app, standardBatch().map((s) => ({ ...s, path: s.path.replace('IMG_', 'RENAMED_') })));
});

Then('no image is written the second time', async ({ app }) => {
  const second = app.s3.puts.slice(app.notes.putsBefore as number);
  expect(second.filter((p) => isMetadata(p.key))).toHaveLength(5);
  expect(imagePuts(app, app.notes.putsBefore as number)).toEqual([]);
});

Then("the second upload's media.csv names the images the first upload stored", async ({ app }) => {
  const rows = lastMediaRows(app);
  expect(rows.map((r) => r[0]).sort()).toEqual(app.notes.firstKeys);
  // Each row still names the file this upload was given.
  expect(rows.map((r) => r[6]).sort()).toEqual(app.lastSpecs.map((s) => s.path.split('/').pop()).sort());
});

// --- derived files ---------------------------------------------------------

Given('the data bucket already holds a preview of an image but not the image itself', async ({ app }) => {
  const [first] = standardBatch();
  app.notes.previewKey = `Media/${hashOf(first)}/preview-640.jpg`;
  app.s3.put(DATA_BUCKET, app.notes.previewKey as string, Buffer.from('preview'), { contentType: 'image/jpeg' });
});

Then('the image is stored beside its preview', async ({ app }) => {
  const [first] = standardBatch();
  expect(imagePuts(app).map((p) => p.key)).toContain(mediaKeyOf(first, STANDARD_STAMPS[0]));
  expect(app.s3.has(DATA_BUCKET, app.notes.previewKey as string)).toBe(true);
});

// --- the old layout --------------------------------------------------------

When('a batch is uploaded to a collection that has only its legacy bucket', async ({ app }) => {
  await uploadTo(app, COLLECTION_A_NAME, standardBatch());
});

Then('every image is stored inside the upload folder in that bucket', async ({ app }) => {
  const puts = imagePuts(app);
  expect(puts).toHaveLength(3);
  for (const p of puts) {
    expect(p.bucket).toBe(BUCKET_A);
    expect(p.key).toMatch(new RegExp(`^Collections/${UUID_A}/Uploads/[^/]+_ada-lovelace/`));
  }
});

Then('nothing is written to the data bucket or its Media folder', async ({ app }) => {
  expect(app.s3.puts.filter((p) => p.bucket === DATA_BUCKET || p.key.startsWith('Media/'))).toEqual([]);
});

// --- estimated times -------------------------------------------------------

const gappyBatch = () => [
  jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
  jpegNoTime('IMG_0002.JPG'),
  jpegAt('IMG_0003.JPG', '2026:07:01 12:10:00'),
];

When('a batch with an image that has no camera time is uploaded to the data-bucket collection', async ({ app }) => {
  await uploadTo(app, COLLECTION_C_NAME, gappyBatch());
});

Then("that image's key carries its estimated capture time", async ({ app }) => {
  // Interpolated halfway between its neighbours: 12:05 camera time.
  const key = mediaKeyOf(gappyBatch()[1], '20260701120500');
  expect(imagePuts(app).map((p) => p.key)).toContain(key);
  // media.csv col 4 is the same moment, from the same estimate (Bear Canyon is in America/Phoenix).
  expect(lastMediaRows(app).find((r) => r[0] === key)![4]).toBe('2026-07-01T12:05:00.000-07:00');
});

// --- resume ----------------------------------------------------------------

Given('an upload to the data-bucket collection was interrupted after some images were stored', async ({ app }) => {
  // A small write delay so the session ledger is fully written before the first
  // objects land — see CORRECTIONS.md on the open-session/per-file-state race.
  app.s3.putDelayMs = 150;
  app.s3.putHooks.push((_b, key) =>
    key.endsWith(FAILING_FILE) ? { status: 400, code: 'InvalidRequest', message: 'refused' } : undefined,
  );
  await uploadTo(app, COLLECTION_C_NAME, standardBatch(), 'partial');
  expect(imagePuts(app)).toHaveLength(2);
});

Then('it stores the remaining image under the key it planned', async ({ app }) => {
  await expect(app.page.getByText(/Published \d+ files under/)).toBeVisible({ timeout: 120_000 });
  const specs = standardBatch();
  const failed = specs.findIndex((s) => s.path.endsWith(FAILING_FILE));
  expect(imagePuts(app, app.notes.putsBeforeResume as number).map((p) => p.key)).toEqual([
    mediaKeyOf(specs[failed], STANDARD_STAMPS[failed]),
  ]);
  const records = await app.readFileRecords();
  expect(records.map((r) => r.remoteKey).sort()).toEqual(specs.map((s, i) => mediaKeyOf(s, STANDARD_STAMPS[i])).sort());
});

Then('no image is stored twice', async ({ app }) => {
  const keys = imagePuts(app).map((p) => p.key);
  expect(new Set(keys.map((k) => k.split('/')[1])).size).toBe(keys.length);
});
