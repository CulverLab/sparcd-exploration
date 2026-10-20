import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test('a failed final local-Tagger write keeps edits visible and Done retryable', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  const preparation = page.getByRole('region', { name: 'Prepare species for local tagging' });
  await preparation.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await preparation.getByRole('option').filter({ hasText: 'Alpha Collection' }).click();
  await preparation.getByRole('button', { name: 'Prepare species', exact: true }).click();
  await expect(preparation.getByRole('status')).toContainText('Species prepared for');
  const specs = [jpegAt('RETURN.JPG', '2026:07:01 12:00:00')];
  await app.dropFolder(specs); await app.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#user').fill('return-person');
  await page.getByRole('button', { name: 'Tag', exact: true }).click();
  await page.locator('button[title="RETURN.JPG"]').click();
  await page.locator('div.group').filter({ hasText: 'Canis latrans' }).first().locator('button[title^="Apply"]').click();
  await expect.poll(async () => (await app.readFlipRecords())[0]?.tags?.['SDCARD/RETURN.JPG']?.[0]?.scientificName).toBe('Canis latrans');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restoreReturnWrite = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'records') throw new DOMException('Test final-write failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const done = page.getByRole('button', { name: 'Done · back to Uploader' });
  await done.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save the batch for the Uploader.' })).toBeVisible();
  await expect(done).toBeEnabled();
  await expect(page.locator('button[title="RETURN.JPG"]')).toContainText('Coyote');
  await page.evaluate(() => (window as any).__restoreReturnWrite());
  await done.click(); await page.waitForURL(/\/uploader\/\?flip=/);
  await app.seedPickedFolder(specs);
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
  const [record] = await app.readFlipRecords();
  expect(record.tags['SDCARD/RETURN.JPG']).toHaveLength(1);
  expect(record.tags['SDCARD/RETURN.JPG'][0].scientificName).toBe('Canis latrans');
});
