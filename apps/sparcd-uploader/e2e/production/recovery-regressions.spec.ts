import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, BUCKET_B, UUID_B } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
async function prepare(app: App, _name: string) { await app.waitForSpeciesCache(); }

for (const legacy of [true, false]) test(`recovery preserves a ${legacy ? 'legacy collection' : 'master'} snapshot after the shared master cache changes`, async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await app.waitForSpeciesCache();
  const original = await app.cachedSpecies();
  const specs = [jpegAt('ALPHA.JPG','2026:07:01 12:00:00')];
  await app.dropFolder(specs); await app.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.',{exact:true})).toBeVisible();
  // Model an already-saved legacy batch; recovery itself uses real journal and file verification.
  const expected = legacy ? {...original, collectionKey:`${BUCKET_B}::${UUID_B}`, collectionName:'Legacy collection',sourceKey:`Collections/${UUID_B}/species.json`} : original;
  await page.evaluate(async species => {
    const open=indexedDB.open('sparcd-flip');const db:IDBDatabase=await new Promise(resolve=>{open.onsuccess=()=>resolve(open.result)});
    const tx=db.transaction('preparations','readwrite'), table=tx.objectStore('preparations');
    const request=table.getAll();request.onsuccess=()=>{for(const row of request.result){row.value.species=species;table.put(row)}};
    await new Promise<void>(resolve=>{tx.oncomplete=()=>{db.close();resolve()}});
  },expected);
  s3.put('sparcd-settings-test','Settings/species.json',JSON.stringify([{name:'Later master',scientificName:'Later species'}]),{contentType:'application/json'});
  await page.close();
  const reopened=await context.newPage();const recovered=new App(reopened,s3);await recovered.open();
  await reopened.getByRole('button',{name:'Login later',exact:true}).click();
  await recovered.seedPickedFolder(specs);await reopened.getByRole('button',{name:'Reselect saved batch folder',exact:true}).click();await recovered.waitForInspected();
  await reopened.getByRole('button',{name:'Tag species before upload',exact:true}).click();await reopened.waitForURL(/\/tagger\/\?batch=/);
  expect((await recovered.readFlipRecords())[0].preparedSpecies).toEqual(expected);
});

test('a Disconnect while the Flip folder picker is open cannot restore that batch', async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const a = new App(page, s3); await a.connect(); await prepare(a, 'Alpha Collection');
  const specs = [jpegAt('OLD.JPG', '2026:07:01 12:00:00')];
  await a.dropFolder(specs); await a.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  const record = (await a.readFlipRecords())[0];
  await page.goto(record.returnUrl);
  await expect(page.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible();
  await a.seedPickedFolder(specs);
  const sibling = await context.newPage(); const b = new App(sibling, s3); await b.open();
  await expect(sibling.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).showDirectoryPicker = () => new Promise(resolve => { (window as any).__finishReviewPicker = () => resolve((window as any).__pickedFolder); });
  });
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).__finishReviewPicker === 'function');
  await b.disconnectFromHeader();
  await expect(a.connectForm()).toBeVisible();
  await page.evaluate(() => (window as any).__finishReviewPicker());
  // Allow hashing to finish while disconnected; UI state must remain discarded.
  await page.waitForTimeout(1500);
  await a.connect();
  await expect(a.activeStep()).toContainText('Choose');
  await expect(page.getByRole('button', { name: 'Tag species before upload', exact: true })).toHaveCount(0);
});

test('a damaged sibling journal does not hide a healthy saved batch', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await prepare(app, 'Alpha Collection');
  await app.dropFolder([jpegAt('HEALTHY.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('sparcd-flip');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('preparations', 'readwrite');
        tx.objectStore('preparations').put({ id: 'unrelated-future-record', value: { v: 99 } });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      }; request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  const recovery = page.getByRole('region', { name: 'Saved local preparation' });
  await expect(recovery.getByRole('alert')).toContainText('1 saved batch is damaged or from an unsupported version');
  await expect(recovery.getByRole('button', { name: 'Reselect saved batch folder' })).toBeVisible();
  await app.seedPickedFolder([jpegAt('HEALTHY.JPG', '2026:07:01 12:00:00')]);
  await recovery.getByRole('button', { name: 'Reselect saved batch folder' }).click();
  await app.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  const record = (await app.readFlipRecords())[0];
  await page.goto(record.returnUrl);
  // The recovered journal now correctly retains its handle. This fixture's
  // synthetic handle cannot retain prototype methods through IndexedDB cloning;
  // explicitly take the offered permission/reselection fallback. Real handles
  // and original-media playback are covered in greptile-recovery.spec.ts.
  await page.getByRole('button', { name: 'Reselect folder instead', exact: true }).click();
  await app.seedPickedFolder([jpegAt('HEALTHY.JPG', '2026:07:01 12:00:00')]);
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
});
