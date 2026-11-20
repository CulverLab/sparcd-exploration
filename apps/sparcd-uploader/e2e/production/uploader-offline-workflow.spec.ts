import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, SETTINGS_BUCKET } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
import { waitForOfflineApps } from './offline-readiness';

const original = jpegAt('OFFLINE.JPG', '2026:07:01 12:00:00');

test('offline cached Master choice permits tagging and stale vocabulary does not block Continue', async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  await app.connect(); await app.waitForSpeciesCache(); await waitForOfflineApps(page);
  await app.dropFolder([original]); await app.waitForInspected();

  await context.setOffline(true); s3.offline = true;
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Choose a species list' });
  await expect(chooser).toContainText('Only species lists saved on this device are available');
  await chooser.getByRole('radio', { name: /Master species list/ }).check();
  await chooser.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  await page.locator('button[title="OFFLINE.JPG"]').click();
  await page.getByTestId('species-panel').locator('div.group').filter({ hasText: 'Canis latrans' }).locator('button[title^="Apply"]').click();
  await page.getByRole('button', { name: 'Done · back to Uploader' }).click();
  await page.waitForURL(/\/uploader\/\?flip=/);
  await app.seedPickedFolder([original]); await page.getByRole('button', { name: 'Choose folder', exact: true }).click(); await app.waitForInspected();

  await context.setOffline(false); s3.offline = false;
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify([{ name: 'Ghost', scientificName: 'Casper' }]), { contentType: 'application/json' });
  await app.continueToAssign(); await app.waitForCollections();
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await app.fillRequiredUploadComments();
  await expect(app.continueButton()).toBeEnabled();
  expect((await app.readFlipRecords())[0].tags['SDCARD/OFFLINE.JPG'][0]).toMatchObject({ scientificName: 'Canis latrans', count: 1 });
});
