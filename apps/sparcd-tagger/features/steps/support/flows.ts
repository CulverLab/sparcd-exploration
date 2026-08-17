// Higher-level flows several feature files share: making a local edit, driving
// the Sync dialog, and reading local (IndexedDB / localStorage) state back out.

import { expect, type Page } from '@playwright/test';
import { focusFrame, gridCell, speciesApply } from './world';

export async function openSyncDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sync…' }).click();
  await expect(page.getByRole('heading', { name: 'Sync to S3' })).toBeVisible();
  await expect(page.getByText('Checking the canonical base…')).toBeHidden();
}

export const syncDryRunCheckbox = (page: Page) =>
  page.locator('label').filter({ hasText: 'Dry-run — log the writes' }).locator('input[type="checkbox"]');

export const settingsDryRunCheckbox = (page: Page) =>
  page.locator('label').filter({ hasText: 'Dry-run (log writes, change nothing)' }).locator('input[type="checkbox"]');

export const burstCheckbox = (page: Page) =>
  page.locator('label').filter({ hasText: 'Group rapid sequences into bursts' }).locator('input[type="checkbox"]');

export async function setSyncDryRun(page: Page, on: boolean): Promise<void> {
  const cb = syncDryRunCheckbox(page);
  if ((await cb.isChecked()) !== on) await cb.setChecked(on);
}

/** Make one unmistakable local edit: add Coyote to a frame that has no species. */
export async function makeLocalEdit(page: Page, file = 'IMG002.JPG'): Promise<void> {
  await focusFrame(page, file);
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, file)).toContainText('Coyote');
}

export async function runLiveSync(page: Page): Promise<void> {
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
}

export async function closeDialog(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.count()) await close.first().click();
}

/** Wait until `n` dirty drafts have been flushed to IndexedDB (writes are
 *  debounced ~200ms off the keystroke path). */
export async function waitForDirtyDrafts(page: Page, n: number): Promise<void> {
  await expect
    .poll(async () => (await readStore(page, 'drafts')).filter((d) => (d as { dirty: boolean }).dirty).length, {
      timeout: 5000,
    })
    .toBe(n);
}

/** Read every row of a Dexie store straight out of IndexedDB. */
export async function readStore(page: Page, store: string): Promise<unknown[]> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sparcd-tagger');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains(name)) {
      db.close();
      return [];
    }
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(name, 'readonly');
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  }, store);
}

/** Write one row into a Dexie store (used to seed an interrupted sync journal). */
export async function writeStore(page: Page, store: string, row: unknown): Promise<void> {
  await page.evaluate(
    async ({ name, value }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('sparcd-tagger');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { name: store, value: row },
  );
}
