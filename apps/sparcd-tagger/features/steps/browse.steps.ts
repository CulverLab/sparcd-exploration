import {
  Given,
  When,
  Then,
  expect,
  openAppConnected,
  connect,
  collectionRail,
  collectionButton,
  uploadRow,
  sectionTab,
  selectCollection,
  openUpload,
  gridCell,
} from './support/world';
import {
  BUCKET,
  BUCKET_B,
  UUID,
  UUID_B,
  SETTINGS_BUCKET,
  COLLECTION_NAME,
  COLLECTION_B_NAME,
  PREFIX_A,
  PREFIX_B,
  LOCATION_NAME,
} from './support/data';
import { makeLocalEdit, runLiveSync, waitForDirtyDrafts } from './support/flows';

// --- Collection rail --------------------------------------------------------

When('Browse is opened', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
});

Then('the rail lists the collections readable with the connected credentials', async ({ page }) => {
  await expect(collectionButton(page, COLLECTION_NAME)).toBeVisible();
  await expect(collectionButton(page, COLLECTION_B_NAME)).toBeVisible();
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(2);
});

Then(
  'when none are readable it says no collections are visible to these credentials',
  async ({ page, s3 }) => {
    s3.delete(BUCKET, `Collections/${UUID}/collection.json`);
    s3.delete(BUCKET_B, `Collections/${UUID_B}/collection.json`);
    await page.reload();
    await connect(page);
    await expect(page.getByText('No collections visible to these credentials.')).toBeVisible();
  },
);

Given('several collections are listed', async ({ page }) => {
  await openAppConnected(page);
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(2);
});

When('text is typed into the collection filter', async ({ page }) => {
  await page.getByLabel('Filter collections').fill('Backcountry');
});

Then('only collections whose name or organization contains that text remain', async ({ page }) => {
  await expect(collectionButton(page, COLLECTION_B_NAME)).toBeVisible();
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(1);
  // The organization field matches too.
  await page.getByLabel('Filter collections').fill('Culver Lab');
  await expect(collectionButton(page, COLLECTION_NAME)).toBeVisible();
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(1);
});

Then('a message names the filter text when nothing matches', async ({ page }) => {
  await page.getByLabel('Filter collections').fill('nothing-like-this');
  await expect(page.getByText('No collections match')).toContainText('nothing-like-this');
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(0);
});

// --- Species vocabulary status ----------------------------------------------

Then(
  'the rail reports how many species were loaded and which settings bucket they came from',
  async ({ page }) => {
    await expect(collectionRail(page).getByText(/species loaded from/)).toContainText(
      `4 species loaded from ${SETTINGS_BUCKET}`,
    );
  },
);

Then('it reports how many entries were skipped as malformed', async ({ page }) => {
  await expect(collectionRail(page).getByText(/species loaded from/)).toContainText('(1 skipped)');
});

Then('it reports the reason when the vocabulary cannot be read at all', async ({ page, s3 }) => {
  s3.delete(SETTINGS_BUCKET, 'Settings/species.json');
  await page.reload();
  await connect(page);
  await expect(collectionRail(page).getByText(/Species vocabulary unavailable/)).toContainText(
    'No readable settings bucket found',
  );
});

// --- Upload list ------------------------------------------------------------

Given('a collection is selected', async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
});

Then('each upload row shows the upload date and time', async ({ page }) => {
  const row = uploadRow(page, 'priortagger');
  await expect(row).toContainText('2024-01-15');
  await expect(row).toContainText('10:00');
});

Then(
  "it shows the account that made the upload, when the upload's name carries one",
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toContainText('priortagger');
    await expect(uploadRow(page, 'fielduser')).toContainText('fielduser');
  },
);

Then('it shows the deployment location name\\(s\\) recorded for that upload', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
});

Then(
  'it shows the image count and how many of those images already carry a species',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toContainText('6');
    await expect(uploadRow(page, 'priortagger')).toContainText('3 / 6');
  },
);

Given('an upload has no readable deployment file', async ({ page, s3 }) => {
  expect(s3.has(BUCKET, `${PREFIX_B}deployments.csv`)).toBe(false);
  await openAppConnected(page);
  await selectCollection(page);
});

When('its row is shown', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toBeVisible();
});

Then('the row still shows its date, image count and tagging progress', async ({ page }) => {
  const row = uploadRow(page, 'fielduser');
  await expect(row).toContainText('2023-06-01');
  await expect(row).toContainText('2 / 2');
});

