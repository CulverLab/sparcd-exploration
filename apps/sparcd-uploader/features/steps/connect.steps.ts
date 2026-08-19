import type { Page } from '@playwright/test';
import { Given, When, Then, expect } from './fixtures';
import { ACCESS_KEY, SECRET_KEY, S3_ORIGIN } from './app';
import { standardBatch } from './batches';
import { BUCKET_B, COLLECTION_A_NAME, COLLECTION_B_NAME, UUID_B } from './fixtures-data';

const AWS_ENDPOINT = 'https://s3.us-west-2.amazonaws.com';

Given('the uploader is open in a browser', async ({ app }) => {
  await app.open();
});

Given('no connection has been made in this browser session', async ({ app }) => {
  // A fresh browser context — nothing persisted, nothing relayed.
  await expect(app.connectForm()).toBeVisible();
});

Then('the connection screen is the only thing shown', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible();
  await expect(app.page.locator('header')).toHaveCount(0);
});

Then('the New upload, History and Settings sections are not reachable', async ({ app }) => {
  await expect(app.page.locator('nav[aria-label="Sections"]')).toHaveCount(0);
  for (const label of ['New upload', 'History', 'Settings']) {
    await expect(app.page.getByRole('button', { name: label })).toHaveCount(0);
  }
});

Given('the connection screen is shown', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible();
});

When('any of the endpoint, access key or secret key is empty', async ({ app }) => {
  await app.fillConnection();
  await app.page.fill('#secretKey', '');
});

Then('the Connect button is disabled', async ({ app }) => {
  await expect(app.page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
});

When('an endpoint is entered', async ({ app }) => {
  await app.page.fill('#endpoint', AWS_ENDPOINT);
});

Then('the region, path-style addressing and HTTPS settings are inferred from it', async ({ app }) => {
  await app.page.getByRole('button', { name: '+ Advanced' }).click();
  await expect(app.page.locator('#region')).toHaveValue('us-west-2');
  await expect(app.page.getByLabel('Force path-style addressing (MinIO)')).not.toBeChecked();
  await expect(app.page.getByLabel('Secure (HTTPS)')).toBeChecked();
});

Then('those inferred settings are only shown under "Advanced"', async ({ app }) => {
  await app.page.getByRole('button', { name: '− Advanced' }).click();
  await expect(app.page.locator('#region')).toHaveCount(0);
  await app.page.getByRole('button', { name: '+ Advanced' }).click();
  await expect(app.page.locator('#region')).toBeVisible();
});

Then('any of them can be overridden before connecting', async ({ app }) => {
  await app.page.fill('#region', 'eu-central-1');
  await app.page.getByLabel('Force path-style addressing (MinIO)').check();
  await app.page.getByLabel('Secure (HTTPS)').uncheck();
  await expect(app.page.locator('#region')).toHaveValue('eu-central-1');
  await expect(app.page.getByLabel('Force path-style addressing (MinIO)')).toBeChecked();
  await expect(app.page.getByLabel('Secure (HTTPS)')).not.toBeChecked();
});

Given('a successful connection was made earlier in this browser', async ({ app }) => {
  await app.connect();
});

When('the uploader is opened again in a new page load', async ({ app }) => {
  await app.reopen();
});

Then('the endpoint and access key are pre-filled from the previous connection', async ({ app }) => {
  await expect(app.page.locator('#endpoint')).toHaveValue(S3_ORIGIN);
  await expect(app.page.locator('#accessKey')).toHaveValue(ACCESS_KEY);
});

Then('the secret key field is empty', async ({ app }) => {
  await expect(app.page.locator('#secretKey')).toHaveValue('');
});

Then('the uploader stays on the connection screen until the secret is re-entered', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
  await app.page.fill('#secretKey', SECRET_KEY);
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Logout' })).toBeVisible();
});

Given("one tab of a SPARC'd tool is already connected in this browser", async ({ app }) => {
  await app.connect();
});

When('another tab of the uploader is opened', async ({ app }) => {
  app.notes.secondTab = await app.openSecondTab();
});

Then('it adopts the live connection without asking for the secret again', async ({ app }) => {
  const tab = app.notes.secondTab as Page;
  await expect(tab.getByRole('button', { name: 'Logout' })).toBeVisible();
  await expect(tab.locator('form[aria-label*="Connect"]')).toHaveCount(0);
});

Given('two tabs are connected to the same storage endpoint', async ({ app }) => {
  await app.connect();
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
  app.notes.secondTab = await app.openSecondTab();
  await expect((app.notes.secondTab as Page).getByRole('button', { name: 'Logout' })).toBeVisible();
});

