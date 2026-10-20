import { test, expect, type Page } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

async function preparations(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('sparcd-flip');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('preparations', 'readonly');
      const read = tx.objectStore('preparations').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function savePreparation(page: Page, row: any): Promise<void> {
  await page.evaluate(value => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('sparcd-flip');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('preparations', 'readwrite');
      tx.objectStore('preparations').put(value);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), row);
}
for (const legacy of [false, true]) test(`finishing ${legacy ? 'legacy' : 'owned'} History upload A preserves batch B recovery`, async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  const a = [jpegAt('OLDER-A.JPG', '2026:07:01 12:00:00')];
  const b = [jpegAt('SAVED-B.JPG', '2026:07:02 12:00:00')];
  const species = page.getByRole('region', { name: 'Prepare species for local tagging' });
  await species.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await species.getByRole('option').filter({ hasText: 'Alpha Collection' }).click();
  await species.getByRole('button', { name: 'Prepare species', exact: true }).click();
  await expect(species.getByRole('status')).toContainText('Species prepared for');

  // Save B before starting a real upload: the upload step correctly blocks
  // Back navigation once a real upload has begun.
  await app.dropFolder(b); await app.waitForInspected();
  await app.continueToAssign(); await app.setDescription('Keep these B notes');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  const savedB = (await preparations(page)).find(row => row.value.files[0].fileName === 'SAVED-B.JPG');
  expect(savedB.value.inputs.uploadDescription).toBe('Keep these B notes');
  expect(savedB.value.species.collectionName).toBe('Alpha Collection');

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await app.dropFolder(a); await app.waitForInspected();
  await app.walkToUploadStep({ description: 'Older A' });
  s3.putDelayMs = 150;
  s3.putHooks.push((_bucket, key) => key.endsWith('OLDER-A.JPG') ? { status: 400, code: 'InvalidRequest', message: 'test refusal' } : undefined);
  await (await app.dryRunCheckbox()).uncheck(); await app.startRun(); await app.waitForRunPhase('partial');
  const [batchA] = await app.readBatchRecords();
  expect(batchA.preparationId).toEqual(expect.any(String));
  if (legacy) await page.evaluate(id => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('sparcd-uploader');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('batches', 'readwrite'), table = tx.objectStore('batches');
      const read = table.get(id);
      read.onsuccess = () => { const value = read.result; delete value.preparationId; table.put(value); };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), batchA.id);
  // The wizard can save only one current preparation at a time. Seed B's
  // already-saved record while A is in History so this exercises A's scoped
  // cleanup without trying to navigate Back after a real upload began.
  await savePreparation(page, savedB);
  s3.putHooks.length = 0; await app.seedPickedFolder(a);
  await app.gotoSection('History');
  await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  await app.waitForRunPhase('done');
  await page.reload();
  const rows = await preparations(page);
  expect(rows.find(row => row.id === savedB.id)).toEqual(savedB);
  const recovery = page.getByRole('region', { name: 'Saved local preparation' });
  await expect(recovery).toContainText('1 inspected file');
  await expect(recovery.getByRole('button', { name: 'Reselect saved batch folder', exact: true })).toBeEnabled();
});
