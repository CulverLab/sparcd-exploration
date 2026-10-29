import { S3_ORIGIN } from './app';
import type { App, FileSpec } from './app';
import { Given, When, Then, expect } from './fixtures';
import { BUCKET_A, UUID_A, SETTINGS_BUCKET } from './fixtures-data';
import { APP_PATH } from './app';
const scopedKey = `Collections/${UUID_A}/species.json`;
const scoped = JSON.stringify([{ name: 'Alpha Coyote', scientificName: 'Canis latrans', speciesIconURL: '', keyBinding: 'Y' }]);

Given('Alpha has a collection-specific species list', async ({ app }) => {
  app.s3.put(BUCKET_A, scopedKey, scoped, { contentType: 'application/json' });
});

Then('the optional tagging feature uses the saved master species', async ({ app }) => {
  const panel=app.page.getByTestId('species-panel');
  await expect(panel.getByText('Coyote',{exact:true})).toBeVisible();
  await expect(panel.getByText('Ghost',{exact:true})).toBeVisible();
  await expect(panel.getByText('Alpha Coyote',{exact:true})).toHaveCount(0);
  const [record]=await app.readFlipRecords();
  expect(record.preparedSpecies.collectionKey).toBe('Settings/species.json');
  expect(record.preparedSpecies.sourceKey).toBe('Settings/species.json');
  expect(JSON.stringify(record.preparedSpecies)).not.toContain('test-secret-key');
});

