import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { App, S3_ORIGIN } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, COLLECTION_A_NAME } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test.use({ trace: 'off' });
test('prepared production apps and inspected batch survive a real offline Chrome restart and local handoff', async ({ baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), 'sparcd-prepared-app-'));
  let context: BrowserContext | undefined;
  let trace = '';
  const traces: string[] = [];
  let passed = false;
  async function launch(offline: boolean, name: string) {
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, baseURL, offline, viewport: { width: 1440, height: 950 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    trace = info.outputPath(`${name}.zip`);
    return context.newPage();
  }
  async function close() {
    if (!context) return;
    await context.tracing.stop({ path: trace }); traces.push(trace);
    await context.close(); context = undefined;
  }
  const specs = [jpegAt('OFFLINE.JPG', '2026:07:01 12:00:00')];
  try {
    let page = await launch(false, 'online-preparation');
    const s3 = new S3Mock(); seedDefaultStorage(s3);
    let app = new App(page, s3);
    await app.connect();
    const preparation = page.getByRole('region', { name: 'Prepare species for local tagging' });
    await preparation.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
    await preparation.getByRole('option').filter({ hasText: COLLECTION_A_NAME }).click();
    await preparation.getByRole('button', { name: 'Prepare species', exact: true }).click();
    await expect(preparation.getByRole('status')).toContainText('Species prepared for');
    await page.getByRole('button', { name: 'Prepare apps for offline use', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Offline preparation' })).toContainText('Ready for offline Inspect and local tagging.');
    await app.dropFolder(specs);
    await app.waitForInspected();
    await app.continueToAssign();
    await page.locator('#mountainRange').fill('Saved mountain range');
    await page.locator('#dateCollected').fill('2026-07-01');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
    await close();

    page = await launch(true, 'offline-recovery');
    const s3Requests: string[] = [];
    page.on('request', request => { if (request.url().startsWith(S3_ORIGIN)) s3Requests.push(request.url()); });
    app = new App(page, s3);
    await app.open();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.evaluate(async () => { try { await fetch('/__offline-harness/probe.html?offline=1'); return false; } catch { return true; } })).toBe(true);
    await page.getByRole('button', { name: 'Login later', exact: true }).click();
    const recovery = page.getByRole('region', { name: 'Saved local preparation' });
    await expect(recovery).toContainText('1 inspected file');
    await app.seedPickedFolder([jpegAt('OFFLINE.JPG', '2026:07:02 12:00:00')]);
    await recovery.getByRole('button', { name: 'Reselect saved batch folder' }).click();
    await expect(recovery.getByRole('alert')).toContainText('content hash differs');
    await app.seedPickedFolder(specs);
    await recovery.getByRole('button', { name: 'Reselect saved batch folder' }).click();
    await app.waitForInspected();
    await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
    await expect(page.getByText('Local batch · 1 files · from Uploader')).toBeVisible();
    await expect(page.getByText('Showing saved thumbnails.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#user').fill('offline-person');
    await page.getByRole('button', { name: 'Tag', exact: true }).click();
    const image = page.locator('button[title="OFFLINE.JPG"]');
    await image.click();
    await page.locator('div.group').filter({ hasText: 'Canis latrans' }).first().locator('button[title^="Apply"]').click();
    await expect(image).toContainText('Coyote');
    await expect.poll(async () => (await app.readFlipRecords())[0]?.tags?.['SDCARD/OFFLINE.JPG']?.[0]?.scientificName).toBe('Canis latrans');
    const taggingUrl = page.url();
    await close();
    page = await launch(true, 'offline-tagger-restart');
    page.on('request', request => { if (request.url().startsWith(S3_ORIGIN)) s3Requests.push(request.url()); });
    app = new App(page, s3);
    await app.open({ path: taggingUrl });
    await expect(page.locator('button[title="OFFLINE.JPG"]')).toContainText('Coyote');
    // Return stays available after restart; tags retain their original attribution.
    await expect(page.getByRole('button', { name: 'Done · back to Uploader' })).toBeEnabled();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#user').fill('offline-person');
    await page.getByRole('button', { name: 'Tag', exact: true }).click();
    await page.getByRole('button', { name: 'Done · back to Uploader' }).click();
    await page.waitForURL(/\/uploader\/\?flip=/);
    const later = page.getByRole('button', { name: 'Login later', exact: true });
    if (await later.isVisible()) await later.click();
    // Native handles survive recovery now; the synthetic picker handle loses
    // its permission methods on serialization, so explicitly reselect it.
    await page.getByRole('button', { name: 'Reselect folder instead', exact: true }).click();
    await app.seedPickedFolder(specs);
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await app.waitForInspected();
    await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
    const [record] = await app.readFlipRecords();
    expect(record.tags['SDCARD/OFFLINE.JPG'][0].scientificName).toBe('Canis latrans');
    expect(record.preparedSpecies.species.length).toBeGreaterThan(0);
    expect(s3Requests).toEqual([]);
    await app.continueButton().click();
    await expect(app.connectForm()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
    await context!.setOffline(false);
    await app.connect();
    await app.waitForCollections();
    await expect(page.locator('#mountainRange')).toHaveValue('Saved mountain range');
    await expect(page.locator('#dateCollected')).toHaveValue('2026-07-01');
    expect((await app.readFlipRecords())[0]?.tags?.['SDCARD/OFFLINE.JPG']?.[0]?.scientificName).toBe('Canis latrans');
    await context!.setOffline(true);
    await page.goto('/sparcd-exploration/tagger/');
    await expect(page.getByRole('heading', { name: 'Connect to use standalone Tagger' })).toBeVisible();
    await expect(page.goto('/sparcd-exploration/admin/')).rejects.toThrow();
    passed = true;
  } finally {
    await close();
    for (const path of traces) { if (passed) await rm(path, { force: true }); else await info.attach('Chrome lifecycle trace', { path, contentType: 'application/zip' }); }
    await rm(profile, { recursive: true, force: true });
  }
});
