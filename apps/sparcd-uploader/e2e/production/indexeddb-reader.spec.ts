import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';

for (const outcome of ['success', 'missing store', 'request error', 'transaction abort'] as const) {
  test(`ledger reader releases its IndexedDB connection after ${outcome}`, async ({ page }) => {
    // No application-owned Dexie connections: deletion isolates this helper's
    // connection ownership and fails immediately if it leaves one open.
    await page.goto('/__offline-harness/probe.html');
    await page.evaluate(async outcome => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('sparcd-uploader', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('batches', { keyPath: 'id' }).put({ id: 'saved-batch' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { request.result.close(); resolve(); };
      });
      const original = IDBObjectStore.prototype.getAll;
      if (outcome === 'request error') IDBObjectStore.prototype.getAll = function () {
        throw new DOMException('Injected read failure', 'InvalidStateError');
      };
      if (outcome === 'transaction abort') IDBObjectStore.prototype.getAll = function (...args: Parameters<IDBObjectStore['getAll']>) {
        const request = original.apply(this, args);
        this.transaction.abort();
        return request;
      };
    }, outcome);
    const app = new App(page, new S3Mock());
    if (outcome === 'missing store') expect(await app.readFileRecords()).toEqual([]);
    else if (outcome === 'success') expect(await app.readBatchRecords()).toEqual([{ id: 'saved-batch' }]);
    else await expect(app.readBatchRecords()).rejects.toThrow();
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('sparcd-uploader');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Ledger reader left an IndexedDB connection open'));
    }));
  });
}
