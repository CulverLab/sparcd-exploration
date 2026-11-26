import { expect, test } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test('processing updates preserve the saved context and announce availability only once', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  await page.evaluate(() => {
    const w = window as any;
    w.statusHeld = {};
    w.__holdInspectResult = (_id: string, name: string) => name === 'first.JPG'
      ? Promise.resolve() : new Promise<void>(resolve => { w.statusHeld[name] = resolve; });
  });
  await app.dropFolder(['first', 'second', 'third'].map(name => jpegAt(`SD/${name}.JPG`, '2026:07:01 12:00:00')));
  const root = page.getByTestId('preparation-save-status');
  const context = page.getByTestId('preparation-save-context');
  const progress = page.getByTestId('preparation-save-progress');
  await expect(context).toContainText('Local preparation saved.');
  await expect(progress).toHaveText('All changes saved.');
  await app.walkToUploadStep({ description: 'Processing status regression' });
  await expect(progress).toHaveText('All changes saved.');
  await page.evaluate(() => {
    const w = window as any;
    w.statusContext = document.querySelector('[data-testid="preparation-save-context"]');
    w.statusMutations = [];
    const observer = new MutationObserver(records => w.statusMutations.push(...records.map(r => r.type)));
    observer.observe(w.statusContext, { childList: true, characterData: true, subtree: true });
    observer.observe(document.querySelector('[data-testid="preparation-save-status"] [role="status"]')!, { childList: true, characterData: true, subtree: true });
    w.statusProgress = [];
    const progress = document.querySelector('[data-testid="preparation-save-progress"]')!;
    new MutationObserver(() => w.statusProgress.push(progress.textContent))
      .observe(progress, { childList: true, characterData: true, subtree: true });
  });
  for (const name of ['second.JPG', 'third.JPG']) {
    await expect.poll(() => page.evaluate(name => typeof (window as any).statusHeld[name], name)).toBe('function');
    await page.evaluate(name => (window as any).statusHeld[name](), name);
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="preparation-save-context"]') === (window as any).statusContext)).toBe(true);
  }
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('sparcd-flip');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('preparations', 'readonly');
      const read = tx.objectStore('preparations').getAll();
      read.onsuccess = () => resolve(read.result.some(row => row.value.files.length === 3 && row.value.files.every((file: any) => file.processState === 'ready')));
      tx.oncomplete = () => db.close();
    };
  }))).toBe(true);
  await expect(progress).toHaveText('All changes saved.');
  expect(await page.evaluate(() => (window as any).statusMutations)).toEqual([]);
  expect(await page.evaluate(() => (window as any).statusProgress)).toContain('Saving latest changes…');
  await expect(root.getByRole('status')).toHaveText('A recoverable preparation is available in this browser.');
  const left = (await context.boundingBox())!, right = (await progress.boundingBox())!;
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 360, height: 780 });
  const mobileLeft = (await context.boundingBox())!, mobileRight = (await progress.boundingBox())!;
  expect(mobileRight.y).toBeGreaterThanOrEqual(mobileLeft.y + mobileLeft.height);
  expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('failed first saves and failed updates have truthful messages and working retry', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).statusFailWrites = true;
    IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'preparations' && (window as any).statusFailWrites) throw new DOMException('Test storage full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await app.dropFolder([jpegAt('SD/first.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  const context = page.getByTestId('preparation-save-context');
  const progress = page.getByTestId('preparation-save-progress');
  await expect(progress).toContainText('Local preparation could not be saved.');
  await expect(context).toContainText('Original files remain');
  await expect(context).not.toContainText('Local preparation saved.');
  await page.evaluate(() => { (window as any).statusFailWrites = false; });
  await page.getByRole('button', { name: 'Retry saving preparation' }).click();
  await expect(progress).toHaveText('All changes saved.');
  await expect(context).toContainText('Local preparation saved.');
  await app.continueToAssign();
  await page.evaluate(() => { (window as any).statusFailWrites = true; });
  await app.setDescription('Changed notes');
  await expect(progress).toContainText('Latest changes could not be saved.');
  await expect(context).toContainText('Local preparation saved.');
  await expect(progress).toHaveAttribute('role', 'alert');
  await page.evaluate(() => { (window as any).statusFailWrites = false; });
  await page.getByRole('button', { name: 'Retry saving preparation' }).click();
  await expect(progress).toHaveText('All changes saved.');
  await expect(page.getByRole('button', { name: 'Retry saving preparation' })).toHaveCount(0);
});
