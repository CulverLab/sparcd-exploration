import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test('mixed preparation recovery restores verified tags and retains every original for retry after reload', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  const specs = ['GOOD.JPG', 'MISSING.JPG', 'CHANGED.JPG'].map(name => jpegAt(name, '2026:07:01 12:00:00'));
  await app.dropFolder(specs); await app.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  // Model a pre-existing tagged journal. Inspection and recovery use real
  // media, workers, and the production IndexedDB implementation.
  const saved = await page.evaluate(async () => {
    const open = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
    const tx = db.transaction('preparations', 'readwrite');
    const table = tx.objectStore('preparations');
    const rows: any[] = await new Promise(resolve => { const read = table.getAll(); read.onsuccess = () => resolve(read.result); });
    const row = rows[0];
    row.value.files[0].preTags = [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 5, requestedSpecies: '', freeTags: '' }];
    row.value.files[0].preTaggerUser = 'Saved Identifier';
    table.put(row);
    await new Promise<void>(resolve => { tx.oncomplete = () => { db.close(); resolve(); }; });
    return { id: row.id, hashes: row.value.files.map((file: any) => file.sha256) };
  });
  const changed = jpegAt('CHANGED.JPG', '2026:07:02 12:00:00');
  expect(changed.bytes!.length).toBe(specs[2].bytes!.length);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.reload(); await app.seedPickedFolder([specs[0], changed]);
    await page.getByRole('button', { name: 'Reselect saved batch folder', exact: true }).click();
    const problems = page.getByRole('region', { name: 'Original files need recovery' });
    await expect(problems).toContainText('2 original files need recovery');
    await expect(problems).toContainText('MISSING.JPG: not in the selected folder');
    await expect(problems).toContainText('CHANGED.JPG: content hash differs');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Tag species before upload', exact: true })).toBeDisabled();
    await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Reselect original files', exact: true }).click();
  await app.seedPickedFolder(specs);
  await page.getByRole('button', { name: 'Reselect saved batch folder', exact: true }).click();
  await app.waitForInspected();
  await expect(page.getByRole('region', { name: 'Original files need recovery' })).toHaveCount(0);
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  const restored = await page.evaluate(async id => {
    const open = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
    const tx = db.transaction('preparations', 'readonly');
    const read = tx.objectStore('preparations').get(id);
    const row: any = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
    await new Promise<void>(resolve => { tx.oncomplete = () => { db.close(); resolve(); }; });
    return row.value.files;
  }, saved.id);
  expect(restored.map((file: any) => file.sha256)).toEqual(saved.hashes);
  expect(restored.every((file: any) => file.processState === 'ready' && !file.needsOriginal)).toBe(true);
  expect(restored[0]).toMatchObject({ preTags: [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 5 }], preTaggerUser: 'Saved Identifier' });
});
