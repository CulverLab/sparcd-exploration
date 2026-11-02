import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, SETTINGS_BUCKET } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
import { tagAndReturn } from './tagging-helpers';

const original = jpegAt('OFFLINE.JPG', '2026:07:01 12:00:00');

test('a saved tag remains publishable when its species is absent from the current vocabulary', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  await app.connect(); await app.waitForSpeciesCache();
  await app.dropFolder([original]); await app.waitForInspected(); await tagAndReturn(app);
  await app.walkToUploadStep({ description: 'Species absent from current list' });
  await (await app.dryRunCheckbox()).uncheck();

  const speciesReads = s3.gets.filter(key => key.endsWith('species.json')).length;
  const savedTags = (await app.readFlipRecords())[0].tags;
  // Change the Master list after tagging; publication must preserve the user's identification.
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify([{ name: 'Ghost', scientificName: 'Casper' }]), { contentType: 'application/json' });
  await app.startRun(); await app.waitForRunPhase('done');

  const bundles = await app.readBundleRecords();
  expect(bundles[0].observationsCsv).toContain('Canis latrans');
  expect(s3.gets.filter(key => key.endsWith('species.json'))).toHaveLength(speciesReads);
  expect(s3.puts.some(record => record.key.endsWith('observations.csv'))).toBe(true);
  expect(await app.readBatchRecords()).toHaveLength(1);
  expect(savedTags['SDCARD/OFFLINE.JPG'][0]).toMatchObject({ scientificName: 'Canis latrans', count: 1 });
});
