import { expect, type BrowserContext } from '@playwright/test';
import type { App } from '../../features/steps/app';
import { publishedUploads, writtenCsvRows } from '../../features/steps/helpers';

/** Finish the recovered batch through the real upload pipeline (mock S3 only). */
export async function verifyRecoveredUpload(
  app: App,
  context: BrowserContext,
  filename: string,
  person: string,
  preservedMetadata?: { mountainRange: string; dateCollected: string },
) {
  const page = app.page;
  await app.continueButton().click();
  await expect(app.connectForm()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: "You're offline — connecting needs a network connection." })).toBeVisible();
  await context.setOffline(false);
  await app.fillConnection();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
  await app.waitForCollections();
  if (preservedMetadata) {
    await expect(page.locator('#mountainRange')).toHaveValue(preservedMetadata.mountainRange);
    await expect(page.locator('#dateCollected')).toHaveValue(preservedMetadata.dateCollected);
  }
  await app.chooseDeployment('Bear Canyon');
  await app.timeZoneSelect().selectOption('America/Phoenix', { timeout: 15_000 });
  await app.setUploader('Acceptance uploader');
  await app.setDescription('Offline acceptance batch');
  const [record] = await app.readFlipRecords();
  expect(record.tags[`SDCARD/${filename}`]).toHaveLength(1);
  expect(record.tags[`SDCARD/${filename}`][0]).toMatchObject({ scientificName: 'Canis latrans', count: 3 });
  await app.continueToUpload();
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
  const prefixes = publishedUploads(app);
  expect(prefixes).toHaveLength(1);
  const prefix = prefixes[0];
  const media = writtenCsvRows(app, `${prefix}media.csv`);
  const observations = writtenCsvRows(app, `${prefix}observations.csv`);
  expect(media).toHaveLength(1);
  expect(observations).toHaveLength(1);
  expect(media[0][6]).toBe(filename);
  expect(Date.parse(media[0][4])).toBe(Date.parse('2026-07-01T12:00:00-07:00'));
  expect(observations[0][3]).toBe(media[0][0]);
  expect(observations[0][4]).toBe(media[0][4]);
  expect(observations[0][8]).toBe('Canis latrans');
  expect(observations[0][9]).toBe('3');
  expect(observations[0][16]).toBe(person);
  await expect.poll(async () => (await app.readFlipRecords()).length).toBe(0);
  // A publication success must not be offered again as an unfinished upload.
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].completedAt).toEqual(expect.any(String));
  expect(batches[0].preparationId).toEqual(expect.any(String));
  await expect.poll(() => page.evaluate(id => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('sparcd-flip');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('preparations', 'readonly');
      const read = tx.objectStore('preparations').get(id);
      tx.oncomplete = () => { db.close(); resolve(read.result === undefined); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), batches[0].preparationId as string)).toBe(true);
  await context.setOffline(true);
  await page.goto('/sparcd-exploration/tagger/');
  await expect(page.getByRole('heading', { name: 'Connect to use standalone Tagger' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Offline tagging is available only for a batch prepared in Uploader.');
  await expect(page.getByRole('link', { name: 'Open Uploader', exact: true })).toBeVisible();
  await expect(page.goto('/sparcd-exploration/admin/')).rejects.toThrow();
}
