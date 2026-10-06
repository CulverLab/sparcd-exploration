import type { Page } from '@playwright/test';
import { parseObservations } from '@sparcd/camtrap';
import {
  Given,
  When,
  Then,
  expect,
  collectionButton,
  collectionRail,
  gridCell,
  openUpload,
  sectionTab,
  selectCollection,
  uploadRow,
} from './support/world';
import {
  BUCKET,
  COLLECTION_NAME,
  DATA_BUCKET,
  MEDIA_F,
  PREFIX_A,
  PREFIX_B,
  PREFIX_F,
  mediaKey,
  seedDataBucket,
} from './support/data';
import { makeLocalEdit, runLiveSync } from './support/flows';

/** The tile painted its image from a URL signed for `bucket`/`key`. */
async function expectRendered(page: Page, file: string, bucket: string, key: string): Promise<void> {
  const img = gridCell(page, file).locator('img');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  const url = new URL((await img.getAttribute('src'))!);
  expect(url.pathname).toBe(`/${bucket}/${key}`);
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
}

const coyoteRow = (s3: { text: (bucket: string, key: string) => string }) =>
  parseObservations(s3.text(DATA_BUCKET, `${PREFIX_F}observations.csv`)).find(
    (row) => row.scientificName === 'Canis latrans',
  );

Given('the collection also keeps uploads in a data bucket', ({ s3 }) => {
  seedDataBucket(s3);
});

// --- an upload stored by content -------------------------------------------

When('the upload stored in the data bucket is opened', async ({ page }) => {
  await selectCollection(page);
  await openUpload(page, 'datauser');
});

Then('its images render from their Media keys, signed against the data bucket', async ({ page }) => {
  for (const m of MEDIA_F) await expectRendered(page, m.file, DATA_BUCKET, m.key!);
});

When('a species is applied to one of its images and synced', async ({ page }) => {
  await makeLocalEdit(page, MEDIA_F[0].file);
  await runLiveSync(page);
});

Then("that upload's observations.csv in the data bucket records it", ({ s3 }) => {
  expect(coyoteRow(s3)?.mediaId).toBe(MEDIA_F[0].key);
});

Then("the observation id is built on the image's stamped name", ({ s3 }) => {
  expect(coyoteRow(s3)?.observationId).toBe('20260830061500-IMG101.JPG:0');
});

Then("nothing is written outside that upload's folder in the data bucket", ({ s3 }) => {
  expect(s3.puts.length).toBeGreaterThan(0);
  expect(s3.puts.filter((p) => p.bucket !== DATA_BUCKET || !p.key.startsWith(PREFIX_F))).toEqual([]);
});

// --- one collection, two buckets -------------------------------------------

Then('the collection is listed once in the rail', async ({ page }) => {
  await expect(collectionButton(page, COLLECTION_NAME)).toHaveCount(1);
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(2);
});

When('the collection is selected', async ({ page }) => {
  await selectCollection(page);
});

Then('its uploads from both buckets are listed', async ({ page }) => {
  await expect(uploadRow(page, 'datauser')).toBeVisible(); // data bucket only
  for (const user of ['priortagger', 'newuploader', 'videoproducer', 'camerauser']) {
    await expect(uploadRow(page, user)).toBeVisible(); // legacy bucket only
  }
  await expect(page.locator('main p').filter({ hasText: /uploads?\b/ }).first()).toContainText('6 uploads');
});

Then('an upload folder present in both buckets is listed once', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toHaveCount(1);
});

Then('that upload opens from the data bucket', async ({ page }) => {
  await openUpload(page, 'fielduser');
  await expectRendered(page, 'FOX001.JPG', DATA_BUCKET, mediaKey(PREFIX_B, 'FOX001.JPG'));
});

Then('an old-layout upload in the legacy bucket still opens and renders from there', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
  await openUpload(page, 'priortagger');
  await expectRendered(page, 'IMG001.JPG', BUCKET, mediaKey(PREFIX_A, 'IMG001.JPG'));
});

// --- a folder still being written --------------------------------------------

Then('the upload still being written is not listed', async ({ page }) => {
  await expect(uploadRow(page, 'datauser')).toBeVisible();
  await expect(uploadRow(page, 'halfway')).toHaveCount(0);
});
