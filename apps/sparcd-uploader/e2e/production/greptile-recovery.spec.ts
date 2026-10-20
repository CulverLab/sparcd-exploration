import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
async function prepare(app: App) {
  const area = app.page.getByRole('region', { name: 'Prepare species for local tagging' });
  await area.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await area.getByRole('option').filter({ hasText: 'Alpha Collection' }).click();
  await area.getByRole('button', { name: 'Prepare species', exact: true }).click();
  await expect(area.getByRole('status')).toContainText('Species prepared for Alpha Collection');
}
async function rows(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('sparcd-flip');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(table, 'readonly');
      const read = transaction.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  }), table);
}
for (const nativeFolderAPI of [false, true]) test(`individual-file preparation recovers without path rewriting (${nativeFolderAPI ? 'folder API available' : 'phone-shaped'})`, async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  let app = new App(page, s3); await app.open({ noFolderPicker: true }); await app.connect(); await prepare(app);
  const spec = jpegAt('ROOT.JPG', '2026:07:01 12:00:00');
  await app.pickFiles([spec]); await app.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  let current = page;
  if (nativeFolderAPI) {
    current = await context.newPage(); app = new App(current, s3); await app.open();
    await expect(current.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    await page.close();
  } else await current.reload();
  const recovery = current.getByRole('region', { name: 'Saved local preparation' });
  if (!nativeFolderAPI) await expect(recovery.getByRole('button', { name: 'Reselect saved batch folder' })).toHaveCount(0);
  async function select(bytes: Buffer) {
    const pending = current.waitForEvent('filechooser');
    await recovery.getByRole('button', { name: 'Reselect saved files', exact: true }).click();
    await (await pending).setFiles({ name: 'ROOT.JPG', mimeType: 'image/jpeg', buffer: bytes });
  }
  const edited = jpegAt('ROOT.JPG', '2026:07:02 12:00:00');
  expect(edited.bytes!.length).toBe(spec.bytes!.length);
  await select(edited.bytes!);
  await expect(recovery.getByRole('alert')).toContainText('content hash differs');
  await select(spec.bytes!); await app.waitForInspected();
  await current.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await current.waitForURL(/\/tagger\/\?batch=/);
  const record = (await app.readFlipRecords())[0];
  expect(record.files[0].relPath).toBe('ROOT.JPG');
  expect(record.files[0].exifTimestamp).toBe('2026-07-01T12:00:00');
});
for (const failSave of [false, true]) test(`Settings Disconnect confirms ${failSave ? 'unsaved preparation' : 'saved and unsupported preparations'} and preserves Cancel`, async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await prepare(app);
  if (failSave) await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restorePreparationWrite = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'preparations') throw new DOMException('Test quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await app.dropFolder([jpegAt('KEEP.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  if (failSave) await expect(page.getByRole('alert').filter({ hasText: 'Local preparation could not be saved.' })).toBeVisible();
  else {
    await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('sparcd-flip');
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('preparations', 'readwrite');
        transaction.objectStore('preparations').put({ id: 'unsupported', value: { v: 99 } });
        transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => reject(transaction.error);
      };
    }));
  }
  await app.gotoSection('Settings');
  const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
  await disconnect.click();
  const dialog = page.getByRole('dialog', { name: 'Saved preparations' });
  await expect(dialog).toContainText(failSave ? '1 saved preparation' : '2 saved preparations');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(disconnect).toBeFocused();
  await disconnect.click(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await rows(page, 'preparations')).length).toBe(failSave ? 0 : 2);
  if (failSave) {
    await page.evaluate(() => (window as any).__restorePreparationWrite());
    await app.gotoSection('New upload');
    await page.getByRole('button', { name: 'Retry saving preparation' }).click();
    await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  }
  await app.gotoSection('Settings');
  await disconnect.click(); await dialog.getByRole('button', { name: 'Review preparations' }).click();
  await app.waitForInspected(); await app.showFileList(); await expect(app.fileListPane()).toContainText('KEEP.JPG');
  await app.gotoSection('Settings'); await disconnect.click();
  await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Discard & disconnect' }).click()]);
  await expect(app.connectForm()).toBeVisible();
  expect(await rows(page, 'preparations')).toEqual([]);
  expect(await rows(page, 'vocabularies')).toEqual([]);
});
for (const source of ['saved handle', 'newly selected handle']) test(`recovery preserves ${source} through reload and full-resolution local media`, async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await prepare(app);
  const image = jpegAt('SOURCE.JPG', '2026:07:01 12:00:00');
  const video = await readFile(new URL('../../test/fixtures/recovery-video.mp4', import.meta.url));
  const originals = [image, { path: 'SDCARD/CLIP.MP4', mime: 'video/mp4', bytes: video }];
  async function useRealHandle() {
    await page.evaluate(async entries => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('SDCARD', { create: true });
      for (const entry of entries) {
        const handle = await folder.getFileHandle(entry.name, { create: true });
        const writable = await handle.createWritable();
        const bytes = Uint8Array.from(atob(entry.b64), c => c.charCodeAt(0));
        await writable.write(bytes); await writable.close();
      }
      window.showDirectoryPicker = async () => folder;
    }, originals.map(entry => ({ name: entry.path.split('/').pop()!, b64: entry.bytes!.toString('base64') })));
  }
  if (source === 'saved handle') {
    await useRealHandle(); await page.getByRole('button', { name: 'Drop a folder of JPEGs or MP4 videos, or choose a folder', exact: true }).click();
  } else await app.dropFolder(originals);
  await app.waitForInspected(); await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  await page.reload();
  const recovery = page.getByRole('region', { name: 'Saved local preparation' });
  if (source === 'saved handle') await recovery.getByRole('button', { name: 'Reopen saved folder' }).click();
  else { await useRealHandle(); await recovery.getByRole('button', { name: 'Reselect saved batch folder' }).click(); }
  await app.waitForInspected(); await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  await page.reload();
  await recovery.getByRole('button', { name: 'Reopen saved folder' }).click();
  await app.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  await expect(page.getByText('Showing saved thumbnails.', { exact: false })).toHaveCount(0);
  await page.locator('button[title="SOURCE.JPG"]').click();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  const focus = page.getByRole('dialog', { name: 'Focus image viewer' });
  const img = focus.getByRole('img', { name: 'SOURCE.JPG', exact: true });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(async node => (await (await fetch((node as HTMLImageElement).src)).arrayBuffer()).byteLength)).toBe(image.bytes!.length);
  await focus.getByRole('button', { name: 'Close Focus', exact: true }).click();
  await page.locator('button[title="CLIP.MP4"]').click();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  const player = focus.locator('video'); await expect(player).toBeVisible();
  await player.evaluate(async node => { node.muted = true; await node.play(); });
  await expect.poll(() => player.evaluate(node => node.currentTime)).toBeGreaterThan(0);
});
