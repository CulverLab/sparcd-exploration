import { Given, When, Then, expect } from './fixtures';
import { APP_PATH } from './app';
import { BUCKET_A, BUCKET_B, COLLECTION_A_NAME, COLLECTION_B_NAME, UUID_A, UUID_B } from './fixtures-data';
import { standardBatch } from './batches';

const COLLECTION_SPECIES_KEY = `Collections/${UUID_A}/species.json`;
const speciesJson = (name: string, scientificName: string) => JSON.stringify([{ name, scientificName, speciesIconURL: '', keyBinding: null }]);
const chooser = (app: import('./app').App) => app.page.getByRole('dialog', { name: 'Choose a species list' });

When('the species list chooser is opened', async ({ app }) => {
  await app.stubTagger();
  await app.page.getByRole('button', { name: 'Tag species before upload' }).click();
  await expect(chooser(app)).toBeVisible();
});

Then('it offers the Master species list and discovered collections', async ({ app }) => {
  await expect(chooser(app).getByRole('radio', { name: /Master species list/ })).toBeChecked();
  await chooser(app).getByRole('radio', { name: /Use a collection/ }).check();
  const collections = chooser(app).getByLabel('Collection', { exact: true });
  await expect(collections.locator('option', { hasText: COLLECTION_A_NAME })).toHaveCount(1);
  await expect(collections.locator('option', { hasText: 'Beta Collection' })).toHaveCount(1);
});

Then('Alpha collection species have not been read', async ({ app }) => {
  expect(app.s3.gets).not.toContain(`${BUCKET_A}/${COLLECTION_SPECIES_KEY}`);
});

Given('Alpha Collection has a species list containing Fox', async ({ app }) => {
  app.s3.put(BUCKET_A, COLLECTION_SPECIES_KEY, speciesJson('Fox', 'Vulpes vulpes'), { contentType: 'application/json' });
});

Given('Alpha Collection has a species list containing only Fox', async ({ app }) => {
  app.s3.put(BUCKET_A, COLLECTION_SPECIES_KEY, speciesJson('Fox', 'Vulpes vulpes'), { contentType: 'application/json' });
});

Given('a batch was tagged using Alpha Collection species and handed back', async ({ app }) => {
  app.s3.put(BUCKET_A, COLLECTION_SPECIES_KEY, speciesJson('Ghost', 'Casper'), { contentType: 'application/json' });
  await app.stubTagger();
  await app.page.getByRole('button', { name: 'Tag species before upload' }).click();
  const dialog = chooser(app);
  await dialog.getByRole('radio', { name: /Use a collection/ }).check();
  await dialog.getByLabel('Collection', { exact: true }).selectOption(`${BUCKET_A}::${UUID_A}`);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  const id = new URL(app.page.url()).searchParams.get('batch')!;
  app.notes.flipId = id;
  await app.finishFlipRecord(id, {
    'SDCARD/IMG_0001.JPG': [{ scientificName: 'Casper', commonName: 'Ghost', count: 1, requestedSpecies: '', freeTags: '' }],
  }, 'Anita');
  app.notes.expectedGhostTag = { scientificName: 'Casper', commonName: 'Ghost', count: 1, requestedSpecies: '', freeTags: '' };
  app.notes.expectedTagger = 'Anita';
  await app.page.goto(`${APP_PATH}?flip=${id}`);
  await app.seedPickedFolder(app.lastSpecs);
  await app.page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(app.fileListToggle()).toBeVisible();
});

When('the batch is re-entered using the Master species list and returned', async ({ app }) => {
  const id = app.notes.flipId as string;
  await app.page.getByRole('button', { name: 'Edit tags' }).click();
  const dialog = chooser(app);
  await dialog.getByRole('radio', { name: /Master species list/ }).check();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  await app.finishFlipRecord(id, {
    'SDCARD/IMG_0001.JPG': [app.notes.expectedGhostTag],
  }, app.notes.expectedTagger as string);
  await app.page.goto(`${APP_PATH}?flip=${id}`);
  await app.seedPickedFolder(app.lastSpecs);
  await app.page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(app.fileListToggle()).toBeVisible();
});

Then('Ghost, its count, and attribution are preserved', async ({ app }) => {
  const [record] = await app.readFlipRecords();
  expect(record.tags['SDCARD/IMG_0001.JPG']).toEqual([app.notes.expectedGhostTag]);
  expect(record.tags['SDCARD/IMG_0001.JPG'][0].count).toBe(1);
  expect(record.taggerUser).toBe(app.notes.expectedTagger);
  expect(record.preparedSpecies.collectionKey).toBe('Settings/species.json');
});

Given('Beta Collection has a species list containing only Fox', async ({ app }) => {
  app.s3.put(BUCKET_B, `Collections/${UUID_B}/species.json`, speciesJson('Fox', 'Vulpes vulpes'), { contentType: 'application/json' });
});

Given('Alpha Collection species are {word}', async ({ app }, state: string) => {
  const key = `${BUCKET_A}/${COLLECTION_SPECIES_KEY}`;
  if (state === 'missing') app.s3.delete(BUCKET_A, COLLECTION_SPECIES_KEY);
  else if (state === 'empty') app.s3.put(BUCKET_A, COLLECTION_SPECIES_KEY, '[]', { contentType: 'application/json' });
  else if (state === 'denied') app.s3.unreadableKeys.add(key);
  else if (state === 'malformed') app.s3.put(BUCKET_A, COLLECTION_SPECIES_KEY, '{not json', { contentType: 'application/json' });
  else throw new Error(`Unknown collection species state: ${state}`);
});

