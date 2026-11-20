import { test, expect } from '@playwright/test';
import { waitForOfflineApps } from './offline-readiness';

test('offline registration, navigation and app launch URLs follow the Pages root', async ({ page, context, baseURL }) => {
  const root = process.env.PAGES_ROOT ?? '/sparcd-exploration/';
  const uploader = `${baseURL}${root}uploader/`;
  await page.goto(uploader);
  await page.getByRole('button', { name: 'Login later', exact: true }).click();
  await waitForOfflineApps(page, root);
  expect(await page.evaluate(async base => {
    const registration = await navigator.serviceWorker.getRegistration(base);
    return { scope: registration?.scope, script: registration?.active?.scriptURL };
  }, root)).toEqual({ scope: `${baseURL}${root}`, script: `${baseURL}${root}offline-worker.js` });

  const protocol = await context.newCDPSession(page);
  const manifest = await protocol.send('Page.getAppManifest');
  const data = JSON.parse(manifest.data!);
  expect(new URL(data.start_url, manifest.url).href).toBe(uploader);
  // Omit id so it defaults to start_url, preserving the existing install ID.
  // Explicit relative IDs resolve against the origin, not the manifest URL.
  expect(data.id).toBeUndefined();
  expect(new URL(data.scope, manifest.url).href).toBe(`${baseURL}${root}`);
  const release = await (await page.request.get(`${root}uploader/offline-release.json`)).json();
  expect(release.assets.length).toBeGreaterThan(0);
  expect(release.assets.every((asset: { url: string }) => asset.url.startsWith(root))).toBe(true);
  if (root !== '/sparcd-exploration/') {
    expect((await page.request.get('/sparcd-exploration/offline-worker.js')).status()).toBe(404);
  }

  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(new URL(data.start_url, manifest.url).href);
  await expect(reopened.getByRole('button', { name: 'Login later', exact: true })).toBeVisible();
  await reopened.goto(`${uploader}?return=local-id`);
  await expect(reopened.getByRole('button', { name: 'Login later', exact: true })).toBeVisible();
  await reopened.goto(`${uploader}index.html?return=local-id`);
  await expect(reopened.getByRole('button', { name: 'Login later', exact: true })).toBeVisible();
  for (const suffix of ['', 'index.html?return=local-id']) {
    await reopened.goto(`${root}tagger/${suffix}`);
    await expect(reopened.getByRole('heading', { name: 'Connect to use standalone Tagger' })).toBeVisible();
  }
  expect(await reopened.evaluate(() => navigator.onLine)).toBe(false);
});