When('one of them disconnects', async ({ app }) => {
  const tab = app.notes.secondTab as Page;
  await tab.getByRole('button', { name: 'Logout' }).click();
});

Then('the other returns to the connection screen', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible();
});

Then('its in-progress batch, chosen collection and chosen deployment are cleared', async ({ app }) => {
  await app.fillConnection();
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await app.expectStep('Files');
  await expect(app.page.getByText('Drop a folder of media')).toBeVisible();
});

Then('the header shows the endpoint host and a masked form of the access key', async ({ app }) => {
  const header = app.page.locator('header');
  await expect(header).toContainText('localhost');
  await expect(header).toContainText('AK…01');
});

Then('it shows the uploader identity when one has been set', async ({ app }) => {
  await expect(app.page.locator('header')).toContainText(ACCESS_KEY);
});

Then('it never displays the secret key', async ({ app }) => {
  const body = await app.page.innerText('body');
  expect(body).not.toContain(SECRET_KEY);
  await expect(app.page.locator(`input[type="password"]`)).toHaveCount(0);
});

Given('the uploader has read a collection list from one connection', async ({ app }) => {
  await app.connect();
  await app.gotoSection('History');
  await expect(app.page.getByRole('option', { name: COLLECTION_A_NAME })).toBeAttached();
  app.notes.readsBefore = app.s3.gets.filter((k) => k.includes('collection.json')).length;
  app.notes.locationReadsBefore = app.s3.gets.filter((k) => k.includes('locations.json')).length;
  expect(app.notes.readsBefore as number).toBeGreaterThan(0);
});

When('the user disconnects and connects again', async ({ app }) => {
  await app.disconnectFromHeader();
  await expect(app.connectForm()).toBeVisible();
  await app.fillConnection();
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await app.gotoSection('History');
  await expect(app.page.getByRole('option', { name: COLLECTION_A_NAME })).toBeAttached();
});

Then('the collection and location lists are read again for the new connection', async ({ app }) => {
  await expect
    .poll(() => app.s3.gets.filter((k) => k.includes('collection.json')).length)
    .toBeGreaterThan(app.notes.readsBefore as number);
  await expect
    .poll(() => app.s3.gets.filter((k) => k.includes('locations.json')).length)
    .toBeGreaterThan(app.notes.locationReadsBefore as number);
});

Then('no result cached under the previous connection is reused', async ({ app }) => {
  // The query keys carry the connection id, so the second connection's reads
  // are a fresh round trip rather than a cache hit.
  expect(app.s3.gets.filter((k) => k.includes('collection.json')).length).toBeGreaterThanOrEqual(
    2 * (app.notes.readsBefore as number),
  );
});

Given('no uploader identity has been entered', async ({ app }) => {
  await app.open();
  await expect(app.connectForm()).toBeVisible();
});

When('a connection is made', async ({ app }) => {
  await app.connect();
});

Then('the uploader identity is pre-filled with the connected access key', async ({ app }) => {
  await expect(app.page.locator('header')).toContainText(ACCESS_KEY);
  await app.gotoSection('Settings');
  await expect(app.page.getByPlaceholder('e.g. John Doe')).toHaveValue(ACCESS_KEY);
});

Then(
  'an identity carried over from a previous connection in this browser is not overwritten by connecting',
  async ({ app }) => {
    await app.reopen();
    await app.fillConnection({ accessKey: 'AKIADIFFERENT002' });
    await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(app.page.getByRole('button', { name: 'Logout' })).toBeVisible();
    await app.gotoSection('Settings');
    await expect(app.page.getByPlaceholder('e.g. John Doe')).toHaveValue(ACCESS_KEY);
  },
);

Then('the tool offers no list of permitted buckets of its own', async ({ app }) => {
  await app.gotoSection('History');
  const options = app.page.locator('select option');
  await expect(options.filter({ hasText: COLLECTION_A_NAME })).toHaveCount(1);
  await expect(options.filter({ hasText: COLLECTION_B_NAME })).toHaveCount(1);
  // Nothing but the discovered collections and the placeholder.
  await expect(app.page.locator('select').first().locator('option')).toHaveCount(3);
});

Then(
  "a bucket is readable or writable only if the supplied credentials and the bucket's CORS policy allow it",
  async ({ app }) => {
    app.s3.unreadableKeys.add(`${BUCKET_B}/Collections/${UUID_B}/collection.json`);
    await app.disconnectFromHeader();
    await app.fillConnection();
    await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
    await app.gotoSection('History');
    await expect(app.page.getByRole('option', { name: COLLECTION_A_NAME })).toBeAttached();
    await expect(app.page.getByRole('option', { name: COLLECTION_B_NAME })).toHaveCount(0);
  },
);