When('the live shared account changes during local tagging', async ({ app }) => {
  // Real shared login via a sibling page; no protocol messages or app records are forged.
  const sibling = await app.page.context().newPage();
  try {
    await app.s3.install(sibling, S3_ORIGIN);
    await sibling.goto('/sparcd-exploration/uploader/');
    // A sibling inherits the shared session; end it before connecting another account.
    await sibling.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(sibling.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await sibling.fill('#endpoint', S3_ORIGIN);
    await sibling.fill('#accessKey', 'other-person');
    await sibling.fill('#secretKey', 'other-secret');
    await sibling.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(sibling.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    await expect.poll(() => app.page.evaluate(() => JSON.parse(sessionStorage.getItem('sparcd-connection-tab') || '{}').accessKey)).toBe('other-person');
  } finally { await sibling.close(); }
});

Given('master refresh will fail with {string}', async ({ app }, failure: string) => {
  await app.waitForSpeciesCache(); app.notes.originalMaster=await app.cachedSpecies(); app.notes.masterFailure=failure;
  if(failure==='denied') app.s3.unreadableKeys.add(`${SETTINGS_BUCKET}/Settings/species.json`);
  else app.s3.put(SETTINGS_BUCKET,'Settings/species.json',failure==='malformed'?'{bad JSON':'[]',{contentType:'application/json'});
});
When('master refresh is attempted', async ({ app }) => {
  const response=app.page.waitForResponse(response=>response.url().includes(`${SETTINGS_BUCKET}/Settings/species.json`)&&response.request().method()===(app.notes.masterFailure==='denied'?'HEAD':'GET'));
  await app.page.context().setOffline(true);
  await expect.poll(()=>app.page.evaluate(()=>navigator.onLine)).toBe(false);
  await app.page.context().setOffline(false);await response;
});
Then('the last valid catalog preserves Inspect and optional tagging',async({app})=>{
  expect(await app.cachedSpecies()).toMatchObject({sourceHash:app.notes.originalMaster.sourceHash,species:app.notes.originalMaster.species,ownerScope:app.notes.originalMaster.ownerScope});
  await expect(app.page.getByRole('button',{name:'Tag species before upload',exact:true})).toBeEnabled();
  await expect(app.continueButton()).toBeEnabled();expect(await app.listedFiles()).toHaveLength(4);
});

When('the assigned species list is {string}', async ({ app }, change: string) => {
  const rows = [{ name: 'Ghost', scientificName: 'Casper', speciesIconURL: '', keyBinding: 'G' }];
  if (change === 'renamed') rows.push({ name: 'Updated Coyote', scientificName: 'Canis latrans', speciesIconURL: '', keyBinding: 'C' });
  app.s3.put(BUCKET_A, scopedKey, JSON.stringify(rows), { contentType: 'application/json' });
});

Then('Describe handles the species check for {string}', async ({ app }, change: string) => {
  await app.continueToAssign();
  await app.waitForCollections();
  if (change === 'removed') {
    const popup=app.page.getByRole('alertdialog',{name:'Resolve species before uploading'});
    await expect(popup).toContainText('Canis latrans');
    await popup.getByRole('button',{name:'OK',exact:true}).click();
  }
  await app.setUploader('Anita');
  await app.chooseDeployment('Bear Canyon');
  await app.fillRequiredUploadComments();
  const review = app.page.getByRole('region', { name: 'Species review' });
  if(change==='renamed') {
    await expect(review).toContainText('Species checked against the current official list.');
    await expect(app.continueButton()).toBeEnabled();
  } else {
    await expect(review).toContainText('Canis latrans');
    await expect(app.continueButton()).toBeDisabled();
  }
  await app.page.getByRole('button', { name: 'Back', exact: true }).click();
  expect((await app.listedFiles()).find((file) => file.name === 'IMG_0002.JPG')?.species).toBe('Coyote×1');
});

When('the handoff preparation becomes {string}', async ({ app }, problem: string) => {
  await expect.poll(async () => (await app.readFlipRecords())[0]?.tags['SDCARD/IMG_0002.JPG']?.[0]?.scientificName).toBe('Canis latrans');
  const [record] = await app.readFlipRecords();
  await app.patchFlipRecord(record.id, { preparedSpecies: problem === 'missing' ? undefined : { ...record.preparedSpecies, v: 99 } });
  await app.page.reload();
});
Then('the Tagger explains preparation recovery and preserves the batch', async ({ app }) => {
  await expect(app.page.getByRole('alert')).toContainText('Your inspected files and existing tags are unchanged');
  await expect(app.page.getByRole('link', { name: 'Back to Uploader', exact: true })).toBeVisible();
  await expect(app.page.getByTestId('species-panel')).toHaveCount(0);
  const [record] = await app.readFlipRecords();
  expect(record.files).toHaveLength(4);
  expect(record.tags['SDCARD/IMG_0002.JPG'][0].scientificName).toBe('Canis latrans');
});

async function prepareTaggedBatchWithOriginalProblem(app: App, problem: 'unavailable' | 'changed', targetNames = ['IMG_0001.JPG']): Promise<void> {
  await app.stubTagger();
  await app.page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  const id = new URL(app.page.url()).searchParams.get('batch')!;
  const tags = {
    'SDCARD/IMG_0001.JPG': [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: '', freeTags: '' }],
    'SDCARD/IMG_0002.JPG': [{ scientificName: 'Casper', commonName: 'Ghost', count: 1, requestedSpecies: '', freeTags: '' }],
  };
  await app.finishFlipRecord(id, tags, 'Anita');
  await app.page.goto(`${APP_PATH}?flip=${id}`);
  app.notes.originalRemovalSpecs = app.lastSpecs;
  const available: FileSpec[] = app.lastSpecs.filter(file => !targetNames.some(name => file.path.endsWith(name)));
  if (problem === 'changed') {
    const original = app.lastSpecs.find(file => file.path.endsWith(targetNames[0]))!;
    const bytes = Buffer.from(original.bytes!);
    bytes[0] ^= 0xff;
    available.push({ ...original, bytes });
  }
  await app.seedPickedFolder(available);
  await app.page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await expect(app.page.getByRole('region', { name: 'Original files need recovery' })).toContainText('IMG_0001.JPG');
  await app.fileListToggle().click();
  const record = (await app.readFlipRecords()).find(item => item.id === id)!;
  app.notes.originalRemovalFlipRevision = record.revision;
  app.notes.originalRemovalFlipPaths = record.files.map((file: any) => file.relPath);
  app.notes.remoteObjectKeysBeforeRemoval = [...app.s3.objects.keys()].sort();
  app.notes.missingRemovalFlipId = id;
}

Given('a tagged batch returns with IMG_0001.JPG unavailable', async ({ app }) => prepareTaggedBatchWithOriginalProblem(app, 'unavailable'));
Given('a tagged batch returns with IMG_0001.JPG changed', async ({ app }) => prepareTaggedBatchWithOriginalProblem(app, 'changed'));
Given('a tagged batch returns with IMG_0001.JPG and IMG_0002.JPG unavailable', async ({ app }) => prepareTaggedBatchWithOriginalProblem(app, 'unavailable', ['IMG_0001.JPG', 'IMG_0002.JPG']));

When('the missing original is removed by {string}', async ({ app }, action: string) => {
  const remove = app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true });
  await expect(remove).toHaveAccessibleDescription(/recovered batch and saved Tagger handoff/);
  if (action === 'mouse') await remove.click();
  else {
    const list = app.page.getByLabel('Scanned files. Enter previews, J and K move, D removes the active file.');
    await list.focus();
    await list.press('d');
  }
  await expect(remove).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0002.JPG', exact: true })).toBeFocused();
});

