import { Given, When, Then, expect } from './fixtures';
import { S3_ORIGIN, SECRET_KEY } from './app';
import { standardBatch } from './batches';
import { produceCompleteRun, producePartialRun } from './helpers';

const identityField = 'e.g. John Doe';

// --- the default identity --------------------------------------------------

When('an uploader identity is entered in Settings', async ({ app }) => {
  await app.gotoSection('Settings');
  await app.page.getByPlaceholder(identityField).fill('Ada Lovelace');
});

Then('the tool shows the key-safe form of it that will appear in upload paths', async ({ app }) => {
  await expect(app.page.getByText(/Used in upload prefixes and object keys as/)).toContainText(
    'ada-lovelace',
  );
});

Then('each new batch starts with that identity already filled in on the Assign step', async ({ app }) => {
  await app.gotoSection('New upload');
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
  await app.continueToAssign();
  await app.waitForCollections();
  await expect(app.page.getByPlaceholder(identityField)).toHaveValue('Ada Lovelace');
});

// --- disconnecting from Settings -------------------------------------------

Given('there are no unfinished uploads on this machine', async ({ app }) => {
  await produceCompleteRun(app);
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].completedAt).toBeTruthy();
});

Given('there are unfinished uploads recorded on this machine', async ({ app }) => {
  await producePartialRun(app);
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].completedAt).toBeUndefined();
});

When('"Disconnect \\/ edit" is chosen', async ({ app }) => {
  await app.gotoSection('Settings');
  await app.page.getByRole('button', { name: 'Disconnect / edit' }).click();
});

Then('the connection is ended', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible({ timeout: 30_000 });
});

Then("this browser's recorded upload sessions, file states and metadata are cleared", async ({ app }) => {
  expect(await app.readBatchRecords()).toHaveLength(0);
  expect(await app.readFileRecords()).toHaveLength(0);
  expect(await app.readBundleRecords()).toHaveLength(0);
});

Then('the tool returns to the connection screen ready for the next person', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible();
  // The secret key is never kept on disk — it always starts blank.
  // Endpoint and access key may be pre-filled if "Remember me" was checked.
  await expect(app.page.locator('#secretKey')).toHaveValue('');
});

Then('the tool states how many resumable uploads would be lost', async ({ app }) => {
  await expect(app.page.getByRole('heading', { name: 'Unfinished uploads' })).toBeVisible();
  await expect(app.page.getByText(/You have 1 resumable upload in this browser\./)).toBeVisible();
});

Then(
  'it offers to review them in History, to cancel, or to discard them and disconnect',
  async ({ app }) => {
    await expect(app.page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Review uploads' })).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Discard & disconnect' })).toBeVisible();
  },
);

Then('nothing is cleared unless discarding is explicitly chosen', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Cancel' }).click();
  await expect(app.page.getByRole('heading', { name: 'Unfinished uploads' })).toHaveCount(0);
  expect(await app.readBatchRecords()).toHaveLength(1);
  await expect(app.page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();

  await app.page.getByRole('button', { name: 'Disconnect / edit' }).click();
  await app.page.getByRole('button', { name: 'Discard & disconnect' }).click();
  await expect(app.connectForm()).toBeVisible({ timeout: 30_000 });
  expect(await app.readBatchRecords()).toHaveLength(0);
});

// --- disconnecting from the header -----------------------------------------

When('the Disconnect button in the header is used', async ({ app }) => {
  await producePartialRun(app);
  app.notes.batchesBefore = await app.readBatchRecords();
  await app.disconnectFromHeader();
});

Then('the connection is ended and the in-progress batch is cleared', async ({ app }) => {
  await expect(app.connectForm()).toBeVisible();
  await app.fillConnection();
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await app.expectStep('Files');
  await expect(app.page.getByText('Drop a folder of media')).toBeVisible();
});

Then("this machine's recorded upload sessions are left in place", async ({ app }) => {
  const after = await app.readBatchRecords();
  expect(after).toHaveLength((app.notes.batchesBefore as unknown[]).length);
  expect(after).toHaveLength(1);
  expect(await app.readFileRecords()).toHaveLength(4);
});

Then('they are still listed in History after connecting again', async ({ app }) => {
  await app.gotoSection('History');
  await expect(app.page.getByText('open', { exact: true })).toBeVisible();
  await expect(app.page.getByText(/4 files · .* · 3 done · 1 failed/)).toBeVisible();
});

// --- what Settings shows ---------------------------------------------------

Then('Settings shows the endpoint and region currently connected to', async ({ app }) => {
  await app.gotoSection('Settings');
  await expect(app.page.getByText(/^Connected to/)).toContainText(S3_ORIGIN);
  await expect(app.page.getByText(/^Connected to/)).toContainText('us-east-1');
});

Then('it never shows the secret key', async ({ app }) => {
  expect(await app.page.innerText('body')).not.toContain(SECRET_KEY);
  await expect(app.page.locator('input[type="password"]')).toHaveCount(0);
});

// --- appearance ------------------------------------------------------------

When('the appearance is switched between light and dark', async ({ app }) => {
  await expect(app.page.locator('html')).not.toHaveClass(/dark/);
  await app.page.getByRole('button', { name: 'Switch to dark' }).click();
  await expect(app.page.locator('html')).toHaveClass(/dark/);
});

Then('the choice survives a page reload', async ({ app }) => {
  await app.reopen();
  await expect(app.page.locator('html')).toHaveClass(/dark/);
});

Then("it is kept where the other SPARC'd tools on this machine read it", async ({ app }) => {
  // One key for every tool on this origin, so walking to another one from the
  // brand switcher lands in the same appearance.
  expect(await app.page.evaluate(() => localStorage.getItem('sparcd-theme'))).toBe('dark');
});
