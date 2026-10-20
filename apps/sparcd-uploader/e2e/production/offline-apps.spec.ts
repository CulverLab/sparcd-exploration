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
  await page.getByRole('button', { name: 'Prepare apps for offline use' }).click();
  const offline = page.getByRole('region', { name: 'Offline preparation' });
  await expect(offline).toContainText('Both apps are stored for offline use.');
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
    await page.getByRole('button', { name: 'Prepare apps for offline use' }).click();
    await expect(offline).toContainText('App preparation failed.');
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(names);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
    await expect(page.getByRole('region', { name: 'Offline preparation' })).toContainText('Both apps are stored for offline use.');
    // A complete new release stages without taking over this pending client.
    await context.setOffline(false);
    const nextRelease = { ...release, version: release.version + '-complete', assets: release.assets.slice(0, -1) };
    await writeFile(workerFile, `const RELEASE = ${JSON.stringify(nextRelease)};\n${original.slice(original.indexOf('\n') + 1)}`);
    await page.getByRole('button', { name: 'Prepare apps for offline use' }).click();
    await expect(page.getByRole('region', { name: 'Offline preparation' })).toContainText('An app update is ready.');
    await expect(page.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
    // Any family-scope document holds the old worker, even outside the two apps.
    const other = await context.newPage();
    await other.goto('/sparcd-exploration/__offline-harness/probe.html');
    expect(await other.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByRole('region', { name: 'Offline preparation' })).toContainText('close all SPARC’d tabs, windows, and installed app windows');
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
  await expect(page.getByRole('region', { name: 'Offline preparation' })).toContainText('Prepare both apps online before reopening this batch offline.');
  await expect(page.getByText('Tagging requires prior online species preparation.', { exact: false })).toBeVisible();
});

test('journal quota failure blocks handoff without losing Inspect and exposes a working retry', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  const species = page.getByRole('region', { name: 'Prepare species for local tagging' });
  await species.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await species.getByRole('option').filter({ hasText: 'Alpha Collection' }).click();
  await species.getByRole('button', { name: 'Prepare species', exact: true }).click();
  await expect(species.getByRole('status')).toContainText('Species prepared for');
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
  await expect(page.getByRole('alert').filter({ hasText: 'Keep this tab open and retry' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Prepare apps for offline use' }).click();
  const offline = page.getByRole('region', { name: 'Offline preparation' });
  await expect(offline).toContainText('Both apps are stored for offline use.');
  const removed = await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('sparcd-apps-'))!;
    const cache = await caches.open(name);
    const font = (await cache.keys()).find(request => request.url.endsWith('.ttf'))!;
    return cache.delete(font);
  });
  expect(removed).toBe(true);
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'Login later', exact: true }).click();
  await expect(offline).toContainText('Offline app files are incomplete.');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Prepare apps for offline use' }).click();
  await expect(offline).toContainText('Both apps are stored for offline use.');
});