When('the missing original is removed by touch at a narrow viewport', async ({ app }) => {
  await app.page.setViewportSize({ width: 390, height: 780 });
  const remove = app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true });
  await remove.tap();
  await expect(remove).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0002.JPG', exact: true })).toBeFocused();
});

When('the remove control is activated with the keyboard', async ({ app }) => {
  const remove = app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true });
  await expect(remove).toHaveAccessibleDescription(/recovered batch and saved Tagger handoff/);
  await remove.focus();
  await remove.press('Enter');
  await expect(remove).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0002.JPG', exact: true })).toBeFocused();
});

When('the file list is filtered to only the unavailable original', async ({ app }) => {
  await app.page.getByRole('button', { name: /need attention/ }).click();
  await expect(app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true })).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0002.JPG', exact: true })).toHaveCount(0);
});

When('the last filtered original IMG_0002.JPG is removed', async ({ app }) => {
  await app.page.getByRole('button', { name: /need attention/ }).click();
  const remove = app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0002.JPG', exact: true });
  await expect(remove).toHaveAccessibleDescription(/recovered batch and saved Tagger handoff/);
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0001.JPG', exact: true })).toBeFocused();
});

When('that last displayed original is removed', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true }).click();
  await expect(app.page.getByRole('heading', { name: 'Original files need recovery', exact: true })).toBeFocused();
});

When('the Flip update fails once during removal', async ({ app }) => {
  await app.page.evaluate(() => {
    const prototype = IDBObjectStore.prototype;
    const originalPut = prototype.put;
    let failOnce = true;
    Object.defineProperty(prototype, 'put', {
      configurable: true,
      value: function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (failOnce && this.name === 'records') {
          failOnce = false;
          throw new DOMException('Simulated storage failure', 'QuotaExceededError');
        }
        return originalPut.apply(this, args);
      },
    });
  });
  await app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true }).click();
});

Then('the pending removal stays hidden and blocks navigation until retry succeeds', async ({ app }) => {
  await expect(app.page.getByText(/Could not finish removing IMG_0001\.JPG/)).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true })).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Edit tags', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0002.JPG', exact: true })).toBeFocused();
  await app.page.getByRole('button', { name: 'Retry removal', exact: true }).click();
  await expect(app.page.getByText('Removed file from the saved preparation and Tagger handoff.', { exact: true })).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});

Then('the pending removal remains hidden and navigation is blocked', async ({ app }) => {
  await expect(app.page.getByText(/Could not finish removing IMG_0001\.JPG/)).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Remove unavailable or changed original IMG_0001.JPG', exact: true })).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Edit tags', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Preview IMG_0002.JPG', exact: true })).toBeFocused();
});

