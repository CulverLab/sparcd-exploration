import { tagAndReturn } from './tagging-helpers';
import { test, expect } from '@playwright/test';
import { App, APP_PATH } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, SETTINGS_BUCKET, BUCKET_A, UUID_A } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
import { waitForOfflineApps } from './offline-readiness';

const original = jpegAt('OFFLINE.JPG', '2026:07:01 12:00:00');

for (const login of ['Login Later', 'credentials']) test(`${login} selects and inspects offline; missing catalog and Describe are explained only when chosen`, async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  await app.open(); await waitForOfflineApps(page);
  await context.setOffline(true); s3.offline = true;
  await page.reload();
  if (login === 'Login Later') await page.getByRole('button', { name: 'Login later', exact: true }).click();
  else { await app.fillConnection(); await page.getByRole('button', { name: 'Connect', exact: true }).click(); }
  await expect(page.getByRole('region', { name: 'Offline preparation' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Prepare species for local tagging' })).toHaveCount(0);
  await app.dropFolder([original]); await app.waitForInspected();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  const popup = page.getByRole('alertdialog', { name: 'Tagging species' });
  await expect(popup).toContainText('The species list is not available on this device');
  await popup.getByRole('button', { name: 'OK', exact: true }).click();
  await app.continueButton().click();
  const describeNotice=page.getByRole('alertdialog',{name:'Connect before Describe'});
  await expect(describeNotice).toContainText('Connect online before Describe');
  await describeNotice.getByRole('button', { name: 'OK', exact: true }).click();
  await app.expectStep('Verify');
  expect(await app.readFlipRecords()).toEqual([]);
});

test('automatic master cache supports offline optional tagging, while a failed refresh and changed official list preserve the batch', async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  s3.put(BUCKET_A, `Collections/${UUID_A}/species.json`, JSON.stringify([{name:'Collection only',scientificName:'Different species'}]), { contentType: 'application/json' });
  await app.connect(); await app.waitForSpeciesCache(); await waitForOfflineApps(page);
  const cached = await app.cachedSpecies();
  expect(cached.sourceKey).toBe('Settings/species.json');
  expect(JSON.stringify(cached)).not.toContain('test-secret-key');
  await app.dropFolder([original]); await app.waitForInspected();
  await context.setOffline(true); s3.offline = true;
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  const [record] = await app.readFlipRecords();
  expect(record.preparedSpecies).toEqual(cached);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#user').fill('Offline identifier');
  await page.getByRole('button', { name: 'Tag', exact: true }).click();
  await page.locator('button[title="OFFLINE.JPG"]').click();
  await page.getByTestId('species-panel').locator('div.group').filter({ hasText: 'Canis latrans' }).locator('button[title^="Apply"]').click();
  await page.getByRole('button', { name: 'Done · back to Uploader' }).click();
  await page.waitForURL(/\/uploader\/\?flip=/);
  await app.seedPickedFolder([original]); await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await app.waitForInspected();
  const lastValid = await app.cachedSpecies();
  s3.unreadableKeys.add(`${SETTINGS_BUCKET}/Settings/species.json`);
  s3.offline = false; await context.setOffline(false);
  await app.continueToAssign(); await app.waitForCollections();
  const warning = page.getByRole('alertdialog', { name: 'Resolve species before uploading' });
  await expect(warning).toContainText('Canis latrans');
  await warning.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(app.continueButton()).toBeDisabled();
  expect((await app.readFlipRecords())[0].preparedSpecies).toEqual(cached);
  expect((await app.readFlipRecords())[0].tags['SDCARD/OFFLINE.JPG'][0]).toMatchObject({ scientificName: 'Canis latrans', count: 1 });
  expect(await app.cachedSpecies()).toMatchObject({sourceHash:lastValid.sourceHash,species:lastValid.species,ownerScope:lastValid.ownerScope});
  expect(s3.puts).toHaveLength(0);
});

test('a species removed after Describe blocks the real upload before any writes, then allows retry after resolution', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3); const app = new App(page, s3);
  await app.connect(); await app.waitForSpeciesCache();
  await app.dropFolder([original]); await app.waitForInspected();
  await tagAndReturn(app);
  await app.walkToUploadStep({ description: 'Fresh species validation' });
  await (await app.dryRunCheckbox()).uncheck();
  const before = (await app.readFlipRecords())[0];
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify([{ name:'Ghost', scientificName:'Casper' }]), { contentType: 'application/json' });
  await app.startRun();
  const warning = page.getByRole('alertdialog', { name: 'Resolve species before uploading' });
  await expect(warning).toContainText('Canis latrans');
  await warning.getByRole('button', { name:'OK', exact:true }).click();
  expect((await app.readFlipRecords())[0].tags).toEqual(before.tags);
  expect(await app.readBatchRecords()).toEqual([]);
  expect(s3.puts).toHaveLength(0);
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify([{ name:'Coyote', scientificName:'Canis latrans' }]), { contentType: 'application/json' });
  await app.startRun(); await app.waitForRunPhase('done');
});

for (const change of ['dry-run mode', 'Back navigation']) test(`a slow species check cannot start an upload after ${change}`, async ({page})=>{
  const s3=new S3Mock();seedDefaultStorage(s3);const app=new App(page,s3);
  await app.connect();await app.waitForSpeciesCache();
  await app.dropFolder([original]);await app.waitForInspected();await tagAndReturn(app);
  await app.walkToUploadStep({description:'Slow species check'});
  await (await app.dryRunCheckbox()).uncheck();
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const pending=new Promise<void>(resolve=>{entered=resolve});
  await page.route(/\/Settings\/species\.json(?:\?|$)/,async route=>{
    if(route.request().method()==='GET'){entered();await gate;}
    await route.fallback();
  });
  try {
    await app.startRun();await pending;
    if(change==='dry-run mode') await (await app.dryRunCheckbox()).check();
    else {await page.getByRole('button',{name:'Back',exact:true}).click();await app.expectStep('Describe');}
    release();
    if(change==='dry-run mode') await expect(page.getByRole('button',{name:'Start dry run',exact:true})).toBeEnabled();
    await expect(page.getByRole('status',{name:'Upload status: ready',exact:true})).toBeVisible();
    expect(await app.readBatchRecords()).toEqual([]);expect(s3.puts).toHaveLength(0);
  } finally {release();}
});
