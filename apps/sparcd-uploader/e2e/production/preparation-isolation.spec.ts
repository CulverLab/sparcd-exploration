import { test, expect } from '@playwright/test';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage, BUCKET_B, UUID_B } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';
async function prepare(app: App, name: string) {
  const region = app.page.getByRole('region', { name: 'Prepare species for local tagging' });
  await region.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await region.getByRole('option').filter({ hasText: name }).click();
  await region.getByRole('button', { name: 'Prepare species', exact: true }).click();
  await expect(region.getByRole('status')).toContainText(`Species prepared for ${name}`);
}
for (const drop of ['before', 'after'] as const) test(`parallel batch handoff keeps its vocabulary when files arrive ${drop} sibling preparation`, async ({ page, context }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  s3.put(BUCKET_B, `Collections/${UUID_B}/species.json`, JSON.stringify([{ name: 'Beta only', scientificName: 'Beta species', speciesIconURL: '', keyBinding: 'B' }]), { contentType: 'application/json' });
  const a = new App(page, s3); await a.connect(); await prepare(a, 'Alpha Collection');
  if (drop === 'before') { await a.dropFolder([jpegAt('ALPHA.JPG', '2026:07:01 12:00:00')]); await a.waitForInspected(); }
  const sibling = await context.newPage(); const b = new App(sibling, s3); await b.open();
  await expect(sibling.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
  await prepare(b, 'Beta Collection');
  if (drop === 'after') { await a.dropFolder([jpegAt('ALPHA.JPG', '2026:07:01 12:00:00')]); await a.waitForInspected(); }
  await b.dropFolder([jpegAt('BETA.JPG', '2026:07:01 12:00:00')]); await b.waitForInspected();
  await expect(sibling.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  const [record] = await a.readFlipRecords();
  expect(record.files[0].fileName).toBe('ALPHA.JPG');
  expect(record.preparedSpecies.collectionName).toBe('Alpha Collection');
  // Both windows retain independently recoverable batches after a real reload.
  await sibling.reload();
  const recovery = sibling.getByRole('region', { name: 'Saved local preparation' });
  await expect(recovery.getByRole('combobox', { name: 'Saved batch' })).toBeVisible();
  await expect(recovery.getByRole('option')).toHaveCount(2);
  await expect(recovery.getByRole('option').filter({ hasText: 'ALPHA.JPG' })).toHaveCount(1);
  await expect(recovery.getByRole('option').filter({ hasText: 'BETA.JPG' })).toHaveCount(1);
});
test('selecting another preparation collection before dropping files must not strand the controls', async ({ page }) => {
  const s3 = new S3Mock(); seedDefaultStorage(s3);
  const app = new App(page, s3); await app.connect(); await prepare(app, 'Alpha Collection');
  const region = page.getByRole('region', { name: 'Prepare species for local tagging' });
  await region.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
  await region.getByRole('option').filter({ hasText: 'Beta Collection' }).click();
  await app.dropFolder([jpegAt('NEW.JPG', '2026:07:01 12:00:00')]); await app.waitForInspected();
  await expect(page.getByRole('button', { name: 'Tag species before upload', exact: true })).toBeEnabled();
  await expect(region.getByRole('status')).toContainText('Species prepared for Alpha Collection');
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  expect((await app.readFlipRecords())[0].preparedSpecies.collectionName).toBe('Alpha Collection');
});