When('the browser reloads while the removal is pending', async ({ app }) => {
  await app.page.reload();
  await expect(app.page.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible();
  const available = app.lastSpecs.filter(file => !file.path.endsWith('IMG_0001.JPG'));
  await app.seedPickedFolder(available);
  await app.page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
});

Then('the file and its saved identification are removed from both journals', async ({ app }) => {
  const id = app.notes.missingRemovalFlipId as string;
  await expect.poll(async () => (await app.readFlipRecords()).find(record => record.id === id)?.files.length).toBe(3);
  const record = (await app.readFlipRecords()).find(item => item.id === id)!;
  expect(record.files.map((file: any) => file.relPath)).not.toContain('SDCARD/IMG_0001.JPG');
  expect(record.files.map((file: any) => file.relPath)).toEqual((app.notes.originalRemovalFlipPaths as string[]).filter(path => path !== 'SDCARD/IMG_0001.JPG'));
  expect(record.tags).not.toHaveProperty('SDCARD/IMG_0001.JPG');
  expect(record.tags['SDCARD/IMG_0002.JPG']?.[0]?.scientificName).toBe('Casper');
  expect(record.revision).toBeGreaterThan(app.notes.originalRemovalFlipRevision as number);
  const prepared = await app.page.evaluate(async (flipId) => {
    const request = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction('preparations', 'readonly');
    const rows: any[] = await new Promise(resolve => { const read = tx.objectStore('preparations').getAll(); read.onsuccess = () => resolve(read.result); });
    await new Promise<void>(resolve => { tx.oncomplete = () => { db.close(); resolve(); }; });
    return rows.find(row => row.value?.flipId === flipId)?.value;
  }, id);
  expect(prepared.files.map((file: any) => file.relPath)).not.toContain('SDCARD/IMG_0001.JPG');
  // Removal only changes the browser's draft records. The selected local
  // source fixture and remote storage remain untouched.
  expect((app.notes.originalRemovalSpecs as typeof app.lastSpecs).some(file => file.path.endsWith('IMG_0001.JPG'))).toBe(true);
  expect(app.s3.puts).toHaveLength(0);
  expect([...app.s3.objects.keys()].sort()).toEqual(app.notes.remoteObjectKeysBeforeRemoval);
});

Then('the file stays absent after recovery reload and Edit tags return', async ({ app }) => {
  const id = app.notes.missingRemovalFlipId as string;
  const available = app.lastSpecs.filter(file => !file.path.endsWith('IMG_0001.JPG'));
  await app.page.reload();
  await app.seedPickedFolder(available);
  await app.page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
  expect((await app.listedFiles()).map(file => file.name)).not.toContain('IMG_0001.JPG');
  await app.page.getByRole('button', { name: 'Edit tags', exact: true }).click();
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  await app.page.goto(`${APP_PATH}?flip=${id}`);
  await app.seedPickedFolder(available);
  await app.page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
  expect((await app.listedFiles()).map(file => file.name)).not.toContain('IMG_0001.JPG');
  expect((await app.readFlipRecords()).find(record => record.id === id)!.files.map((file: any) => file.relPath)).not.toContain('SDCARD/IMG_0001.JPG');
});

When('the storage login is disconnected and deferred', async ({ app }) => {
  await app.unstubTagger();
  await app.page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(app.connectForm()).toBeVisible();
  await app.page.getByRole('button', { name: 'Login later', exact: true }).click();
  await expect(app.page.getByRole('heading', { name: 'Choose the folder again' })).toBeVisible();
  await app.seedPickedFolder(app.lastSpecs);
  await app.page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
  await expect(app.page.getByRole('button', { name: 'Edit tags', exact: true })).toBeEnabled();
});

Then("Edit tags remains available with the batch's prepared species", async ({ app }) => {
  const id = app.notes.flipId as string;
  await app.page.getByRole('button', { name: 'Edit tags', exact: true }).click();
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  const params = new URL(app.page.url()).searchParams;
  expect(params.get('batch')).toBe(id);
  expect(params.get('ownerScope')).toMatch(/^flip-owner-v1:[a-f0-9]{64}$/);
  const species = app.page.getByTestId('species-panel');
  await expect(species.getByText('Coyote', { exact: true })).toBeVisible();
  await expect(species.getByText('Ghost', { exact: true })).toBeVisible();
});

When('the saved preparation recovery list is opened', async ({ app }) => {
  await app.page.goto(APP_PATH);
  await expect(app.page.getByRole('region', { name: 'Saved local preparation' })).toBeVisible();
});

Then('the Reopen saved tags link carries the batch owner scope', async ({ app }) => {
  const record = (await app.readFlipRecords()).find(item => item.id === app.notes.flipId);
  expect(record?.ownerScope).toMatch(/^flip-owner-v1:[a-f0-9]{64}$/);
  const link = app.page.getByRole('link', { name: 'Reopen saved tags using thumbnails', exact: true });
  await expect(link).toBeVisible();
  const target = new URL(await link.getAttribute('href')!, app.page.url());
  expect(target.searchParams.get('batch')).toBe(app.notes.flipId);
  expect(target.searchParams.get('ownerScope')).toBe(record!.ownerScope);
  await link.click();
  await app.page.waitForURL(/\/tagger\/\?batch=/);
  expect(new URL(app.page.url()).searchParams.get('ownerScope')).toBe(record!.ownerScope);
});
