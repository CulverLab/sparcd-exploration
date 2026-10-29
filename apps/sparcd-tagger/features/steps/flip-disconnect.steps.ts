import { deriveFlipOwnerScope } from '@sparcd/flip';
import { Given, When, Then, expect, APP_URL, ENDPOINT, gridCell, openAppConnected, openSettings } from './support/world';

const OWNER_KEY = 'testkey';
const OWNER_SECRET = 'testsecret';
const recordBase = (id: string, ownerScope?: string) => ({
  id, v: ownerScope ? 2 : 1, createdAt: new Date().toISOString(), returnUrl: '/sparcd-exploration/uploader/',
  ...(ownerScope ? {
    ownerScope,
    preparedSpecies: {
      v: 2, endpoint: ENDPOINT, ownerScope, collectionKey: 'bucket::collection', collectionName: 'Test collection',
      sourceBucket: 'bucket', sourceKey: 'Collections/collection/species.json', sourceHash: 'a'.repeat(64),
      preparedAt: new Date().toISOString(), profileId: 'bdd-profile', overrides: {},
      species: [{ key: 'Canis latrans', scientificName: 'Canis latrans', commonName: 'Coyote', iconUrl: '', keyBinding: null }],
    },
  } : {}),
  files: [{ relPath: 'SD/IMG.jpg', fileName: 'IMG.jpg', size: 1, sha256: 'a', mediaKind: 'image' }],
  tags: ownerScope ? { 'SD/IMG.jpg': [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: '', freeTags: '' }] } : {},
});
async function ownerScope(accessKey = OWNER_KEY): Promise<string> {
  return deriveFlipOwnerScope({ endpoint: ENDPOINT, region: 'us-east-1', accessKey, secure: false });
}
async function seedRecords(page: import('@playwright/test').Page, rows: ReturnType<typeof recordBase>[]) {
  await page.evaluate(async (records) => {
    const request = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('records', 'readwrite');
      for (const row of records) tx.objectStore('records').put(row);
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, rows);
}
async function readRows(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    const rows = await new Promise<any[]>((resolve) => {
      const request = db.transaction('records', 'readonly').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return rows;
  });
}
async function mutateAndAdd(page: import('@playwright/test').Page, changedId: string, added: ReturnType<typeof recordBase>) {
  await page.evaluate(async ({ changedId, added }) => {
    const request = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      const get = store.get(changedId);
      get.onsuccess = () => store.put({ ...get.result, tags: { changed: [] }, revision: (get.result.revision ?? 0) + 1 });
      store.put(added);
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, { changedId, added });
}

Given('owner-scoped local handoffs exist for the connected and other logins', async ({ page }) => {
  await openAppConnected(page);
  const own = await ownerScope();
  const foreign = await ownerScope('other-login');
  await seedRecords(page, [recordBase('616-owned', own), recordBase('616-foreign', foreign), recordBase('616-legacy')]);
});

When('Disconnect is requested from Settings', async ({ page, scratch }) => {
  scratch.disconnectRowsBefore = await readRows(page);
  await openSettings(page);
  await page.locator('main').getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Disconnect from Tagger?' })).toBeVisible();
});

Then('the prompt counts only this login handoffs and defaults to keeping them', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Disconnect from Tagger?' });
  await expect(dialog).toContainText('You have 1 local handoff');
  await expect(dialog).toContainText('Discarding removes these local batches and their unsynced tagging work');
  await expect(dialog.getByRole('button', { name: 'Disconnect and keep local work' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Discard local work and disconnect' })).toBeVisible();
});

When('the header Logout action is used', async ({ page, scratch }) => {
  scratch.disconnectRowsBefore = await readRows(page);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Disconnect from Tagger?' })).toBeVisible();
});

When('the Disconnect prompt is cancelled with Escape', async ({ page }) => {
  await page.keyboard.press('Escape');
});

When('the Disconnect prompt is cancelled with its Cancel button', async ({ page }) => {
  await page.getByRole('dialog', { name: 'Disconnect from Tagger?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
});

Then('the connection and all handoffs remain and focus returns to the opener', async ({ page, scratch }) => {
  await expect(page.getByRole('dialog', { name: 'Disconnect from Tagger?' })).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText(/^(Disconnect|Logout)$/);
  await expect(page.getByRole('button', { name: 'Browse', exact: true }).first()).toBeVisible();
  const rows = await readRows(page);
  expect(rows.map(row => row.id).sort()).toEqual(['616-foreign', '616-legacy', '616-owned']);
  expect(rows).toEqual(scratch.disconnectRowsBefore);
});

When('Disconnect is confirmed while keeping local work', async ({ page }) => {
  await page.getByRole('dialog', { name: 'Disconnect from Tagger?' }).getByRole('button', { name: 'Disconnect and keep local work' }).click();
});

Then('the login disconnects and its local handoff remains recoverable', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect((await readRows(page)).some(row => row.id === '616-owned')).toBe(true);
  await page.locator('#endpoint').fill(ENDPOINT);
  await page.locator('#accessKey').fill(OWNER_KEY);
  await page.locator('#secretKey').fill(OWNER_SECRET);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Browse', exact: true }).first()).toBeVisible();
  await page.goto(`${APP_URL}?batch=616-owned&ownerScope=${await ownerScope()}`);
  await expect(page.getByText(/Local batch · 1 files · from Uploader/)).toBeVisible();
  await expect(gridCell(page, 'IMG.jpg')).toContainText('Coyote');
});

Given('the current login has two local handoffs to review', async ({ page, scratch }) => {
  await openAppConnected(page);
  const own = await ownerScope();
  await seedRecords(page, [recordBase('616-stable', own), recordBase('616-changed', own), recordBase('616-foreign', await ownerScope('other-login')), recordBase('616-legacy')]);
  scratch.disconnectRowsBefore = await readRows(page);
});

When('one handoff changes and another is added after the prompt opens', async ({ page }) => {
  await openSettings(page);
  await page.locator('main').getByRole('button', { name: 'Disconnect', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Disconnect from Tagger?' });
  await expect(dialog).toContainText('You have 2 local handoffs');
  await mutateAndAdd(page, '616-changed', recordBase('616-added-later', await ownerScope()));
  await dialog.getByRole('button', { name: 'Discard local work and disconnect' }).click();
});

Then('only the unchanged reviewed handoff is deleted and the others require another decision', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Disconnect from Tagger?' });
  await expect(dialog).toContainText('2 local handoffs changed or were added after review and were kept');
  const ids = (await readRows(page)).map(row => row.id).sort();
  expect(ids).toEqual(['616-added-later', '616-changed', '616-foreign', '616-legacy']);
  await expect(dialog.getByRole('button', { name: 'Disconnect and keep local work' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Discard local work and disconnect' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Browse', exact: true }).first()).toBeVisible();
});

When('Disconnect is attempted from Settings while Tagger save recovery is pending', async ({ page }) => {
  await openSettings(page);
  const button = page.locator('main').getByRole('button', { name: 'Disconnect', exact: true });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-describedby', 'disconnect-help');
  await expect(page.locator('#disconnect-help')).toContainText('Finish pending saves before disconnecting');
});

Then('the pending save blocks Disconnect without changing local handoffs', async ({ page, scratch }) => {
  await expect(page.getByRole('dialog', { name: 'Disconnect from Tagger?' })).toHaveCount(0);
  expect(await readRows(page)).toEqual(scratch.disconnectRowsBefore);
  await expect(page.getByRole('button', { name: 'Browse', exact: true }).first()).toBeVisible();
});
