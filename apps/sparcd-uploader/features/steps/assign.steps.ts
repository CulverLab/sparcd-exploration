import { Given, When, Then, expect } from './fixtures';
import { loginIdentityPreferenceKey } from '../../../../packages/auth-ui/src/loginIdentity';
import { ACCESS_KEY, type App } from './app';
import { clipVideo, jpegAt, jpegNoTime, standardBatch } from './batches';
import { expectStoredAtLocation, publishedUploads, reconnectAndReturnToAssign, rescanFromAssign } from './helpers';
import {
  BUCKET_A,
  BUCKET_B,
  COLLECTION_A_NAME,
  COLLECTION_B_NAME,
  LOCATIONS_KEY,
  SETTINGS_BUCKET,
  SKIPPED_LOCATION_NAMES,
  RAW_LOCATIONS,
  locationsJson,
  USED_LOCATION_NAME,
  UUID_A,
  UUID_B,
  VALID_LOCATION_NAMES,
} from './fixtures-data';

const METADATA_NAMES = [
  'deployments.csv',
  'media.csv',
  'observations.csv',
  'UploadMeta.json',
  'UploadComplete.json',
];

Given('a scanned batch has passed the Verify step', async ({ app }) => {
  await app.connect();
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
});

Given('the New upload section is showing the Describe step', async ({ app }) => {
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
  await app.setUploader('Ada Lovelace');
  await app.chooseDeployment('Bear Canyon');
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('Santa Catalina Mountains');
  await app.page.getByLabel('Date collected (required)', { exact: true }).fill('2026-10-01');
  await expect(app.continueButton()).toBeEnabled();
  await expect(app.continueButton()).toHaveAttribute('title', 'Continue to upload');
});

Given('the uploader identity is empty', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('Santa Catalina Mountains');
  await app.page.getByLabel('Date collected (required)', { exact: true }).fill('2026-10-01');
  await app.setUploader('');
  await expect(app.page.getByPlaceholder('e.g. John Doe').first()).toHaveValue('');
});

Then('it states that an uploader identity must be set first', async ({ app }) => {
  await expect(app.continueButton()).toHaveAttribute('title', 'Set an uploader identity first');
});

When('the blank Assign identity field loses focus', async ({ app }) => {
  await app.page.getByPlaceholder('e.g. John Doe').first().press('Tab');
});

Then('Assign restores the confirmed connected account default', async ({ app }) => {
  await expect(app.page.getByPlaceholder('e.g. John Doe').first()).toHaveValue(ACCESS_KEY);
  expect(app.s3.whoamiRequests).toBeGreaterThan(0);
  expect(app.s3.whoamiResponse.body).toContain('<Code>NoSuchKey</Code>');
});

When('the account-name lookup completes while the Assign identity is blank and focused', async ({ app }) => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  await app.page.route('**/-/whoami', async route => {
    entered(); await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'person', name: 'Resolved Researcher' }) });
  });
  await app.page.getByRole('button', { name: 'Retry account-name lookup' }).click(); await reached;
  const input = app.page.locator('#uploaderUser'); await input.fill('');
  release();
  await expect.poll(() => app.page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.defaultIdentity, loginIdentityPreferenceKey(ACCESS_KEY))).toBe('Resolved Researcher');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('');
});
Then('the Assign identity remains blank until blur after a shared preference update', async ({ app }) => {
  await app.page.evaluate(key => {
    const preference = JSON.parse(localStorage.getItem(key)!);
    const oldValue = JSON.stringify(preference);
    const newValue = JSON.stringify({ ...preference, identity: 'Shared Researcher' });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }));
  }, loginIdentityPreferenceKey(ACCESS_KEY));
  const input = app.page.locator('#uploaderUser');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('');
  await input.press('Tab'); await expect(input).toHaveValue('Shared Researcher');
});

// --- the collection list ---------------------------------------------------

