import type { App } from '../../features/steps/app';
import type { Page } from '@playwright/test';
import type { PreparedSpecies } from '@sparcd/flip';
import type { LocalPreparation } from '../../src/lib/preparation';

export async function continueWithMasterSpecies(page: Page) {
  const chooser = page.getByRole('dialog', { name: 'Choose a species list' });
  await chooser.getByRole('radio', { name: /Master species list/ }).check();
  await chooser.getByRole('button', { name: 'Continue', exact: true }).click();
}

export async function tagAndReturn(app: App) {
  const page=app.page;
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await continueWithMasterSpecies(page);
  await page.waitForURL(/\/tagger\/\?batch=/);
  await page.locator('button[title="OFFLINE.JPG"]').click();
  await page.getByTestId('species-panel').locator('div.group').filter({ hasText: 'Canis latrans' }).locator('button[title^="Apply"]').click();
  await page.getByRole('button', { name: 'Done · back to Uploader' }).click();
  await page.waitForURL(/\/uploader\/\?flip=/);
  await app.seedPickedFolder(app.lastSpecs); await page.getByRole('button', { name: 'Choose folder', exact: true }).click(); await app.waitForInspected();
}

/** Read the batch journal independently of the shared vocabulary cache. */
export async function savedBatchSpecies(page: Page, fileName: string) {
  return page.evaluate(name => new Promise<PreparedSpecies | null>((resolve, reject) => {
    const open = indexedDB.open('sparcd-flip');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('preparations', 'readonly');
      const read = tx.objectStore('preparations').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(read.result.find((row: { value: LocalPreparation }) => row.value.files?.some(file => file.fileName === name))?.value.species ?? null);
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), fileName);
}
