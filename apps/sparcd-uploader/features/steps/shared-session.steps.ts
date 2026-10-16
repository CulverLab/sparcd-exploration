import { fileURLToPath } from 'node:url';
import type { Page, Request } from '@playwright/test';
import { Given, When, Then, expect } from './fixtures';
import { APP_PATH, S3_ORIGIN, ACCESS_KEY, SECRET_KEY } from './app';
import { COLLECTION_A_NAME } from './fixtures-data';

const DENIED = 'https://denied.sparcd.test';
const SESSION_MODULE = fileURLToPath(new URL('../../../../packages/auth-ui/src/session.ts', import.meta.url));

type WireSession = { protocol: number; revision: { counter: number; id: string }; connected: boolean;
  type: string; config: { endpoint: string; accessKey: string; secretKey: string; region: string; forcePathStyle: boolean } };
type SessionCase = { old: WireSession; requests: string[]; correctedAt: number; sibling: Page };

async function switchTool(page: Page, tool: 'Uploader' | 'Tagger'): Promise<void> {
  await page.getByRole('button', { name: /^SPARC.d · / }).click();
  await page.getByRole('menuitem', { name: tool, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sparcd-exploration/${tool.toLowerCase()}/$`));
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
}

Given('the Uploader connection was corrected after a refused endpoint with Remember {string}', async ({ app }, remember: string) => {
  const requests: string[] = [];
  app.page.on('request', (request: Request) => {
    if (request.headers()['authorization']?.startsWith('AWS4-HMAC')) requests.push(request.url());
  });
  // The barrier is a separate ordered message, not a timing delay or an app
  // callback. Receiving it proves earlier stale replies reached this document.
  await app.page.addInitScript(() => {
    const channel = new BroadcastChannel('sparcd-connection-live');
    (window as any).__sessionBarriers = {};
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'test-barrier') (window as any).__sessionBarriers[event.data.id] = true;
    });
  });
  await app.open();
  await app.page.route(`${DENIED}/**`, (route) => route.fulfill({
    status: 403, contentType: 'application/xml',
    body: '<Error><Code>AccessDenied</Code><Message>Access denied</Message></Error>',
  }));
  await app.connect({ endpoint: DENIED, accessKey: 'OLD_ACCOUNT', secretKey: 'old-session-secret' });
  const old = await app.page.evaluate(() => ({
    ...JSON.parse(localStorage.getItem('sparcd-connection-revision')!), type: 'connect',
    config: JSON.parse(sessionStorage.getItem('sparcd-connection-tab')!),
  }));
  const refusal = app.page.waitForResponse((r) => r.url().startsWith(DENIED) && r.status() === 403);
  await app.gotoSection('History');
  await refusal;
  const sibling = await app.page.context().newPage();
  await sibling.route('**/stale-session-sibling', (route) => route.fulfill({
    contentType: 'text/html', body: '<title>Delayed sibling replies</title>',
  }));
  await sibling.goto(`${new URL(app.page.url()).origin}/stale-session-sibling`);
  await app.disconnectFromHeader();
  await app.fillConnection({ endpoint: S3_ORIGIN, accessKey: ACCESS_KEY, secretKey: SECRET_KEY });
  await app.page.getByLabel('Remember endpoint & access key on this device').setChecked(remember === 'checked');
  const correctedAt = requests.length;
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await app.gotoSection('History');
  await expect(app.page.getByRole('option', { name: COLLECTION_A_NAME, exact: true })).toBeAttached();
  app.notes.sessionCase = { old, requests, correctedAt, sibling } satisfies SessionCase;
  // Retain a stale non-secret prefill independently of the established session.
  if (remember === 'checked') await app.page.evaluate((endpoint) => {
    const stored = JSON.parse(localStorage.getItem('sparcd-connection')!);
    localStorage.setItem('sparcd-connection', JSON.stringify({ ...stored, endpoint }));
  }, DENIED);
  else expect(await app.page.evaluate(() => localStorage.getItem('sparcd-connection'))).toBeNull();
});

When('Tagger is opened using the app switcher', async ({ app }) => {
  await switchTool(app.page, 'Tagger');
});

Then('Tagger reads collections only from the corrected connection', async ({ app }) => {
  await expect(app.page.getByRole('button').filter({ hasText: COLLECTION_A_NAME }).first()).toBeVisible();
  const info = await app.page.evaluate(async ({ url, expectedSecret }) => {
    const session = await import(/* @vite-ignore */ url);
    const cfg = session.getLiveConnection();
    const stored = JSON.parse(sessionStorage.getItem('sparcd-connection-tab')!);
    return { endpoint: cfg?.endpoint, accessKey: cfg?.accessKey, region: cfg?.region,
      secretMatches: cfg?.secretKey === expectedSecret, storedEndpoint: stored?.endpoint };
  }, { url: `/sparcd-exploration/tagger/@fs${SESSION_MODULE}`, expectedSecret: SECRET_KEY });
  expect(info).toEqual({ endpoint: S3_ORIGIN, accessKey: ACCESS_KEY, region: 'us-east-1',
    secretMatches: true, storedEndpoint: S3_ORIGIN });
  const state = app.notes.sessionCase as SessionCase;
  const later = state.requests.slice(state.correctedAt);
  expect(later.some((url) => new URL(url).origin === S3_ORIGIN)).toBe(true);
  expect(later.filter((url) => url.startsWith(DENIED))).toEqual([]);
});

When('the tools are switched and reloaded again', async ({ app }) => {
  await app.page.reload();
  await switchTool(app.page, 'Uploader');
  await app.page.reload();
  await switchTool(app.page, 'Tagger');
});

async function replay(page: Page, state: SessionCase, id: string): Promise<void> {
  await state.sibling.evaluate(({ old, id }) => {
    const channel = new BroadcastChannel('sparcd-connection-live');
    channel.postMessage(old);
    // Legacy clients cannot attach a trustworthy revision; ignore those too.
    channel.postMessage({ type: 'connect', config: old.config });
    channel.postMessage({ type: 'test-barrier', id });
    channel.close();
  }, { old: state.old, id });
  await expect.poll(() => page.evaluate((key) => !!(window as any).__sessionBarriers[key], id)).toBe(true);
}

When('a stale sibling sends its old session replies', async ({ app }) => {
  await replay(app.page, app.notes.sessionCase as SessionCase, 'after-correction');
});

When('Tagger logs out before another stale reply arrives', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await replay(app.page, app.notes.sessionCase as SessionCase, 'after-logout');
});

Then('the tools remain logged out after reload', async ({ app }) => {
  await expect(app.page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await app.page.reload();
  await expect(app.page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect(await app.page.evaluate(() => sessionStorage.getItem('sparcd-connection-tab'))).toBeNull();
  await app.page.goto(APP_PATH);
  await expect(app.page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  const state = app.notes.sessionCase as SessionCase;
  expect(state.requests.slice(state.correctedAt).filter((url) => url.startsWith(DENIED))).toEqual([]);
});
