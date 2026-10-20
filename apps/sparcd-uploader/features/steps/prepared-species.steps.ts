import { S3_ORIGIN } from './app';
import { Given, When, Then, expect } from './fixtures';
import { BUCKET_A, UUID_A, SETTINGS_BUCKET } from './fixtures-data';
const scopedKey = `Collections/${UUID_A}/species.json`;
const scoped = JSON.stringify([{ name: 'Alpha Coyote', scientificName: 'Canis latrans', speciesIconURL: '', keyBinding: 'Y' }]);

Given('Alpha has a collection-specific species list', async ({ app }) => {
  app.s3.put(BUCKET_A, scopedKey, scoped, { contentType: 'application/json' });
});

Then('local tagging requires online species preparation', async ({ app }) => {
  await expect(app.page.getByRole('button', { name: 'Tag species before upload', exact: true })).toBeDisabled();
  await expect(app.page.getByText('Tagging requires prior online species preparation.', { exact: false })).toBeVisible();
  await expect(app.continueButton()).toBeEnabled();
  expect(await app.listedFiles()).toHaveLength(4);
});

Then('the real Tagger uses only the prepared Alpha species', async ({ app }) => {
  const panel = app.page.getByTestId('species-panel');
  await expect(panel.getByText('Alpha Coyote', { exact: true })).toBeVisible();
  await expect(panel.getByText('Casper', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Ghost', { exact: true })).toHaveCount(0);
  const [record] = await app.readFlipRecords();
  expect(record.preparedSpecies.collectionKey).toBe(`${BUCKET_A}::${UUID_A}`);
  expect(record.preparedSpecies.sourceKey).toBe(scopedKey);
  expect(record.preparedSpecies.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(record.preparedSpecies)).not.toContain('test-secret-key');
  await app.page.locator('button[title="IMG_0002.JPG"]').click();
  await app.page.keyboard.press('y');
  await expect(app.page.locator('button[title="IMG_0002.JPG"]')).toContainText('Alpha Coyote');
});

When('the live shared account changes during local tagging', async ({ app }) => {
  // Real shared login via a sibling page; no protocol messages or app records are forged.
  const sibling = await app.page.context().newPage();
  try {
    await app.s3.install(sibling, S3_ORIGIN);
    await sibling.goto('/sparcd-exploration/uploader/');
    await expect(sibling.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await sibling.fill('#endpoint', S3_ORIGIN);
    await sibling.fill('#accessKey', 'other-person');
    await sibling.fill('#secretKey', 'other-secret');
    await sibling.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(sibling.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    await expect.poll(() => app.page.evaluate(() => JSON.parse(sessionStorage.getItem('sparcd-connection-tab') || '{}').accessKey)).toBe('other-person');
  } finally { await sibling.close(); }
});

Given('Alpha species preparation will fail with {string}', async ({ app }, failure: string) => {
  if (failure === 'denied') app.s3.unreadableKeys.add(`${BUCKET_A}/${scopedKey}`);
  else app.s3.put(BUCKET_A, scopedKey, failure === 'malformed' ? '{bad JSON' : '[]', { contentType: 'application/json' });
  if (failure === 'empty') app.s3.put(SETTINGS_BUCKET, 'Settings/species.json', '[]', { contentType: 'application/json' });
});
When('Alpha species preparation is attempted', async ({ app }) => {
  const panel = app.page.getByRole('region', { name: 'Prepare species for local tagging' });
  await panel.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await panel.getByRole('option').filter({ hasText: 'Alpha Collection' }).click();
  await panel.getByRole('button', { name: 'Prepare species', exact: true }).click();
});
Then('a preparation error preserves Inspect and blocks local tagging', async ({ app }) => {
  const panel = app.page.getByRole('region', { name: 'Prepare species for local tagging' });
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Tag species before upload', exact: true })).toBeDisabled();
  await expect(app.continueButton()).toBeEnabled();
  expect(await app.listedFiles()).toHaveLength(4);
});

When('the assigned species list is {string}', async ({ app }, change: string) => {
  const rows = [{ name: 'Ghost', scientificName: 'Casper', speciesIconURL: '', keyBinding: 'G' }];
  if (change === 'renamed') rows.push({ name: 'Updated Coyote', scientificName: 'Canis latrans', speciesIconURL: '', keyBinding: 'C' });
  app.s3.put(BUCKET_A, scopedKey, JSON.stringify(rows), { contentType: 'application/json' });
});

Then('Assign requires species review for {string}', async ({ app }, change: string) => {
  await app.continueToAssign();
  await app.waitForCollections();
  await app.setUploader('Anita');
  await app.chooseDeployment('Bear Canyon');
  await app.fillRequiredUploadComments();
  const review = app.page.getByRole('region', { name: 'Prepared species assignment review' });
  if (change === 'renamed') {
    const confirm = review.getByRole('checkbox');
    await expect(confirm).toBeVisible();
    await expect(app.continueButton()).toBeDisabled();
    await confirm.check();
    await expect(app.continueButton()).toBeEnabled();
  } else {
    await expect(review.getByRole('alert')).toContainText('Canis latrans');
    await expect(app.continueButton()).toBeDisabled();
    await expect(review.getByRole('checkbox')).toHaveCount(0);
  }
  await app.page.getByRole('button', { name: 'Back', exact: true }).click();
  expect((await app.listedFiles()).find((file) => file.name === 'IMG_0002.JPG')?.species).toBe('Coyote×1');
});

When('the handoff preparation becomes {string}', async ({ app }, problem: string) => {
  await expect.poll(async () => (await app.readFlipRecords())[0]?.tags['SDCARD/IMG_0002.JPG']?.[0]?.scientificName).toBe('Canis latrans');
  const [record] = await app.readFlipRecords();
  await app.patchFlipRecord(record.id, { preparedSpecies: problem === 'missing' ? undefined : { ...record.preparedSpecies, v: 99 } });
  await app.page.reload();
});
Then('the Tagger explains preparation recovery and preserves the batch', async ({ app }) => {
  await expect(app.page.getByRole('alert')).toContainText('Your inspected files and existing tags are unchanged');
  await expect(app.page.getByRole('link', { name: 'Back to Uploader', exact: true })).toBeVisible();
  await expect(app.page.getByTestId('species-panel')).toHaveCount(0);
  const [record] = await app.readFlipRecords();
  expect(record.files).toHaveLength(4);
  expect(record.tags['SDCARD/IMG_0002.JPG'][0].scientificName).toBe('Canis latrans');
});
