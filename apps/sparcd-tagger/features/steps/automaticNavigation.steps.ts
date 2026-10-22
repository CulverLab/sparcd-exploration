import { When, Then, expect, sectionTab, focusFrame, speciesApply, uploadRow, gridCell, collectionButton } from './support/world';
import { BUCKET, PREFIX_A, COLLECTION_B_NAME } from './support/data';
import { readStore, waitForAutomaticSave } from './support/flows';
const status = (page: import('@playwright/test').Page) => page.getByTestId('automatic-save');
When('an automatic save is held before its observation write', async ({ page, scratch }) => {
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  scratch.saveRelease = release;
  let held = false;
  await page.route('**/*', async route => {
    if (!held && route.request().method() === 'PUT' && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}observations.csv`)) {
      held = true; enter(); await gate;
      if (scratch.failHeldSave) { await route.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code><Message>Denied for navigation regression</Message></Error>' }); return; }
    }
    await route.fallback();
  });
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click(); await entered;
});
Then('image and section navigation remain available while saving', async ({ page }) => {
  await focusFrame(page, 'IMG003.JPG');
  await sectionTab(page, 'Settings').click(); await expect(page.locator('#user')).toBeVisible();
  await sectionTab(page, 'Tag').click(); await expect(gridCell(page, 'IMG003.JPG')).toBeVisible();
  await expect(status(page).getByRole('status')).toHaveText('Saving…');
});
async function unloadIsPrevented(page: import('@playwright/test').Page) {
  return page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
}
Then('pending work registers a browser unload warning and blocks logout', async ({ page }) => {
  expect(await unloadIsPrevented(page)).toBe(true);
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toHaveAccessibleDescription(/pending|saving|save/i);
  await expect(status(page).getByRole('button', { name: 'Undo latest action' })).toBeDisabled();
});
When('the held save is released successfully', async ({ scratch }) => { (scratch.saveRelease as () => void)(); });
Then('all accepted work is saved and the unload warning is no longer needed', async ({ page }) => {
  await waitForAutomaticSave(page); expect(await unloadIsPrevented(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
});
When('another upload is requested', async ({ page }) => { await sectionTab(page, 'Browse').click(); await uploadRow(page, 'fielduser').click(); });
Then('the current upload remains active until saving succeeds', async ({ page }) => {
  await sectionTab(page, 'Tag').click(); await expect(page.getByTestId('tag-workspace')).toHaveAttribute('data-upload-prefix', PREFIX_A);
  await expect(status(page).getByRole('status')).toHaveText('Saving…');
});
Then('the requested upload opens after all writes commit', async ({ page }) => { await expect(gridCell(page, 'FOX001.JPG')).toBeVisible(); });
When('the held save is released with a permission failure', async ({ scratch }) => { scratch.failHeldSave = true; (scratch.saveRelease as () => void)(); });
Then('the failed upload remains active with retained work and Retry', async ({ page }) => {
  await expect(status(page)).toContainText('Save failed'); await sectionTab(page, 'Tag').click();
  await expect(page.getByTestId('tag-workspace')).toHaveAttribute('data-upload-prefix', PREFIX_A);
  await expect(status(page).getByRole('button', { name: 'Retry save' })).toBeEnabled();
  expect((await readStore(page, 'automatic') as { actions: unknown[] }[])[0].actions).toHaveLength(1);
});
When('credentials for a different account are offered as repair', async ({ page }) => {
  await status(page).getByRole('button', { name: 'Repair credentials for this account' }).click();
  const region = page.getByRole('region', { name: 'Repair credentials', exact: true });
  await region.getByLabel('Access key', { exact: true }).fill('different-account'); await region.getByLabel('Secret key', { exact: true }).fill('repaired-secret');
  await region.getByRole('button', { name: 'Connect', exact: true }).click();
});
Then('repair explains that the pending account and destination must be preserved', async ({ page }) => { await expect(page.getByRole('alert')).toContainText('same connected account and destination'); });
When('credentials for the same account are repaired', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Repair credentials', exact: true });
  await region.getByLabel('Access key', { exact: true }).fill('testkey'); await region.getByRole('button', { name: 'Connect', exact: true }).click(); await waitForAutomaticSave(page);
});
Then('the repaired save retains the original actor and active upload', async ({ page, s3 }) => {
  expect(JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).taggerActions[0].user).toBe('testkey');
  await expect(page.getByTestId('tag-workspace')).toHaveAttribute('data-upload-prefix', PREFIX_A);
});
Then("this account's pending upload is listed without a snapshot chooser", async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Save recovery' })).toBeVisible(); await expect(page.locator('main')).toContainText(PREFIX_A);
  await expect(page.getByRole('button', { name: 'Open pending upload' })).toBeEnabled(); await expect(page.getByRole('button', { name: /Snapshots|Restore/ })).toHaveCount(0);
});

When('another collection is requested', async ({ page }) => {
  await sectionTab(page, 'Browse').click(); await collectionButton(page, COLLECTION_B_NAME).click();
});
Then('the requested collection opens in Browse after all writes commit', async ({ page }) => {
  await expect(page.getByRole('heading', { name: `Uploads in ${COLLECTION_B_NAME}`, exact: true })).toBeVisible();
  await expect(sectionTab(page, 'Tag')).toBeDisabled();
});
When('the pending upload is reloaded while canonical reads are denied', async ({ page, s3 }) => {
  s3.failGetsWith(`${PREFIX_A}media.csv`, 0, 403, 'AccessDenied'); await page.reload();
});
Then('credential repair stays available before canonical loading succeeds', async ({ page }) => {
  await expect(status(page).getByRole('button', { name: 'Repair credentials for this account' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeDisabled();
  await expect(status(page).getByRole('button', { name: 'Undo latest action' })).toBeDisabled();
});
When("canonical access and this account's credentials are repaired", async ({ page, s3 }) => {
  s3.getFailures.delete(`${PREFIX_A}media.csv`); s3.getFailureResponses.delete(`${PREFIX_A}media.csv`);
  await status(page).getByRole('button', { name: 'Repair credentials for this account' }).click();
  const region = page.getByRole('region', { name: 'Repair credentials', exact: true });
  await region.getByLabel('Secret key', { exact: true }).fill('renewed-secret');
  await region.getByRole('button', { name: 'Connect', exact: true }).click(); await waitForAutomaticSave(page);
});