Then('the location column is shown as empty rather than the row being hidden', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toContainText('—');
  await expect(uploadRow(page, 'fielduser')).toBeVisible();
});

// --- Tabs + totals ----------------------------------------------------------

Given("a collection's uploads have been tallied", async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
  await expect(uploadRow(page, 'priortagger')).toContainText('3 / 6');
  await expect(uploadRow(page, 'fielduser')).toContainText('2 / 2');
});

When('the {string} tab is chosen', async ({ page }, label: string) => {
  await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).first().click();
});

Then(
  'only uploads with at least one image still lacking a species are listed',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toBeVisible();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
  },
);

Then(
  'the {string} tab lists only uploads where every image already carries a species',
  async ({ page }, label: string) => {
    await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).first().click();
    await expect(uploadRow(page, 'fielduser')).toBeVisible();
    await expect(uploadRow(page, 'priortagger')).toHaveCount(0);
  },
);

Then(
  'uploads whose tally has not finished loading appear only under {string}',
  async ({ page, s3 }, label: string) => {
    // Re-enter Browse with one upload's tally stalled, so its tab membership is
    // still unknown while the other has resolved.
    s3.delay(`${PREFIX_B}UploadMeta.json`, 4000);
    await page.reload();
    await connect(page);
    await selectCollection(page);
    await expect(uploadRow(page, 'priortagger')).toContainText('3 / 6');
    await page.getByRole('button', { name: /^In progress\b/ }).click();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
    await page.getByRole('button', { name: /^Done\b/ }).click();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
    await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).click();
    await expect(uploadRow(page, 'fielduser')).toBeVisible();
    s3.delays.clear();
  },
);

Then('the header states how many uploads, images and tagged images it holds', async ({ page }) => {
  const header = page.locator('main p').filter({ hasText: /uploads?\b/ }).first();
  await expect(header).toContainText('2 uploads');
  await expect(header).toContainText('8 images');
  await expect(header).toContainText('5 tagged');
});

Then('it states how many images are still to go', async ({ page }) => {
  await expect(page.locator('main p').filter({ hasText: 'to go' }).first()).toContainText('3 to go');
});

Then('it indicates while tallies are still being counted', async ({ page, s3 }) => {
  s3.delay(`${PREFIX_B}UploadMeta.json`, 4000);
  await page.reload();
  await connect(page);
  await selectCollection(page);
  await expect(page.getByText('tallying…')).toBeVisible();
  await expect(page.getByText('tallying…')).toBeHidden({ timeout: 15000 });
  s3.delays.clear();
});

// --- Per-upload sync state --------------------------------------------------

Given('local edits were made to an upload in this browser', async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
  await openUpload(page);
  await makeLocalEdit(page);
  await waitForDirtyDrafts(page, 1);
  await sectionTab(page, 'Browse').click();
});

// The Sync column is served from a 5s-stale query, so it only refreshes when
// Browse is re-entered after that window — re-enter until it settles.
async function expectRowPill(
  page: import('@playwright/test').Page,
  user: string,
  text: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const content = (await uploadRow(page, user).textContent()) ?? '';
        if (content.includes(text)) return text;
        await sectionTab(page, 'Settings').click();
        await sectionTab(page, 'Browse').click();
        return content;
      },
      { timeout: 25000, intervals: [1500] },
    )
    .toContain(text);
}

Then("that upload's row is marked as having unsynced edits", async ({ page }) => {
  await expectRowPill(page, 'priortagger', 'unsynced edits');
});

Then('an upload whose local edits have all been synced is marked as synced', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await sectionTab(page, 'Tag').click();
  await runLiveSync(page);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await sectionTab(page, 'Browse').click();
  await expectRowPill(page, 'priortagger', 'synced');
});

Then('an upload never edited on this machine is marked local-only', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toContainText('local-only');
});

// --- Entering the workspace -------------------------------------------------

Given("a collection's uploads are listed", async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
});

When('an upload is opened', async ({ page }) => {
  await openUpload(page);
});

Then('the tagger switches to the Tag section for that upload', async ({ page }) => {
  await expect(sectionTab(page, 'Tag')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Sync…' })).toBeVisible();
});

Then(
  "the upload's canonical image list and existing identifications are loaded",
  async ({ page }) => {
    await expect(page.locator('button[title$=".JPG"], button[title$=".MP4"]')).toHaveCount(6);
    await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
    await expect(gridCell(page, 'IMG003.JPG')).toContainText('Ghost');
    await expect(gridCell(page, 'IMG004.JPG')).toContainText('Mountain Lion +1');
  },
);