When('the Describe step opens', async ({ app }) => {
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

Given('the chosen collection has a collection-specific location list', async ({ app }) => {
  const allowed = RAW_LOCATIONS.filter((location) => ['DEER3', 'BEAR1'].includes(location.idProperty));
  app.s3.put(
    BUCKET_A,
    `Collections/${UUID_A}/locations.json`,
    locationsJson(allowed),
    { contentType: 'application/json' },
  );
  await reconnectAndReturnToAssign(app);
});

Given('the collections have different collection-specific location lists', async ({ app }) => {
  app.s3.put(
    BUCKET_A,
    `Collections/${UUID_A}/locations.json`,
    locationsJson(RAW_LOCATIONS.filter((location) => ['DEER3', 'BEAR1'].includes(location.idProperty))),
    { contentType: 'application/json' },
  );
  app.s3.put(
    BUCKET_B,
    `Collections/${UUID_B}/locations.json`,
    locationsJson(RAW_LOCATIONS.filter((location) => location.idProperty === 'COY2')),
    { contentType: 'application/json' },
  );
  await reconnectAndReturnToAssign(app);
});

Then('only the collection-specific locations are offered', async ({ app }) => {
  await app.openDeploymentList();
  await expect(app.deploymentOptions()).toHaveCount(2);
  const text = (await app.deploymentOptions().allTextContents()).join('\n');
  expect(text).toContain('Bear Canyon');
  expect(text).toContain('Deer Springs');
  expect(text).not.toContain('Coyote Wash');
});

When('an outside collection location is searched', async ({ app }) => {
  await app.openDeploymentList();
  await app.page.getByPlaceholder('Filter by name or id…').fill('coy');
});

Then('the outside location is not offered and assignment remains unavailable', async ({ app }) => {
  await expect(app.deploymentOptions()).toHaveCount(0);
  await expect(app.deploymentTrigger()).toContainText('Select a deployment location…');
  await expect(app.continueButton()).toBeDisabled();
});

Given('a collection-specific location is selected', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
});

When('the user switches to the other collection', async ({ app }) => {
  await app.openCollectionList();
  await app.page
    .locator('ul[role="listbox"] li[role="option"]')
    .filter({ hasText: COLLECTION_B_NAME })
    .click();
  await expect(app.collectionTrigger()).toContainText(COLLECTION_B_NAME);
});

Then('the previous location is cleared because it is not allowed for the new collection', async ({ app }) => {
  await expect(app.deploymentTrigger()).toContainText('Select a deployment location…');
  await expect(app.continueButton()).toBeDisabled();
});

When('the deployment list is shown', async ({ app }) => {
  await app.openDeploymentList();
  await expect(app.deploymentOptions().first()).toBeVisible();
});

Then('those already-used locations are listed first', async ({ app }) => {
  await expect(app.deploymentOptions().first()).toContainText(USED_LOCATION_NAME);
});

Then("the list states how many of the registry's locations that collection has used", async ({ app }) => {
  await expect(app.page.getByText(/1 of 7 locations\s+currently allowed for/)).toBeVisible();
  await expect(app.page.getByText(/currently allowed for/)).toBeVisible();
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

Then('the Describe step explains that the registry could not be loaded', async ({ app }) => {
  await expect(app.page.getByText(/No readable settings bucket found/)).toBeVisible({ timeout: 30_000 });
});

Then('no deployment can be chosen until it can be read', async ({ app }) => {
  await expect(app.page.locator('button[aria-haspopup="listbox"]')).toHaveCount(1);
  await expect(app.continueButton()).toBeDisabled();
});

// --- identity, description, and production preview privacy -----------------

When('an uploader identity is typed', async ({ app }) => {
  await app.setUploader('Ada Lovelace');
});

Then(
  "the tool shows the key-safe form of it that will appear in the upload's storage path and object names",
  async ({ app }) => {
    await app.gotoSection('Settings');
  await app.page.getByText('Defaults', { exact: true }).click();
    await expect(app.page.getByText(/Used in upload prefixes and object keys as/)).toContainText(
      'ada-lovelace',
    );
  },
);

When('a description is entered', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await app.setDescription('South ridge, July retrieval');
});

Then("it is stored as the upload's description in the upload's metadata file", async ({ app }) => {
  await app.continueToUpload();
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
  const uploadMeta = app.s3.puts.find((put) => put.key.endsWith('UploadMeta.json'));
  expect(JSON.parse(uploadMeta!.body).description).toMatch(/ - South ridge, July retrieval$/);
});

Given('a collection, a deployment and an uploader identity have been chosen', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await expect(app.collectionTrigger()).toContainText(COLLECTION_A_NAME);
});

When('the Upload step is opened', async ({ app }) => {
  await app.continueToUpload();
});

Then(
  'no bundle Preview control or generated metadata contents are offered',
  async ({ app }) => {
    await expect(app.page.getByRole('heading', { name: 'Preview', exact: true })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: /preview/i })).toHaveCount(0);
    for (const name of METADATA_NAMES) {
      await expect(app.page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(app.page.locator('pre')).toHaveCount(0);
    await expect(app.page.getByText(/32\.4|-110\.7/)).toHaveCount(0);
  },
);

Then('the complete metadata bundle is still written', async ({ app }) => {
  const metadata = app.s3.puts.filter((put) =>
    METADATA_NAMES.some((name) => put.key.endsWith(name)),
  );
  expect(metadata.map((put) => put.key.split('/').pop())).toEqual(METADATA_NAMES);
  expect(metadata.every((put) => put.body.length > 0)).toBe(true);
  expect(metadata.find((put) => put.key.endsWith('deployments.csv'))?.body).toContain(
    `${UUID_A}:BEAR1`,
  );
  expect(metadata.find((put) => put.key.endsWith('deployments.csv'))?.body).toContain('32.4');
  expect(metadata.find((put) => put.key.endsWith('media.csv'))?.body).toContain('IMG_0001.JPG');
  expect(metadata.find((put) => put.key.endsWith('observations.csv'))?.body).toContain('blank');
  expect(metadata.find((put) => put.key.endsWith('UploadMeta.json'))?.body).toContain(
    '"uploadUser": "ada-lovelace"',
  );
});

// --- the stored location ---------------------------------------------------

type PublishedBatch = { prefix: string; location: string; files: number };

async function uploadAt(app: App, location: string): Promise<void> {
  await app.chooseDeployment(location);
  await app.setUploader('Ada Lovelace');
  await app.continueToUpload();
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
  const uploads = (app.notes.uploads ??= []) as PublishedBatch[];
  uploads.push({ prefix: publishedUploads(app).at(-1)!, location, files: app.lastSpecs.length });
}

When('the batch is uploaded with {string} as its location', async ({ app }, location: string) => {
  await uploadAt(app, location);
});

When('the next batch is uploaded with {string} as its location', async ({ app }, location: string) => {
  // Upload folders are stamped to the second, so a second upload inside the
  // same second would claim the first one's folder. Moving the page clock a
  // minute ahead puts the next stamp in a later second by construction.
  await app.page.clock.setSystemTime(Date.now() + 60_000);
  await app.page.getByRole('button', { name: 'Next batch' }).click();
  await app.dropFolder([
    jpegAt('IMG_0101.JPG', '2026:07:08 06:00:00'),
    jpegAt('IMG_0102.JPG', '2026:07:08 06:05:00'),
  ]);
  await app.waitForInspected();
  await app.continueToAssign();
  await app.waitForCollections();
  // Next batch starts with nothing assigned (#338), so pick the collection again.
  await app.chooseCollection(COLLECTION_A_NAME);
  await uploadAt(app, location);
});

Then(
  'each upload stores the location assigned to its batch, with its id, name and coordinates',
  async ({ app }) => {
    const uploads = app.notes.uploads as PublishedBatch[];
    expect(publishedUploads(app)).toEqual(uploads.map((u) => u.prefix));
    expect(new Set(uploads.map((u) => u.prefix)).size).toBe(2);
    for (const u of uploads) expectStoredAtLocation(app, u.prefix, u.location);
  },
);

Then('every image and every observation in each upload points at that location', async ({ app }) => {
  for (const u of app.notes.uploads as PublishedBatch[]) {
    const { media, observations } = expectStoredAtLocation(app, u.prefix, u.location);
    expect(media).toHaveLength(u.files);
    expect(new Set(observations.map((r) => r[3]))).toEqual(new Set(media.map((r) => r[0])));
  }
});

When('the mountain range and collection date are entered with notes {string}', async ({ app }, notes: string) => {
  await app.page.clock.setSystemTime(new Date('2026-10-14T12:00:00-04:00'));
  app.notes.optionalComments = notes;
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('Santa Catalina Mountains');
  await app.page.getByLabel('Date collected (required)', { exact: true }).fill('2026-10-01');
  await app.page.getByLabel('Comments (optional)', { exact: true }).fill(notes);
});

Then('the required comment is previewed without changing the optional notes', async ({ app }) => {
  const notes = app.notes.optionalComments as string;
  const prefix = 'Santa Catalina Mountains - Bear Canyon - 3 images - uploaded 2026-10-14 - collected 2026-10-01';
  const expected = notes ? `${prefix} - ${notes}` : prefix;
  app.notes.expectedComment = expected;
  await expect(app.page.getByLabel('Generated upload comment', { exact: true })).toHaveText(expected);
  await expect(app.page.getByLabel('Comments (optional)', { exact: true })).toHaveValue(notes);
});

Then('the generated comment and optional notes are written to upload metadata', async ({ app }) => {
  const expected = app.notes.expectedComment as string;
  await app.continueToUpload();
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
  const meta = app.s3.puts.find((put) => put.key.endsWith('UploadMeta.json'));
  expect(meta).toBeDefined();
  expect(JSON.parse(meta!.body).description).toBe(expected);
});

When('the other assignment fields are complete but both comment fields are empty', async ({ app }) => {
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('');
  await app.page.getByLabel('Date collected (required)', { exact: true }).fill('');
  await expect(app.page.getByLabel('Mountain range (required)', { exact: true })).toHaveAttribute('required', '');
  await expect(app.page.getByLabel('Date collected (required)', { exact: true })).toHaveAttribute('required', '');
});

When('a whitespace-only mountain range is entered', async ({ app }) => {
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('   ');
});

When('a mountain range is entered without a collection date', async ({ app }) => {
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('Santa Catalina Mountains');
});

When('the collection date is entered', async ({ app }) => {
  await app.page.getByLabel('Date collected (required)', { exact: true }).fill('2026-10-01');
});

When('the mountain range is cleared with the collection date still entered', async ({ app }) => {
  await app.page.getByLabel('Mountain range (required)', { exact: true }).fill('');
});

Then('Continue explains that a mountain range is required', async ({ app }) => {
  await expect(app.continueButton()).toBeDisabled();
  await expect(app.continueButton()).toHaveAttribute('aria-describedby', 'upload-continue-help');
  await expect(app.page.locator('#upload-continue-help')).toContainText('Enter a mountain range before continuing');
});

Then('Continue explains that a collection date is required', async ({ app }) => {
  await expect(app.continueButton()).toBeDisabled();
  await expect(app.page.locator('#upload-continue-help')).toContainText('Enter a date collected before continuing');
});

Then('Continue allows the Upload step', async ({ app }) => {
  await expect(app.continueButton()).toBeEnabled();
  await expect(app.continueButton()).toHaveAttribute('title', 'Continue to upload');
});

When('the next day arrives while Describe stays open', async ({ app }) => {
  await app.page.clock.setSystemTime(new Date('2026-10-15T00:00:01-04:00'));
});

Then("the comment preview keeps its original upload date", async ({ app }) => {
  await expect(app.page.getByLabel('Generated upload comment', { exact: true })).toHaveText(
    'Santa Catalina Mountains - Bear Canyon - 3 images - uploaded 2026-10-14 - collected 2026-10-01 - Overnight batch',
  );
});

When('Upload is opened and another day arrives before starting', async ({ app }) => {
  await app.continueToUpload();
  await app.page.clock.setSystemTime(new Date('2026-10-16T00:00:01-04:00'));
  await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
});

Then('the Upload preview keeps the original preview date', async ({ app }) => {
  const expected = 'Santa Catalina Mountains - Bear Canyon - 3 images - uploaded 2026-10-14 - collected 2026-10-01 - Overnight batch';
  const preview = expected.replace(' - Overnight batch', '');
  app.notes.expectedComment = expected;
  app.notes.expectedPreview = preview;
  await expect(app.page.getByLabel('Generated upload comment', { exact: true })).toHaveText(preview);
  const comments = app.page.getByRole('button', { name: 'Comments', exact: true });
  await expect(comments).toHaveAttribute('aria-expanded', 'false');
  await expect(app.page.getByText('Overnight batch', { exact: true })).toHaveCount(0);
  await comments.click();
  await expect(comments.locator('..')).toContainText('Overnight batch');
  await comments.click();
});

When('the batch is uploaded after midnight', async ({ app }) => {
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await app.waitForRunPhase('done');
});

Then('the saved comment includes optional notes and keeps its original preview date', async ({ app }) => {
  const expected = app.notes.expectedComment as string;
  const meta = app.s3.puts.find((put) => put.key.endsWith('UploadMeta.json'));
  expect(JSON.parse(meta!.body).description).toBe(expected);
  const batch = (await app.readBatchRecords())[0];
  expect(String(batch.startedAt).slice(0, 10)).toBe('2026-10-16');
  expect(batch.requiredComments).toMatchObject({ previewUploadDate: '2026-10-14' });
  await app.page.clock.setSystemTime(new Date('2026-10-17T12:00:00-04:00'));
  await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(app.page.getByLabel('Generated upload comment', { exact: true })).toHaveText(app.notes.expectedPreview as string);
});

Given('the batch contains one JPEG and two MP4 videos', async ({ app }) => {
  await rescanFromAssign(app, [standardBatch()[0], clipVideo('FIRST.MP4'), clipVideo('SECOND.MP4')]);
});

Then('Describe help is keyboard accessible and clamped at phone widths', async ({ app }) => {
  await rescanFromAssign(app, [jpegNoTime('NO_TIME.JPG')]);
  await expect(app.page.getByRole('button', { name: 'About Capture times', exact: true })).toBeVisible();
  for (const width of [320, 375]) {
    await app.page.setViewportSize({ width, height: 640 });
    for (const label of ['Collection', 'Site ID', 'Uploader', 'Timezone of images', 'Capture times', 'Mountain range', 'Date collected', 'Comments']) {
      const button = app.page.getByRole('button', { name: `About ${label}`, exact: true });
      await button.scrollIntoViewIfNeeded();
      await button.focus();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      const popup = app.page.getByRole('tooltip');
      await expect(popup).toBeVisible();
      const box = await popup.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(16);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 16);
      expect(box!.y).toBeGreaterThanOrEqual(16);
      expect(box!.y + box!.height).toBeLessThanOrEqual(640 - 16);
      await app.page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
      await expect(app.page.getByRole('tooltip')).toHaveCount(0);
    }
  }
  const hover = app.page.getByRole('button', { name: 'About Collection', exact: true });
  await hover.hover();
  const tooltip = app.page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await tooltip.hover();
  // Stay past the pointer-transfer grace period to prove the help is hoverable.
  await app.page.waitForTimeout(200);
  await expect(tooltip).toBeVisible();
  await app.page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
});