When('Alpha Collection is chosen and continued', async ({ app }) => {
  const dialog = chooser(app);
  if (await dialog.getByRole('radio', { name: /Use a collection/ }).count()) {
    await dialog.getByRole('radio', { name: /Use a collection/ }).check();
    await dialog.getByLabel('Collection', { exact: true }).selectOption(`${BUCKET_A}::${UUID_A}`);
    app.notes.settingsSpeciesReadsBeforeContinue = app.s3.gets.filter(key => key.endsWith('/Settings/species.json')).length;
  } else {
    await dialog.getByRole('radio', { name: new RegExp(COLLECTION_A_NAME) }).check();
  }
  await dialog.getByRole('button', { name: 'Continue' }).click();
});

Then('the Tagger hand-off uses Alpha Collection species', async ({ app }) => {
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  const [record] = await app.readFlipRecords();
  expect(record.preparedSpecies).toMatchObject({
    collectionKey: `${BUCKET_A}::${UUID_A}`,
    collectionName: COLLECTION_A_NAME,
    sourceBucket: BUCKET_A,
    sourceKey: COLLECTION_SPECIES_KEY,
  });
  expect(record.preparedSpecies.species.map((item: { scientificName: string }) => item.scientificName)).toEqual(['Vulpes vulpes']);
});

Then('the Tagger hand-off for Alpha Collection uses the Master species list', async ({ app }) => {
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  const [record] = await app.readFlipRecords();
  expect(record.preparedSpecies).toMatchObject({
    collectionKey: `${BUCKET_A}::${UUID_A}`,
    sourceKey: 'Settings/species.json',
  });
  expect(record.preparedSpecies.species.map((item: { scientificName: string }) => item.scientificName)).toEqual(['Canis latrans', 'Casper']);
});

Then('the collection species error is shown without using the Master list', async ({ app }) => {
  await expect(chooser(app).getByRole('alert')).toBeVisible();
  await expect(app.page).toHaveURL(/\/uploader\//);
  expect(await app.readFlipRecords()).toHaveLength(0);
  expect(app.s3.gets.filter(key => key.endsWith('/Settings/species.json')).length)
    .toBe(app.notes.settingsSpeciesReadsBeforeContinue);
});

When('the Uploader is reopened with another batch and taken offline', async ({ app }) => {
  await app.page.goto(APP_PATH);
  await expect(app.page.getByRole('button', { name: 'Logout' })).toBeVisible();
  // Load the app's lazy processing worker while connected, then verify the
  // next batch remains usable after the connection drops.
  await app.rescan(standardBatch());
  await app.waitForInspected();
  app.s3.offline = true;
  await app.page.context().setOffline(true);
});

Then('the offline message and locally saved Alpha Collection choice are shown', async ({ app }) => {
  const dialog = chooser(app);
  await expect(dialog.getByText('You’re offline. Only species lists saved on this device are available.')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: new RegExp(COLLECTION_A_NAME) })).toBeVisible();
  app.notes.offlineRequestsBeforeContinue = app.s3.gets.length + app.s3.heads.length + app.s3.lists.length;
});

Then('the offline Tagger hand-off uses the saved Alpha Collection species without requests', async ({ app }) => {
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  const [record] = await app.readFlipRecords();
  expect(record.preparedSpecies).toMatchObject({ collectionKey: `${BUCKET_A}::${UUID_A}`, sourceKey: COLLECTION_SPECIES_KEY });
  expect(app.s3.gets.length + app.s3.heads.length + app.s3.lists.length).toBe(app.notes.offlineRequestsBeforeContinue);
});

Given('the Uploader has no locally saved species lists and is taken offline', async ({ app }) => {
  app.s3.offline = true;
  await app.page.context().setOffline(true);
  await app.page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('sparcd-flip');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('vocabularies')) { db.close(); resolve(); return; }
      const tx = db.transaction('vocabularies', 'readwrite');
      tx.objectStore('vocabularies').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
});

Given('a folder is scanned while offline', async ({ app }) => {
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
});

Then('the offline empty state and Cancel action are shown', async ({ app }) => {
  const dialog = chooser(app);
  await expect(dialog.getByText('You’re offline, and no species lists are saved on this device.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue' })).toHaveCount(0);
});

When('the chooser is canceled', async ({ app }) => {
  await chooser(app).getByRole('button', { name: 'Cancel' }).click();
});

Then('the batch remains in Inspect and no Tagger hand-off is created', async ({ app }) => {
  await expect(chooser(app)).toHaveCount(0);
  await app.expectStep('Verify');
  expect(await app.readFlipRecords()).toHaveLength(0);
});

When('the tagged batch is published to Beta Collection', async ({ app }) => {
  await app.continueToAssign();
  await app.waitForCollections();
  await app.chooseCollection(COLLECTION_B_NAME);
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Anita');
  await app.continueToUpload();
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
});

Then('the saved observations still contain Ghost', async ({ app }) => {
  const rows = app.s3.puts.find(item => item.key.endsWith('observations.csv'))?.body ?? '';
  expect(rows).toContain('Casper');
  expect(rows).toContain('Ghost');
});

Then('the upload destination is Beta Collection', async ({ app }) => {
  expect(app.s3.puts.some(item => item.bucket === BUCKET_B && item.key.endsWith('/media.csv'))).toBe(true);
});

Then('upload did not read Beta Collection species to validate the tag', async ({ app }) => {
  expect(app.s3.gets).not.toContain(`${BUCKET_B}/Collections/${UUID_B}/species.json`);
});
