import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, SETTINGS_BUCKET } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

test('a sibling master refresh cannot replace an inspected batch catalog or journal', async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const a = new App(page, s3); await a.connect(); await a.waitForSpeciesCache();
  const first = await a.cachedSpecies();
  await a.dropFolder([jpegAt('ALPHA.JPG', '2026:07:01 12:00:00')]); await a.waitForInspected();
  await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  s3.put(SETTINGS_BUCKET, 'Settings/species.json', JSON.stringify([{ name:'New master species', scientificName:'Beta species', keyBinding:'B' }]), { contentType:'application/json' });
  const sibling = await context.newPage(); const b = new App(sibling, s3); await b.open();
  await expect.poll(async () => (await b.cachedSpecies())?.species[0].scientificName).toBe('Beta species');
  await b.dropFolder([jpegAt('BETA.JPG','2026:07:01 12:00:00')]); await b.waitForInspected();
  await page.getByRole('button',{name:'Tag species before upload',exact:true}).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  expect((await a.readFlipRecords())[0].preparedSpecies).toEqual(first);
  await sibling.reload();
  const recovery=sibling.getByRole('region',{name:'Saved local preparation'});
  await expect(recovery.getByRole('combobox',{name:'Saved batch'})).toBeVisible();
  await expect(recovery.getByRole('option').filter({hasText:'ALPHA.JPG'})).toHaveCount(1);
  await expect(recovery.getByRole('option').filter({hasText:'BETA.JPG'})).toHaveCount(1);
});

test('an automatic refresh after file selection keeps that batch snapshot frozen', async ({page,context})=>{
  const s3=new S3Mock();seedDefaultStorage(s3);const app=new App(page,s3);
  await app.connect();await app.waitForSpeciesCache();const first=await app.cachedSpecies();
  await app.dropFolder([jpegAt('FROZEN.JPG','2026:07:01 12:00:00')]);await app.waitForInspected();
  s3.put(SETTINGS_BUCKET,'Settings/species.json',JSON.stringify([{name:'New catalog',scientificName:'New species'}]),{contentType:'application/json'});
  await context.setOffline(true);await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);await context.setOffline(false);
  await expect.poll(async()=>(await app.cachedSpecies())?.species[0].scientificName).toBe('New species');
  await page.getByRole('button',{name:'Tag species before upload',exact:true}).click();await page.waitForURL(/\/tagger\/\?batch=/);
  expect((await app.readFlipRecords())[0].preparedSpecies).toEqual(first);
});
