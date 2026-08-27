import { Given, When, Then, expect } from './fixtures';
import { jpegNoTime, jpegAt, standardBatch } from './batches';
import { reconnectAndReturnToAssign, rescanFromAssign } from './helpers';
import {
  BUCKET_A,
  BUCKET_B,
  COLLECTION_A_NAME,
  COLLECTION_B_NAME,
  LOCATIONS_KEY,
  SETTINGS_BUCKET,
  SKIPPED_LOCATION_NAMES,
  USED_LOCATION_NAME,
  UUID_A,
  UUID_B,
  VALID_LOCATION_NAMES,
} from './fixtures-data';

Given('a scanned batch has passed the Inspect step', async ({ app }) => {
  await app.connect();
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
});

Given('the New upload section is showing the Assign step', async ({ app }) => {
  await app.continueToAssign();
  await app.waitForCollections();
});

// --- the Continue gate -----------------------------------------------------

Given('no deployment location has been chosen', async ({ app }) => {
  await expect(app.deploymentTrigger()).toContainText('Select a deployment location…');
});

Then('it states that a deployment location must be selected first', async ({ app }) => {
  await expect(app.continueButton()).toHaveAttribute('title', 'Select a deployment location first');
});

Given('the collections readable with the connected credentials have been listed', async ({ app }) => {
  await expect(app.collectionTrigger()).toContainText(COLLECTION_A_NAME);
});

Then('the first of them is already selected', async ({ app }) => {
  await app.openCollectionList();
  const options = app.page.locator('ul[role="listbox"] li[role="option"]');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText(COLLECTION_A_NAME);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await app.closeCollectionList();
});

Then('the Continue gate never has to ask for a collection', async ({ app }) => {
  await expect(app.continueButton()).toHaveAttribute('title', 'Select a deployment location first');
  await app.chooseDeployment('Bear Canyon');
  await expect(app.continueButton()).toBeEnabled();
  await expect(app.continueButton()).toHaveAttribute('title', 'Continue to upload');
});

Given('the uploader identity is empty', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('');
});

Then('it states that an uploader identity must be set first', async ({ app }) => {
  await expect(app.continueButton()).toHaveAttribute('title', 'Set an uploader identity first');
});

