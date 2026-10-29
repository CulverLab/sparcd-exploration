import { S3_ORIGIN } from './app';
import { Given, When, Then, expect } from './fixtures';
import { BUCKET_A, UUID_A, SETTINGS_BUCKET } from './fixtures-data';
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
  expect(await app.cachedSpecies()).toMatchObject({sourceHash:app.notes.originalMaster.sourceHash,species:app.notes.originalMaster.species,account:app.notes.originalMaster.account});
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
