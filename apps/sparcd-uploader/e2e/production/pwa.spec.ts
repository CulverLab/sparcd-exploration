import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { App, S3_ORIGIN } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, COLLECTION_A_NAME } from '../../features/steps/fixtures-data';
import { verifyRecoveredUpload } from './acceptance-helpers';
import { jpegAt } from '../../features/steps/batches';

test.use({ trace: 'off' });
test('installed Uploader launches as an app offline after a Chrome process restart', async ({ baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), 'sparcd-installed-pwa-'));
  const manifestId = `${baseURL}/sparcd-exploration/uploader/`;
  let context: BrowserContext | undefined;
  let installed = false;
  let trace = '';
  let passed = false;
  const traces: string[] = [];
  async function launch(offline: boolean, name: string) {
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, baseURL, offline });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    trace = info.outputPath(`${name}.zip`);
    return context.newPage();
  }
  async function close() {
    if (!context) return;
    await context.tracing.stop({ path: trace }); traces.push(trace);
    await context.close(); context = undefined;
  }
  try {
    const page = await launch(false, 'pwa-install');
    const s3 = new S3Mock(); seedDefaultStorage(s3);
    const warm = new App(page, s3); await warm.connect();
    const species = page.getByRole('region', { name: 'Prepare species for local tagging' });
    await species.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
    await species.getByRole('option').filter({ hasText: COLLECTION_A_NAME }).click();
    await species.getByRole('button', { name: 'Prepare species', exact: true }).click();
    await expect(species.getByRole('status')).toContainText('Species prepared for');
    await page.getByRole('button', { name: 'Prepare apps for offline use' }).click();
    await expect(page.getByRole('region', { name: 'Offline preparation' })).toContainText('Ready for offline Inspect and local tagging.');
    const protocol = await context!.newCDPSession(page);
    const manifest = await protocol.send('Page.getAppManifest');
    expect(JSON.parse(manifest.data!).display).toBe('standalone');
    await protocol.send('PWA.install' as any, { manifestId, installUrlOrBundleUrl: manifestId });
    installed = true;
    // CDP installation uses a browser display preference; exercise the real
    // user preference for an app window rather than emulating display mode.
    await protocol.send('PWA.changeAppUserSettings' as any, { manifestId, displayMode: 'standalone' });
    await close();
    const control = await launch(true, 'pwa-offline-launch');
    const cdp = await context!.newCDPSession(control);
    const next = context!.waitForEvent('page');
    await cdp.send('PWA.launch' as any, { manifestId });
    let app = await next;
    const remote: string[] = [];
    app.on('request', r => { if (r.url().startsWith(S3_ORIGIN)) remote.push(r.url()); });
    await expect(app).toHaveURL(manifestId);
    await expect(app.getByRole('button', { name: 'Login later', exact: true })).toBeVisible();
    expect(await app.evaluate(() => navigator.onLine)).toBe(false);
    expect(await app.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
    await app.getByRole('button', { name: 'Login later', exact: true }).click();
    await expect(app.getByRole('region', { name: 'Offline preparation' })).toContainText('Ready for offline Inspect and local tagging.');
    let local = new App(app, s3);
    await local.open(); // installs only the synthetic OS picker, never app data/assets
    await app.getByRole('button', { name: 'Login later', exact: true }).click();
    const specs = [jpegAt('PWA.JPG', '2026:07:01 12:00:00')];
    await local.dropFolder(specs); await local.waitForInspected();
    await app.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
    await expect(app.locator('button[title="PWA.JPG"]')).toBeVisible();
    expect(await app.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
    await app.getByRole('button', { name: 'Settings', exact: true }).click();
    await app.locator('#user').fill('pwa-person');
    await app.getByRole('button', { name: 'Tag', exact: true }).click();
    await app.locator('button[title="PWA.JPG"]').click();
    await app.locator('div.group').filter({ hasText: 'Canis latrans' }).first().locator('button[title^="Apply"]').click();
    await expect.poll(async () => (await local.readFlipRecords())[0]?.tags?.['SDCARD/PWA.JPG']?.[0]?.scientificName).toBe('Canis latrans');
    await app.getByRole('spinbutton', { name: 'Count for Coyote', exact: true }).fill('3');
    await expect.poll(async () => (await local.readFlipRecords())[0]?.tags?.['SDCARD/PWA.JPG']?.[0]?.count).toBe(3);
    const batchUrl = app.url();
    await close();
    const restartedControl = await launch(true, 'pwa-local-tagger-restart');
    const restartedProtocol = await context!.newCDPSession(restartedControl);
    const launched = context!.waitForEvent('page');
    await restartedProtocol.send('PWA.launch' as any, { manifestId, url: batchUrl });
    app = await launched;
    app.on('request', r => { if (r.url().startsWith(S3_ORIGIN)) remote.push(r.url()); });
    local = new App(app, s3);
    await local.open({ path: batchUrl });
    await expect(app.locator('button[title="PWA.JPG"]')).toContainText('Coyote');
    await app.locator('button[title="PWA.JPG"]').click();
    await expect(app.getByRole('spinbutton', { name: 'Count for Coyote', exact: true })).toHaveValue('3');
    // Return stays available after restart; tags retain their original attribution.
    await expect(app.getByRole('button', { name: 'Done · back to Uploader' })).toBeEnabled();
    await app.getByRole('button', { name: 'Settings', exact: true }).click();
    await app.locator('#user').fill('pwa-person');
    await app.getByRole('button', { name: 'Tag', exact: true }).click();
    expect(await app.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
    await app.getByRole('button', { name: 'Done · back to Uploader' }).click();
    await app.waitForURL(/\/uploader\/\?flip=/);
    const later = app.getByRole('button', { name: 'Login later', exact: true });
    if (await later.isVisible()) await later.click();
    await local.seedPickedFolder(specs);
    await app.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await local.waitForInspected();
    expect((await local.readFlipRecords())[0]?.tags?.['SDCARD/PWA.JPG']?.[0]?.scientificName).toBe('Canis latrans');
    expect(await app.evaluate(async () => { try { await fetch('/__offline-harness/probe.html?installed=1'); return false; } catch { return true; } })).toBe(true);
    expect(remote).toEqual([]);
    await verifyRecoveredUpload(local, context!, 'PWA.JPG', 'pwa-person');
    passed = true;
  } finally {
    if (installed && context) {
      const page = context.pages()[0] ?? await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('PWA.uninstall' as any, { manifestId });
    }
    await close();
    for (const path of traces) { if (passed) await rm(path, { force: true }); else await info.attach('Installed app lifecycle', { path, contentType: 'application/zip' }); }
    await rm(profile, { recursive: true, force: true });
  }
});
