import type { App } from '../../features/steps/app';

export async function tagAndReturn(app: App) {
  const page=app.page;
  await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
  await page.waitForURL(/\/tagger\/\?batch=/);
  await page.locator('button[title="OFFLINE.JPG"]').click();
  await page.getByTestId('species-panel').locator('div.group').filter({ hasText: 'Canis latrans' }).locator('button[title^="Apply"]').click();
  await page.getByRole('button', { name: 'Done · back to Uploader' }).click();
  await page.waitForURL(/\/uploader\/\?flip=/);
  await app.seedPickedFolder(app.lastSpecs); await page.getByRole('button', { name: 'Choose folder', exact: true }).click(); await app.waitForInspected();
}
