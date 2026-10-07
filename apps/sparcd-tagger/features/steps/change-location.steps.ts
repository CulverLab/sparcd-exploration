import type { Page } from '@playwright/test';
import { Given, When, Then, expect, enterFocusView, sectionTab } from './support/world';
import { BUCKET, PREFIX_A, LOCATION_NAME, NEW_LOCATION_NAME, NEW_LOCATION_ID, SAME_ID_LOCATION_NAME } from './support/data';
import { openSyncDialog, runLiveSync, writeStore, makeLocalEdit, waitForDirtyDrafts, waitForSyncDialogClosed } from './support/flows';

const statePill = (page: Page) => page.getByRole('status', { name: /^Sync status: / });

const changeLocationButton = (page: Page) =>
  page
    .locator(
      'button[title^="Correct the recorded camera location"], button[title^="Pending location change to"]',
    )
    .first();

const changeLocationDialog = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Change location"]');

const locationPickerTrigger = (page: Page) =>
  changeLocationDialog(page).locator('button[aria-haspopup="listbox"]');

async function openChangeLocation(page: Page): Promise<void> {
  await changeLocationButton(page).click();
  await expect(changeLocationDialog(page)).toBeVisible();
}

async function pickLocation(page: Page, name: string): Promise<void> {
  const dialog = changeLocationDialog(page);
  await locationPickerTrigger(page).click();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(`^${escaped}(?:\\s|$)`) }).click();
}

When('the change-location dialog is opened', async ({ page }) => {
  await openChangeLocation(page);
});

Then('the current recorded location is shown', async ({ page }) => {
  await expect(changeLocationDialog(page)).toContainText(LOCATION_NAME);
  await expect(changeLocationDialog(page)).toContainText('SAN15');
});

Then('locations can be searched by name or id from the shared registry', async ({ page }) => {
  const dialog = changeLocationDialog(page);
  await locationPickerTrigger(page).click();
  await dialog.getByPlaceholder('Filter by name or id…').fill(NEW_LOCATION_ID);
  await expect(dialog.getByRole('option', { name: new RegExp(NEW_LOCATION_NAME) })).toBeVisible();
  await expect(dialog.getByRole('option', { name: new RegExp(LOCATION_NAME) })).toHaveCount(0);
  await dialog.getByPlaceholder('Filter by name or id…').fill('');
  await page.keyboard.press('Escape'); // close the dropdown — leave it collapsed for later steps
});

Then('there is no way to add a location that is not already in the registry', async ({ page }) => {
  const text = await changeLocationDialog(page).innerText();
  expect(text).not.toMatch(/add (a )?location|create (a )?location/i);
});

When('a different location is picked and applied', async ({ page }) => {
  await pickLocation(page, NEW_LOCATION_NAME);
  await changeLocationDialog(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(changeLocationDialog(page)).toHaveCount(0);
});

Then('the workspace toolbar shows the pending location change', async ({ page }) => {
  await expect(changeLocationButton(page)).toContainText(`location → ${NEW_LOCATION_NAME}`);
  await expect(changeLocationButton(page)).toHaveAttribute(
    'title',
    `Pending location change to ${NEW_LOCATION_NAME} — click to edit`,
  );
});

When('the current location is picked again', async ({ page }) => {
  const dialog = changeLocationDialog(page);
  await locationPickerTrigger(page).click();
  await page.getByRole('option', { selected: true }).click();
});

Then('applying is disabled because nothing would change', async ({ page }) => {
  await expect(
    changeLocationDialog(page).getByRole('button', { name: /^Apply to all/ }),
  ).toBeDisabled();
  await changeLocationDialog(page).getByRole('button', { name: 'Cancel' }).click();
});

When('a same-id alternate location is picked and applied', async ({ page }) => {
  await pickLocation(page, SAME_ID_LOCATION_NAME);
  await changeLocationDialog(page).getByRole('button', { name: /^Apply to all/ }).click();
});

Then('the workspace toolbar shows the same-id pending location change', async ({ page }) => {
  await expect(changeLocationButton(page)).toContainText(`location → ${SAME_ID_LOCATION_NAME}`);
});

Given('a location change is pending', async ({ page }) => {
  await openChangeLocation(page);
  await pickLocation(page, NEW_LOCATION_NAME);
  await changeLocationDialog(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(changeLocationButton(page)).toContainText('location →');
});

When('the pending change is cleared', async ({ page }) => {
  await openChangeLocation(page);
  await changeLocationDialog(page).getByRole('button', { name: 'Clear pending change' }).click();
});

Then('the workspace toolbar no longer shows a pending location change', async ({ page }) => {
  await expect(changeLocationButton(page)).toHaveAttribute(
    'title',
    'Correct the recorded camera location for this whole upload',
  );
});

When('the sync dialog is opened', async ({ page }) => {
  await openSyncDialog(page);
});

Then('the preview states the pending location change', async ({ page }) => {
  await expect(page.getByText(new RegExp(`Location → ${NEW_LOCATION_NAME}`))).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});

Then('the top-bar sync status shows unsynced edits', async ({ page }) => {
  await expect(statePill(page)).toHaveAttribute('aria-label', 'Sync status: unsynced edits');
});

When('Browse is reopened', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
});

When('the sync is run live', async ({ page }) => {
  await runLiveSync(page);
  await waitForSyncDialogClosed(page);
});

Then("every image's deployment is the new location", async ({ page }) => {
  await enterFocusView(page);
  await expect(page.locator('body')).toContainText(NEW_LOCATION_ID);
});

Then('media and observation timestamps are rebased to the new location offset', async ({ s3 }) => {
  const media = s3.text(BUCKET, `${PREFIX_A}media.csv`);
  const observations = s3.text(BUCKET, `${PREFIX_A}observations.csv`);
  expect(media).toContain('2024-01-10T08:00:00.000-05:00');
  expect(observations).toContain('2024-01-10T08:00:00.000-05:00');
});

// --- Backward compatibility: a session grounded before location tracking ----

Given('a local edit has been made', async ({ page }) => {
  await makeLocalEdit(page);
  await waitForDirtyDrafts(page, 1);
});

Given(
  'the local session was grounded before location tracking existed',
  async ({ page, s3 }) => {
    // The exact shape a real `uploads` Dexie record had before this feature
    // shipped: media/observations/uploadMeta grounded, no `deploymentsETag` /
    // `deploymentsHash` / `pendingLocation` fields at all (not even `undefined`
    // — they never existed on disk). Overwrites the record the background's
    // workspace load already grounded in full, standing in for a browser that
    // still has its pre-upgrade IndexedDB state.
    const at = (name: string) => `${PREFIX_A}${name}`;
    const quotedEtag = (key: string) => `"${s3.etag(BUCKET, key)}"`;
    await writeStore(page, 'uploads', {
      id: `${BUCKET}::${PREFIX_A}`,
      bucket: BUCKET,
      uploadPrefix: PREFIX_A,
      loadedAt: '2024-01-01T00:00:00.000Z',
      timeOffset: null,
      mediaETag: quotedEtag(at('media.csv')),
      mediaHash: s3.hash(BUCKET, at('media.csv')),
      observationsETag: quotedEtag(at('observations.csv')),
      observationsHash: s3.hash(BUCKET, at('observations.csv')),
      uploadMetaETag: quotedEtag(at('UploadMeta.json')),
      uploadMetaHash: s3.hash(BUCKET, at('UploadMeta.json')),
    });
  },
);

Then('no conflict is reported', async ({ page }) => {
  await expect(page.getByText(/Conflict —/)).toHaveCount(0);
  await expect(page.getByText(/Would write \d+ file\(s\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});
