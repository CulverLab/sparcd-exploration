import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, BUCKET_A, UUID_A } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
import { tagAndReturn } from './tagging-helpers';
import { waitForOfflineApps } from './offline-readiness';

const original = jpegAt('OFFLINE.JPG', '2026:07:01 12:00:00');
const officialKey = `Collections/${UUID_A}/species.json`;
const allowed = JSON.stringify([{ name: 'Coyote', scientificName: 'Canis latrans' }]);
const removed = JSON.stringify([{ name: 'Ghost', scientificName: 'Casper' }]);

test('tagged dry runs remain available offline without official-list requests or writes', async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  await app.connect(); await app.waitForSpeciesCache();
  await app.dropFolder([original]); await app.waitForInspected(); await tagAndReturn(app);
  await app.walkToUploadStep({ description: 'Offline tagged preview' });
  await (await app.dryRunCheckbox()).check();
  s3.offline = true; await context.setOffline(true);
  const reads = s3.gets.filter(key => key.endsWith('species.json')).length;
  await app.startRun(); await app.waitForRunPhase('done');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(s3.gets.filter(key => key.endsWith('species.json')).length).toBe(reads);
  expect(s3.puts).toHaveLength(0); expect(await app.readBatchRecords()).toEqual([]);
});

for (const path of ['Retry', 'History', 'automatic reconnect']) test(`${path} validates the saved upload's official list before resuming tagged publication`, async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  s3.put(BUCKET_A, officialKey, allowed, { contentType: 'application/json' });
  await app.connect(); await app.waitForSpeciesCache();
  await app.dropFolder([original]); await app.waitForInspected();
  await waitForOfflineApps(page);
  s3.offline = true; await context.setOffline(true); await tagAndReturn(app);
  s3.offline = false; await context.setOffline(false);
  await app.walkToUploadStep({ description: 'Saved tagged upload' });
  await (await app.dryRunCheckbox()).uncheck();
  if (path === 'automatic reconnect') {
    s3.gatePut = (_bucket, key) => key.endsWith('/UploadMeta.json');
    await app.startRun();
    await expect.poll(() => s3.gated.find(key => key.endsWith('/UploadMeta.json'))).toBeTruthy();
    const key = s3.gated.find(key => key.endsWith('/UploadMeta.json'))!;
    s3.offline = true; s3.releaseGatedPut(key); s3.gatePut = undefined;
    await app.waitForRunPhase('partial', 120_000);
    await context.setOffline(true);
  } else {
    s3.putHooks.push((_bucket, key) => key.endsWith('OFFLINE.JPG') ? { status: 400, code: 'InvalidRequest', message: 'test refusal' } : undefined);
    await app.startRun(); await app.waitForRunPhase('partial'); s3.putHooks.length = 0;
  }
  const tags = (await app.readFlipRecords())[0].tags;
  const bundles = await app.readBundleRecords();
  const writes = s3.puts.length;
  // Master still allows Coyote: validation must use this saved collection's rules.
  s3.put(BUCKET_A, officialKey, removed, { contentType: 'application/json' });
  const reads = s3.gets.filter(key => key.endsWith(officialKey)).length;
  if (path === 'Retry') await page.getByRole('button', { name: 'Retry failed files', exact: true }).click();
  else {
    await app.gotoSection('History');
    if (path === 'History') {
      await app.seedPickedFolder([original]);
      await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    } else { s3.offline = false; await context.setOffline(false); }
  }
  const popup = page.getByRole('alertdialog', { name: 'Resolve species before uploading' });
  await expect(popup).toContainText('Canis latrans');
  await popup.getByRole('button', { name: 'OK', exact: true }).click();
  expect(s3.gets.filter(key => key.endsWith(officialKey)).length).toBeGreaterThan(reads);
  expect(s3.puts.length).toBe(writes);
  expect((await app.readFlipRecords())[0].tags).toEqual(tags);
  expect(await app.readBundleRecords()).toEqual(bundles);
  expect((await app.readBatchRecords())[0].completedAt).toBeFalsy();
  if (path === 'Retry') {
    // A repeated blocked attempt must reopen the warning and remain retryable.
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await expect(popup).toContainText('Canis latrans');
    await popup.getByRole('button', { name: 'OK', exact: true }).click();
    expect(s3.puts.length).toBe(writes);
    s3.put(BUCKET_A, officialKey, allowed, { contentType: 'application/json' });
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await app.waitForRunPhase('done');
  }
});

for (const response of ['valid', 'removed', 'unavailable'] as const) test(`cancelling a resume during species validation ignores a late ${response} response`, async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  s3.put(BUCKET_A, officialKey, allowed, { contentType: 'application/json' });
  await app.connect(); await app.waitForSpeciesCache();
  await app.dropFolder([original]); await app.waitForInspected(); await tagAndReturn(app);
  await app.walkToUploadStep({ description: 'Cancel species validation' });
  await (await app.dryRunCheckbox()).uncheck();
  s3.putHooks.push((_bucket, key) => key.endsWith('OFFLINE.JPG') ? { status: 400, code: 'InvalidRequest', message: 'test refusal' } : undefined);
  await app.startRun(); await app.waitForRunPhase('partial'); s3.putHooks.length = 0;
  const bundles = await app.readBundleRecords();
  const tags = (await app.readFlipRecords())[0].tags;
  const writes = s3.puts.length;
  let release!: () => void, entered!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const replied = new Promise<void>(resolve => { finished = resolve; });
  await page.route(/Collections\/.*\/species\.json/, async route => {
    entered(); await gate;
    if (response === 'unavailable') await route.fulfill({ status: 403, body: '<Error><Code>AccessDenied</Code></Error>' });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: response === 'valid' ? allowed : removed });
    finished();
  });
  try {
    await page.getByRole('button', { name: 'Retry failed files', exact: true }).click(); await pending;
    await app.waitForRunPhase('preparing');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    // The response is still held: cancellation must release the run now.
    await app.waitForRunPhase('error');
    await expect(page.getByRole('button', { name: 'Resume upload', exact: true })).toBeEnabled();
    release(); await replied;
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(s3.puts.length).toBe(writes);
    expect(await app.readBundleRecords()).toEqual(bundles);
    expect((await app.readFlipRecords())[0].tags).toEqual(tags);
    expect((await app.readBatchRecords())[0].completedAt).toBeFalsy();
    await page.unroute(/Collections\/.*\/species\.json/);
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await app.waitForRunPhase('done');
  } finally { release(); }
});
