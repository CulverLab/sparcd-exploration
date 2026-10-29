import { waitForOfflineApps } from './offline-readiness';
import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test('an interrupted coordinated update preserves the active offline release and pending Inspect work', async ({ page, context }) => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const workerFile = new URL('../../dist/offline-worker.js', import.meta.url);
  const original = await readFile(workerFile, 'utf8');
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3);
  await app.connect();
  await waitForOfflineApps(page);
  await app.dropFolder([jpegAt('PENDING.JPG', '2026:07:01 12:00:00')]);
  await app.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  const names = await page.evaluate(() => caches.keys());
  const firstLine = original.slice(0, original.indexOf('\n'));
  const release = JSON.parse(firstLine.slice('const RELEASE = '.length, -1));
  release.version += '-failed-update';
  release.assets.push({ url: '/sparcd-exploration/tagger/assets/intentionally-unavailable.js', hash: '0'.repeat(64) });
  try {
    await writeFile(workerFile, `const RELEASE = ${JSON.stringify(release)};\n${original.slice(original.indexOf('\n') + 1)}`);
    await context.setOffline(true); await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'could not finish downloading' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(names);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
    await waitForOfflineApps(page);
    // A complete new release stages without taking over this pending client.
    await context.setOffline(false);
    const nextRelease = { ...release, version: release.version + '-complete', assets: release.assets.slice(0, -1) };
    await writeFile(workerFile, `const RELEASE = ${JSON.stringify(nextRelease)};\n${original.slice(original.indexOf('\n') + 1)}`);
    await context.setOffline(true); await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'An Uploader update is ready.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
    // Any family-scope document holds the old worker, even outside the two apps.
    const other = await context.newPage();
    await other.goto('/sparcd-exploration/__offline-harness/probe.html');
    expect(await other.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'An Uploader update is ready.' })).toBeVisible();
    await page.close();
    expect(await other.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/sparcd-exploration/'))?.waiting)).toBe(true);
    await other.close();
    const reopened = await context.newPage();
    await reopened.goto('/sparcd-exploration/uploader/');
    await reopened.getByRole('button', { name: 'Login later', exact: true }).click();
    await expect(reopened.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
    await expect.poll(() => reopened.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sparcd-exploration/');
      if (!registration?.active) return '';
      return new Promise<string>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data.version); }; registration.active!.postMessage({ type: 'STATUS' }, [channel.port2]); });
    })).toBe(nextRelease.version);
    await context.setOffline(true);
    await reopened.reload();
    await reopened.getByRole('button', { name: 'Login later', exact: true }).click();
    await expect(reopened.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
  } finally { await writeFile(workerFile, original); }
});

test('an unprepared browser cannot open its first-ever Uploader visit offline', async ({ page, context }) => {
  await context.setOffline(true);
  await expect(page.goto('/sparcd-exploration/uploader/')).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  await context.setOffline(false);
  await page.goto('/sparcd-exploration/uploader/');
  await page.getByRole('button', { name: 'Login later', exact: true }).click();
  await waitForOfflineApps(page);
  await expect(page.getByRole('region', { name: 'Offline preparation' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Prepare species for local tagging' })).toHaveCount(0);
});

test('journal quota failure blocks handoff without losing Inspect and exposes a working retry', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  await app.waitForSpeciesCache();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restoreQuotaFault = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'preparations') throw new DOMException('Test storage quota exhausted', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await app.dropFolder([jpegAt('QUOTA.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  await expect(page.getByRole('alert').filter({ hasText: 'Local preparation could not be saved.' })).toBeVisible();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await app.expectStep('Verify');
  await expect(page.getByRole('alertdialog')).toContainText('Keep this tab open');
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK', exact: true }).click();
  expect(await app.readFlipRecords()).toEqual([]);
  await page.evaluate(() => (window as any).__restoreQuotaFault());
  await page.getByRole('button', { name: 'Retry saving preparation' }).click();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await expect(page.locator('button[title="QUOTA.JPG"]')).toBeVisible();
  expect((await app.readFlipRecords())[0].files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('reopening detects an evicted app asset and online preparation repairs its pinned bytes', async ({ page, context }) => {
  await page.goto('/sparcd-exploration/uploader/');
  await page.getByRole('button', { name: 'Login later', exact: true }).click();
  await waitForOfflineApps(page);
  const removed = await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('sparcd-apps-'))!;
    const cache = await caches.open(name);
    const font = (await cache.keys()).find(request => request.url.endsWith('.ttf'))!;
    return cache.delete(font);
  });
  expect(removed).toBe(true);
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'Login later', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'not fully available offline' })).toBeVisible();
  await context.setOffline(false);
  await waitForOfflineApps(page);
});
