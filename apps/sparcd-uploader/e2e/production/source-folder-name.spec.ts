import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

const folderBatch = (folders: string[]) => folders.map((folder, index) => ({
  ...jpegAt(`camera-${index + 1}/IMG_${index + 1}.JPG`, '2026:07:01 12:00:00'),
  path: `${folder}/camera-${index + 1}/IMG_${index + 1}.JPG`,
}));

function savedStatus(page: Page) {
  return page.locator('p[role="status"]').filter({ hasText: 'Local preparation saved.' });
}

async function readPreparations(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('sparcd-flip');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('preparations', 'readonly');
      const read = tx.objectStore('preparations').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }));
}

test('the selected top-level folder name is bold in the shared Describe and Upload status', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  const specs = folderBatch(['WHE19_09.28.26_119.images']);
  const parent = await mkdtemp(join(tmpdir(), 'uploader-source-folder-'));
  const folderPath = join(parent, 'WHE19_09.28.26_119.images');
  try {
    await app.pickFolder(specs, folderPath); await app.waitForInspected();

    const status = savedStatus(page);
    await expect(status).toContainText('Local preparation saved. Original files remain in your folder named: WHE19_09.28.26_119.images.');
    await expect(status.locator('strong')).toHaveText('WHE19_09.28.26_119.images');
    const record = (await readPreparations(page))[0].value;
    expect(record.sourceFolders).toEqual({ names: ['WHE19_09.28.26_119.images'], unknownCount: 0 });

    await app.continueToAssign(); await app.waitForCollections();
    await app.chooseDeployment('Bear Canyon'); await app.setUploader('Ada Lovelace');
    await app.continueToUpload();
    await app.expectStep('Upload');
    await expect(status).toContainText('Original files remain in your folder named: WHE19_09.28.26_119.images.');

    await page.setViewportSize({ width: 360, height: 780 });
    await expect(status.locator('strong')).toHaveText('WHE19_09.28.26_119.images');
    expect(await status.evaluate(el => getComputedStyle(el).userSelect)).toBe('text');
    expect(await status.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('multiple dropped top-level folders are listed by name, excluding nested directories', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  await app.dropFolder(folderBatch(['WHE20_10.01.26_4.images', 'WHE19_09.28.26_119.images']));
  await app.waitForInspected();

  const status = savedStatus(page);
  await expect(status).toContainText('Local preparation saved. Original files remain in the folders named: WHE19_09.28.26_119.images, WHE20_10.01.26_4.images.');
  await expect(status.locator('strong')).toHaveText(['WHE19_09.28.26_119.images', 'WHE20_10.01.26_4.images']);
  const record = (await readPreparations(page))[0].value;
  expect(record.sourceFolders).toEqual({ names: ['WHE19_09.28.26_119.images', 'WHE20_10.01.26_4.images'], unknownCount: 0 });
});

test('the phone photo-selection fallback preserves the status and explains its unknown folder name', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.open({ noFolderPicker: true }); await app.connect();
  await app.pickFiles([jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00')]);
  await app.waitForInspected();

  const status = savedStatus(page);
  await expect(status).toContainText('Local preparation saved. Original files remain in your folder. Could not determine the source folder name.');
  await expect(status.locator('strong')).toHaveCount(0);
  const record = (await readPreparations(page))[0].value;
  expect(record.sourceFolders).toEqual({ names: [], unknownCount: 1 });
});

test('choosing a new batch replaces the previous source folder name', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  await app.dropFolder(folderBatch(['WHE19_09.28.26_119.images'])); await app.waitForInspected();
  await expect(savedStatus(page).locator('strong')).toHaveText('WHE19_09.28.26_119.images');

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await app.expectStep('Choose');
  await app.dropFolder(folderBatch(['WHE21_11.02.26_3.images'])); await app.waitForInspected();
  const status = savedStatus(page);
  await expect(status.locator('strong')).toHaveText('WHE21_11.02.26_3.images');
  await expect(status).not.toContainText('WHE19_09.28.26_119.images');
});

test('a restored preparation retains its selected folder name', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  const specs = folderBatch(['WHE19_09.28.26_119.images']);
  await app.dropFolder(specs); await app.waitForInspected();
  await expect(savedStatus(page).locator('strong')).toHaveText('WHE19_09.28.26_119.images');

  await app.reopen();
  await app.seedPickedFolder(specs);
  const recovery = page.getByRole('region', { name: 'Saved local preparation' });
  await recovery.getByRole('button', { name: 'Reselect saved batch folder' }).click();
  await app.waitForInspected();
  await expect(savedStatus(page).locator('strong')).toHaveText('WHE19_09.28.26_119.images');
});