Then('Describe help can be opened and dismissed on a touch screen', async ({ app, browser, s3 }) => {
  const { App } = await import('./app');
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 640 }, baseURL: new URL(app.page.url()).origin });
  try {
    const page = await context.newPage();
    const touchApp = new App(page, s3);
    await touchApp.connect();
    await touchApp.dropFolder(standardBatch());
    await touchApp.waitForInspected();
    await touchApp.continueToAssign();
    await touchApp.waitForCollections();
    const button = page.getByRole('button', { name: 'About Timezone of images', exact: true });
    await button.tap();
    const popup = page.getByRole('tooltip');
    await expect(popup).toBeVisible();
    await page.setViewportSize({ width: 320, height: 480 });
    await expect.poll(async () => {
      const bounds = await popup.boundingBox();
      return !!bounds && bounds.x >= 16 && bounds.x + bounds.width <= 304 && bounds.y >= 16 && bounds.y + bounds.height <= 464;
    }).toBe(true);
    await page.evaluate(() => window.scrollBy(0, 100));
    await expect(popup).toBeInViewport();
    await button.tap();
    await expect(popup).toHaveCount(0);
    await button.tap();
    await expect(popup).toBeVisible();
    await page.locator('#uploadTimeZone').tap();
    await expect(popup).toHaveCount(0);
  } finally { await context.close(); }
});

When('the blank Describe identity field loses focus', async ({ app }) => {
  await app.page.locator('#uploaderUser').press('Tab');
});
Then('Describe restores the confirmed connected account default', async ({ app }) => {
  await expect(app.page.locator('#uploaderUser')).toHaveValue(ACCESS_KEY);
  expect(app.s3.whoamiRequests).toBeGreaterThan(0);
  expect(app.s3.whoamiResponse.body).toContain('<Code>NoSuchKey</Code>');
});
