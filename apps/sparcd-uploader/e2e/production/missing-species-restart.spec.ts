import { waitForOfflineApps } from './offline-readiness';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, COLLECTION_A_NAME } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test.use({ trace: 'off' });
for (const installed of [false, true]) test(`${installed ? 'PWA' : 'browser'} cold offline recovery without prepared species preserves Inspect and supports online repair`, async ({ baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), 'sparcd-missing-species-'));
  const url = `${baseURL}/sparcd-exploration/uploader/`;
  let context: BrowserContext | undefined;
  let trace = '';
  let passed = false;
  let didInstall = false;
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
    let page = await launch(false, 'prepare-assets-only');
    const s3 = new S3Mock(); seedDefaultStorage(s3);
    s3.unreadableKeys.add('sparcd-settings-test/Settings/species.json');
    let app = new App(page, s3); await app.connect();
    await waitForOfflineApps(page);
    const specs = [jpegAt('UNPREPARED.JPG', '2026:07:01 12:00:00')];
    await app.dropFolder(specs); await app.waitForInspected();
    await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
    if (installed) {
      const cdp = await context!.newCDPSession(page);
      await cdp.send('PWA.install' as any, { manifestId: url, installUrlOrBundleUrl: url });
      didInstall = true;
      await cdp.send('PWA.changeAppUserSettings' as any, { manifestId: url, displayMode: 'standalone' });
    }
    await close();
    page = await launch(true, 'recover-without-species');
    if (installed) {
      const cdp = await context!.newCDPSession(page);
      const opened = context!.waitForEvent('page');
      await cdp.send('PWA.launch' as any, { manifestId: url });
      page = await opened;
      expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
    }
    app = new App(page, s3); await app.open();
    await page.getByRole('button', { name: 'Login later', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Saved local preparation' })).toContainText('1 inspected file');
    await app.seedPickedFolder(specs);
    await page.getByRole('button', { name: 'Reselect saved batch folder' }).click();
    await app.waitForInspected();
    const tag = page.getByRole('button', { name: 'Tag species before upload', exact: true });
    await expect(tag).toBeEnabled();
    await tag.click();
    const notice = page.getByRole('alertdialog', { name: 'Tagging species' });
    await expect(notice).toContainText('The species list is not available on this device');
    await notice.getByRole('button', { name: 'OK', exact: true }).click();
    await expect.poll(async () => (await app.listedFiles())[0]?.hasThumbnail).toBe(true);
    const before = await app.listedFiles();
    expect(before).toHaveLength(1);
    expect(await page.evaluate(async () => { try { await fetch('/__offline-harness/probe.html'); return false; } catch { return true; } })).toBe(true);
    s3.unreadableKeys.clear();
    await context!.setOffline(false);
    await app.gotoSection('Settings');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await app.fillConnection();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    await app.gotoSection('New upload');
    await app.waitForSpeciesCache();
    await expect.poll(() => app.listedFiles()).toEqual(before);
    await context!.setOffline(true);
    await tag.click();
    await expect(page.locator('button[title="UNPREPARED.JPG"]')).toBeVisible();
    await expect(page.locator('div.group').filter({ hasText: 'Canis latrans' }).first()).toBeVisible();
    passed = true;
  } finally {
    if (didInstall && context) {
      const cdp = await context.newCDPSession(context.pages()[0] ?? await context.newPage());
      await cdp.send('PWA.uninstall' as any, { manifestId: url });
    }
    await close();
    for (const path of traces) {
      if (passed) await rm(path, { force: true });
      else await info.attach('Missing species lifecycle', { path, contentType: 'application/zip' });
    }
    await rm(profile, { recursive: true, force: true });
  }
});
