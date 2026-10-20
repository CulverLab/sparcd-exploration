import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt, FOLDER } from '../../features/steps/batches';

async function preparations(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('sparcd-flip');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('preparations', 'readonly');
      const rows = tx.objectStore('preparations').getAll();
      tx.oncomplete = () => { db.close(); resolve(rows.result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}

for (const kind of ['folder', 'files'] as const) {
  test(`new-upload ${kind} picker coexists with saved-preparation inputs`, async ({ page }) => {
    const directory = await mkdtemp(join(tmpdir(), 'sparcd-picker-coexistence-'));
    try {
      const s3 = new S3Mock(); seedDefaultStorage(s3);
      const app = new App(page, s3);
      await app.open(kind === 'folder' ? { noDirectoryHandle: true } : { noFolderPicker: true });
      await app.connect();
      const saved = [jpegAt('SAVED.JPG', '2026:07:01 12:00:00')];
      if (kind === 'folder') await app.dropFolder(saved); else await app.pickFiles(saved);
      await app.waitForInspected();
      const savedStatus = page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true });
      await expect(savedStatus).toBeVisible();
      const [original] = await preparations(page);
      await page.reload();
      const recovery = page.getByRole('region', { name: 'Saved local preparation' });
      await expect(recovery).toBeVisible();
      await expect(recovery.getByLabel('Saved preparation folder', { exact: true })).toHaveCount(1);
      await expect(recovery.getByLabel('Saved preparation files', { exact: true })).toHaveCount(1);
      const fresh = [jpegAt('NEW.JPG', '2026:07:02 12:00:00')];
      if (kind === 'folder') await app.pickFolder(fresh, join(directory, 'new', FOLDER));
      else await app.pickFiles(fresh);
      await app.waitForInspected();
      expect((await app.listedFiles()).map(file => file.name)).toEqual(['NEW.JPG']);
      await expect(savedStatus).toBeVisible();
      const rows = await preparations(page);
      expect(rows).toHaveLength(2);
      expect(rows.find(row => row.id === original.id)).toEqual(original);
      // A separate explicit recovery action still restores the original batch.
      await page.reload();
      await recovery.getByRole('combobox', { name: 'Saved batch' }).selectOption(original.id);
      const chooser = page.waitForEvent('filechooser');
      await recovery.getByRole('button', { name: kind === 'folder' ? 'Reselect saved batch folder' : 'Reselect saved files', exact: true }).click();
      if (kind === 'folder') {
        const path = await app.writeFolderToDisk(saved, join(directory, 'saved', FOLDER));
        await (await chooser).setFiles(path);
      } else await (await chooser).setFiles({ name: 'SAVED.JPG', mimeType: 'image/jpeg', buffer: saved[0].bytes! });
      await app.waitForInspected();
      expect((await app.listedFiles()).map(file => file.name)).toEqual(['SAVED.JPG']);
      await expect(savedStatus).toBeVisible();
      expect(await preparations(page)).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
