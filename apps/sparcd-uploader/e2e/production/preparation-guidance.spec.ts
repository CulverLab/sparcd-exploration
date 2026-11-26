import { test, expect, type Page } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
import type { LocalPreparation } from '../../src/lib/preparation';

async function preparations(page: Page): Promise<{ id: string; value: LocalPreparation }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('sparcd-flip');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('preparations', 'readonly');
      const read = tx.objectStore('preparations').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}

test('saved preparation explains restoration, identifies choices, and provides keyboard help on a phone', async ({ page }, info) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await app.waitForSpeciesCache();
  await app.dropFolder([jpegAt('FIRST.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  await expect(page.getByText('Local preparation saved.', { exact: true })).toBeVisible();
  const [first] = await preparations(page);
  await app.reopen();
  await app.dropFolder([{ ...jpegAt('SECOND.JPG', '2026:07:02 12:00:00'), path: 'CAMERA_B/SECOND.JPG' }]);
  await app.waitForInspected();
  await expect(page.getByText('Local preparation saved.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await preparations(page)).length).toBe(2);
  await app.reopen();
  const box = page.getByRole('region', { name: 'Saved local preparation' });
  await expect(box.getByRole('heading', { name: 'Continue preparing an upload' })).toBeVisible();
  await expect(box).toContainText('This browser saved your file details');
  await expect(box).toContainText('After restoring your files, review the batch and upload details');
  const choices = box.getByRole('combobox', { name: 'Choose saved preparation', exact: true });
  await expect(choices.getByRole('option')).toHaveCount(2);
  await expect(choices.getByRole('option').filter({ hasText: 'SDCARD (FIRST.JPG)' })).toContainText('1 file — saved');
  await expect(choices.getByRole('option').filter({ hasText: 'CAMERA_B (SECOND.JPG)' })).not.toContainText(/T\d\d:\d\d:.*Z/);
  await choices.selectOption(first.id);
  const folder = box.getByRole('button', { name: 'Choose original folder', exact: true });
  await folder.focus();
  await expect(page.getByRole('tooltip')).toContainText('nothing is uploaded yet');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).not.toBeVisible();
  await folder.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(box.getByRole('button', { name: 'Choose original files', exact: true })).not.toBeVisible();
  await box.getByText('Choose individual files instead', { exact: true }).click();
  await expect(box).toContainText('browser or device cannot choose a whole folder');
  await expect(box.getByRole('button', { name: 'Choose original files', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 780 });
  await folder.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  for (const locator of [box, choices, folder, page.getByRole('tooltip')]) {
    const bounds = await locator.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  }
  await page.screenshot({ path: info.outputPath('saved-preparation-phone.png'), fullPage: true });
  expect(await app.readBatchRecords()).toHaveLength(0);
});

test('a preparation with a started upload sends the user to History without restoring a new batch', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await app.waitForSpeciesCache();
  const specs = [jpegAt('RESUME.JPG', '2026:07:01 12:00:00')];
  await app.dropFolder(specs); await app.waitForInspected();
  await app.walkToUploadStep();
  s3.putHooks.push((_bucket, key) => key.endsWith('RESUME.JPG') ? { status: 400, code: 'InvalidRequest' } : undefined);
  await (await app.dryRunCheckbox()).uncheck(); await app.startRun(); await app.waitForRunPhase('partial');
  const [batch] = await app.readBatchRecords();
  await app.reopen();
  const box = page.getByRole('region', { name: 'Saved local preparation' });
  await expect(box).toContainText('This upload has already started');
  await expect(box.getByRole('heading', { name: 'Find this upload in History' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Choose original folder', exact: true })).toHaveCount(0);
  await expect(box.getByRole('button', { name: 'Choose original files', exact: true })).toHaveCount(0);
  await box.getByRole('button', { name: 'Resume upload in History', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume upload', exact: true })).toBeVisible();
  s3.putHooks.length = 0; await app.seedPickedFolder(specs);
  await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  await app.waitForRunPhase('done');
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].id).toBe(batch.id);
  expect(batches[0].uploadPrefix).toBe(batch.uploadPrefix);
});