Given('at least one examined file has neither a camera capture time nor a manual one', async ({ app }) => {
  await rescanFromAssign(app, [jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'), jpegNoTime('IMG_NOTIME.JPG')]);
  await app.chooseDeployment('Bear Canyon');
});

Then('it states that a capture time is needed for every file missing one', async ({ app }) => {
  await expect(app.continueButton()).toHaveAttribute(
    'title',
    'Set a capture time for every file missing one',
  );
});

// --- the collection list ---------------------------------------------------

When('the Assign step opens', async ({ app }) => {
  await expect(app.collectionTrigger()).toBeVisible();
});

Then('the tool lists the collections readable with the connected credentials', async ({ app }) => {
  await app.openCollectionList();
  const options = app.page.locator('ul[role="listbox"] li[role="option"]');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText(COLLECTION_A_NAME);
  await expect(options.nth(1)).toContainText(COLLECTION_B_NAME);
});

Then('the first of them is pre-selected', async ({ app }) => {
  await expect(app.page.locator('ul[role="listbox"] li[role="option"]').first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await app.closeCollectionList();
  await expect(app.collectionTrigger()).toContainText(COLLECTION_A_NAME);
});

Then(
  "each is shown with its name and its organization or contact, and the selected one's identifier is shown beneath the list",
  async ({ app }) => {
    await app.openCollectionList();
    const options = app.page.locator('ul[role="listbox"] li[role="option"]');
    await expect(options.nth(0)).toContainText('Alpha Org · alpha@example.org');
    await expect(options.nth(1)).toContainText('Beta Org · beta@example.org');
    await expect(options.nth(0)).not.toContainText(UUID_A);
    await app.closeCollectionList();
    await expect(app.page.getByText(`${COLLECTION_A_NAME} · ${UUID_A}`)).toBeVisible();
  },
);

Given('the connected credentials can read no collection', async ({ app }) => {
  app.s3.unreadableKeys.add(`${BUCKET_A}/Collections/${UUID_A}/collection.json`);
  app.s3.unreadableKeys.add(`${BUCKET_B}/Collections/${UUID_B}/collection.json`);
  await reconnectAndReturnToAssign(app);
});

Then(
  "the tool states that credentials able to read a collection's descriptor are required, and that the bucket must allow this web origin",
  async ({ app }) => {
    await expect(app.page.getByText(/No collections found\./)).toBeVisible({ timeout: 30_000 });
    await expect(app.page.getByText(/Collections\/<uuid>\/collection\.json/)).toBeVisible();
    await expect(app.page.getByText(/must allow this web origin via CORS/)).toBeVisible();
  },
);

// --- the deployment list ---------------------------------------------------

Given('the chosen collection has already published uploads for some locations', async ({ app }) => {
  expect(app.s3.text(BUCKET_A, `Collections/${UUID_A}/Uploads/2026.01.02.09.00.00_priorperson/deployments.csv`)).toContain(
    'DEER3',
  );
});

When('the deployment list is shown', async ({ app }) => {
  await app.openDeploymentList();
  await expect(app.deploymentOptions().first()).toBeVisible();
});

Then('those already-used locations are listed first', async ({ app }) => {
  await expect(app.deploymentOptions().first()).toContainText(USED_LOCATION_NAME);
});

Then("the list states how many of the registry's locations that collection has used", async ({ app }) => {
  await expect(app.page.getByText(/1 of 6 locations\s+already deployed by/)).toBeVisible();
  await expect(app.page.getByText(/but any location can be assigned/)).toBeVisible();
});

When("part of a location's name or identifier is typed", async ({ app }) => {
  await app.openDeploymentList();
  await app.page.getByPlaceholder('Filter by name or id…').fill('coy');
});

Then('the list narrows to the matching locations', async ({ app }) => {
  await expect(app.deploymentOptions()).toHaveCount(1);
  await expect(app.deploymentOptions().first()).toContainText('Coyote Wash');
});

Then('a location can be chosen with the keyboard or by clicking it', async ({ app }) => {
  await app.page.getByPlaceholder('Filter by name or id…').press('Enter');
  await expect(app.deploymentTrigger()).toContainText('Coyote Wash');
  await app.chooseDeployment('Bear Canyon');
  await expect(app.deploymentTrigger()).toContainText('Bear Canyon');
});

When("a location's details are opened", async ({ app }) => {
  await app.openDeploymentList();
  await app.page.getByRole('button', { name: 'Details for Bear Canyon' }).click();
});

Then(
  "its elevation in both metres and feet is shown, with no coordinates",
  async ({ app }) => {
    const detail = app.deploymentOptions().filter({ hasText: 'Bear Canyon' }).first();
    await expect(detail).toContainText('1200 m');
    await expect(detail).toContainText('3937.01 ft');
    await expect(detail).not.toContainText('32.4');
    await expect(detail).not.toContainText('12S');
  },
);

Given(
  'the location registry contains two entries with the same identifier but different coordinates',
  async ({ app }) => {
    const raw = JSON.parse(app.s3.text(SETTINGS_BUCKET, LOCATIONS_KEY)!) as { idProperty: string }[];
    expect(raw.filter((e) => e.idProperty === 'DUP9')).toHaveLength(2);
  },
);

Then('both are offered as separate locations', async ({ app }) => {
  await app.openDeploymentList();
  await app.page.getByPlaceholder('Filter by name or id…').fill('DUP9');
  await expect(app.deploymentOptions()).toHaveCount(2);
  await expect(app.deploymentOptions().nth(0)).toContainText('2000 m');
  await expect(app.deploymentOptions().nth(1)).toContainText('2100 m');
});

Then('an entry repeated with identical identifier and coordinates is offered once', async ({ app }) => {
  await app.page.getByPlaceholder('Filter by name or id…').fill('BEAR1');
  await expect(app.deploymentOptions()).toHaveCount(1);
});

Given(
  'the registry contains entries with a missing name, an out-of-range coordinate, or an unset elevation',
  async ({ app }) => {
    const raw = JSON.parse(app.s3.text(SETTINGS_BUCKET, LOCATIONS_KEY)!) as {
      nameProperty: string;
      latProperty: number;
      elevationProperty: number;
    }[];
    expect(raw.some((e) => e.nameProperty === '')).toBe(true);
    expect(raw.some((e) => e.latProperty === 99)).toBe(true);
    expect(raw.some((e) => e.elevationProperty === -20000)).toBe(true);
  },
);

Then('those entries are left out of the list', async ({ app }) => {
  await app.openDeploymentList();
  const text = (await app.deploymentOptions().allTextContents()).join('\n');
  for (const name of SKIPPED_LOCATION_NAMES) expect(text).not.toContain(name);
  expect(text).not.toContain('NONAME');
});

Then('every valid entry is still offered', async ({ app }) => {
  const text = (await app.deploymentOptions().allTextContents()).join('\n');
  for (const name of VALID_LOCATION_NAMES) expect(text).toContain(name);
  await expect(app.deploymentOptions()).toHaveCount(VALID_LOCATION_NAMES.length);
});

Given('the location registry cannot be read with the connected credentials', async ({ app }) => {
  app.s3.unreadableKeys.add(`${SETTINGS_BUCKET}/${LOCATIONS_KEY}`);
  await reconnectAndReturnToAssign(app);
});

Then('the Assign step explains that the registry could not be loaded', async ({ app }) => {
  await expect(app.page.getByText(/No readable settings bucket found/)).toBeVisible({ timeout: 30_000 });
});

Then('no deployment can be chosen until it can be read', async ({ app }) => {
  await expect(app.page.locator('button[aria-haspopup="listbox"]')).toHaveCount(1);
  await expect(app.continueButton()).toBeDisabled();
});

// --- identity, description, preview ----------------------------------------

When('an uploader identity is typed', async ({ app }) => {
  await app.setUploader('Ada Lovelace');
});

Then(
  "the tool shows the key-safe form of it that will appear in the upload's storage path and object names",
  async ({ app }) => {
    await app.gotoSection('Settings');
    await expect(app.page.getByText(/Used in upload prefixes and object keys as/)).toContainText(
      'ada-lovelace',
    );
  },
);

When('a description is entered', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.setDescription('South ridge, July retrieval');
});

Then("it is stored as the upload's description in the upload's metadata file", async ({ app }) => {
  await app.continueToUpload();
  await app.page.getByRole('button', { name: /Click to preview the generated bundle files/ }).click();
  await expect(app.page.getByRole('button', { name: 'UploadMeta.json' })).toBeVisible();
  await expect(app.page.locator('pre')).toContainText('"description": "South ridge, July retrieval"');
});

Given('a collection, a deployment and an uploader identity have been chosen', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await expect(app.collectionTrigger()).toContainText(COLLECTION_A_NAME);
  app.notes.putsBefore = app.s3.puts.length;
});

When('the preview is opened', async ({ app }) => {
  await app.continueToUpload();
  await app.page.getByRole('button', { name: /Click to preview the generated bundle files/ }).click();
  await expect(app.page.locator('pre').first()).toBeVisible();
});

Then(
  'the tool shows the exact contents of the upload metadata file and of the deployments, media and observations tables it will write',
  async ({ app }) => {
    await expect(app.page.locator('pre')).toContainText('"uploadUser": "ada-lovelace"');
    await app.page.getByRole('button', { name: 'deployments.csv' }).click();
    await expect(app.page.locator('pre')).toContainText(`${UUID_A}:BEAR1`);
    await app.page.getByRole('button', { name: 'media.csv' }).click();
    await expect(app.page.locator('pre')).toContainText('IMG_0001.JPG');
    await app.page.getByRole('button', { name: 'observations.csv' }).click();
    await expect(app.page.locator('pre')).toContainText('blank');
  },
);

Then('it shows the storage path the batch will land under', async ({ app }) => {
  await expect(app.page.getByText(/landing under/)).toContainText(
    `Collections/${UUID_A}/Uploads/`,
  );
  await expect(app.page.getByText(/landing under/)).toContainText('_ada-lovelace/');
});

Then('building the preview writes nothing', async ({ app }) => {
  expect(app.s3.puts.length).toBe(app.notes.putsBefore as number);
  expect(app.s3.puts).toHaveLength(0);
});
