import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, BUCKET_B, UUID_B } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
async function prepare(app: App, name: string) {
  const area = app.page.getByRole('region', { name: 'Prepare species for local tagging' });
  await area.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await area.getByRole('option').filter({ hasText: name }).click();
  await area.getByRole('button', { name: 'Prepare species', exact: true }).click();
  await expect(area.getByRole('status')).toContainText(`Species prepared for ${name}`);
}
for (const prepared of [true, false]) test(`recovering a ${prepared ? 'prepared Alpha' : 'previously unprepared'} batch refreshes status when Beta is cached`, async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  s3.put(BUCKET_B, `Collections/${UUID_B}/species.json`, JSON.stringify([{ name: 'Beta only', scientificName: 'Beta species', speciesIconURL: '', keyBinding: 'B' }]), { contentType: 'application/json' });
  const a = new App(page, s3); await a.connect();
  if (prepared) await prepare(a, 'Alpha Collection');
  const specs = [jpegAt('ALPHA.JPG', '2026:07:01 12:00:00')];
  await a.dropFolder(specs); await a.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  const sibling = await context.newPage(); const b = new App(sibling, s3); await b.open();
  await expect(sibling.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
  await prepare(b, 'Beta Collection');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Prepare species for local tagging' })).toContainText('Species prepared for Beta Collection');
  await a.seedPickedFolder(specs);
  await page.getByRole('button', { name: 'Reselect saved batch folder' }).click();
  await a.waitForInspected();
  const area = page.getByRole('region', { name: 'Prepare species for local tagging' });
  if (prepared) {
    await expect(area).toContainText('Species prepared for Alpha Collection');
    await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
    await page.waitForURL(/\/tagger\/\?batch=/);
    expect((await a.readFlipRecords())[0].preparedSpecies.collectionName).toBe('Alpha Collection');
  } else {
    await expect(area).not.toContainText('Species prepared for Beta Collection');
    await expect(area).toContainText('Tagging requires prior online species preparation');
    const tag = page.getByRole('button', { name: 'Tag species before upload', exact: true });
    await expect(tag).toBeDisabled();
    await expect(tag).toHaveAttribute('aria-describedby', 'species-preparation-help');
    await expect(page.locator('#species-preparation-help')).toBeVisible();
    await expect(area.getByRole('button', { name: 'Collection for species preparation', exact: true })).toBeVisible();
  }
});
test('a Disconnect while the Flip folder picker is open cannot restore that batch', async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const a = new App(page, s3); await a.connect(); await prepare(a, 'Alpha Collection');
  const specs = [jpegAt('OLD.JPG', '2026:07:01 12:00:00')];
  await a.dropFolder(specs); await a.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  const record = (await a.readFlipRecords())[0];
  await page.goto(record.returnUrl);
  await expect(page.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible();
  await a.seedPickedFolder(specs);
  const sibling = await context.newPage(); const b = new App(sibling, s3); await b.open();
  await expect(sibling.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).showDirectoryPicker = () => new Promise(resolve => { (window as any).__finishReviewPicker = () => resolve((window as any).__pickedFolder); });
  });
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).__finishReviewPicker === 'function');
  await b.disconnectFromHeader();
  await expect(a.connectForm()).toBeVisible();
  await page.evaluate(() => (window as any).__finishReviewPicker());
  // Allow hashing to finish while disconnected; UI state must remain discarded.
  await page.waitForTimeout(1500);
  await a.connect();
  await expect(a.activeStep()).toContainText('Choose');
  await expect(page.getByRole('button', { name: 'Tag species before upload', exact: true })).toHaveCount(0);
});

test('a damaged sibling journal does not hide a healthy saved batch', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await prepare(app, 'Alpha Collection');
  await app.dropFolder([jpegAt('HEALTHY.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('sparcd-flip');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('preparations', 'readwrite');
        tx.objectStore('preparations').put({ id: 'unrelated-future-record', value: { v: 99 } });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      }; request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  const recovery = page.getByRole('region', { name: 'Saved local preparation' });
  await expect(recovery.getByRole('alert')).toContainText('1 saved batch is damaged or from an unsupported version');
  await expect(recovery.getByRole('button', { name: 'Reselect saved batch folder' })).toBeVisible();
  await app.seedPickedFolder([jpegAt('HEALTHY.JPG', '2026:07:01 12:00:00')]);
  await recovery.getByRole('button', { name: 'Reselect saved batch folder' }).click();
  await app.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  const record = (await app.readFlipRecords())[0];
  await page.goto(record.returnUrl);
  // The recovered journal now correctly retains its handle. This fixture's
  // synthetic handle cannot retain prototype methods through IndexedDB cloning;
  // explicitly take the offered permission/reselection fallback. Real handles
  // and original-media playback are covered in greptile-recovery.spec.ts.
  await page.getByRole('button', { name: 'Reselect folder instead', exact: true }).click();
  await app.seedPickedFolder([jpegAt('HEALTHY.JPG', '2026:07:01 12:00:00')]);
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
});
