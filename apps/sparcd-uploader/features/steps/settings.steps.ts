import { Given, When, Then, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ACCESS_KEY, S3_ORIGIN, SECRET_KEY } from './app';
import { standardBatch } from './batches';
import { produceCompleteRun, producePartialRun } from './helpers';

const identityField = 'e.g. John Doe';
const LOGIN_B = 'AKIATESTKEY0002';

async function openIdentityInput(page: Page) {
  const defaults = page.getByText('Defaults', { exact: true });
  const isOpen = await defaults.evaluate((element) => element.closest('details')?.open ?? false);
  if (!isOpen) await defaults.click();
  return page.getByPlaceholder(identityField);
}

async function identityInput(app: import('./app').App) {
  await app.gotoSection('Settings');
  return openIdentityInput(app.page);
}

async function connectAs(app: import('./app').App, login: string) {
  await app.disconnectFromHeader();
  await expect(app.connectForm()).toBeVisible();
  await app.fillConnection({ accessKey: login });
  await app.page.getByLabel('Remember endpoint & access key on this device').check();
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Logout' })).toBeVisible();
}

// --- the default identity --------------------------------------------------

When('an uploader identity is entered in Settings', async ({ app }) => {
  await app.gotoSection('Settings');
  await app.page.getByText('Defaults', { exact: true }).click();
  await app.page.getByPlaceholder(identityField).fill('Ada Lovelace');
});

When('Login A saves custom identity {string} and reloads', async ({ app }, identity: string) => {
  const input = await identityInput(app);
  await input.fill(identity);
  await input.press('Tab');
  await app.reopen();
  await expect(await identityInput(app)).toHaveValue(identity);
});

When('the Uploader switches to Login B', async ({ app }) => {
  await connectAs(app, LOGIN_B);
});

Then("Login B's identity defaults to the confirmed endpoint fallback", async ({ app }) => {
  await expect(await identityInput(app)).toHaveValue(LOGIN_B);
  expect(app.s3.whoamiResponse.body).toContain('<Code>InvalidBucketName</Code>');
});

When('Login B saves custom identity {string}', async ({ app }, identity: string) => {
  const input = await identityInput(app);
  await input.fill(identity);
  await input.press('Tab');
});

When('the Uploader switches back to Login A', async ({ app }) => {
  await connectAs(app, ACCESS_KEY);
});

Then("Login A's custom identity is restored", async ({ app }) => {
  await expect(await identityInput(app)).toHaveValue('Ada Lovelace');
});

Then("Login B's custom identity is restored", async ({ app }) => {
  await expect(await identityInput(app)).toHaveValue('Grace Hopper');
});

When('a second Uploader tab adopts the same login', async ({ app }) => {
  app.notes.identitySecondTab = await app.openSecondTab();
  const second = app.notes.identitySecondTab as import('@playwright/test').Page;
  await expect(second.getByRole('button', { name: 'Logout' })).toBeVisible();
});

Then("the second tab shows Login A's custom identity", async ({ app }) => {
  const second = app.notes.identitySecondTab as import('@playwright/test').Page;
  await second.locator('nav[aria-label="Sections"]').getByRole('button', { name: 'Settings' }).click();
  await expect(await openIdentityInput(second)).toHaveValue('Ada Lovelace');
});

When('the second tab changes Login A\'s identity to {string}', async ({ app }, identity: string) => {
  const second = app.notes.identitySecondTab as import('@playwright/test').Page;
  const input = await openIdentityInput(second);
  await input.fill(identity);
  await input.press('Tab');
});

Then('the first tab shows Login A\'s updated identity', async ({ app }) => {
  await expect(await identityInput(app)).toHaveValue('Grace Hopper');
  const second = app.notes.identitySecondTab as import('@playwright/test').Page;
  await second.close();
});

When('the Uploader identity field is cleared', async ({ app }) => {
  const input = await identityInput(app);
  await input.fill('');
});

Then('the field remains blank while it is being edited', async ({ app }) => {
  await expect(app.page.getByPlaceholder(identityField)).toHaveValue('');
});

When('the blank Uploader identity field loses focus', async ({ app }) => {
  await app.page.getByPlaceholder(identityField).press('Tab');
});

Then('the tool shows the key-safe form of it that will appear in upload paths', async ({ app }) => {
  await expect(app.page.getByText(/Used in upload prefixes and object keys as/)).toContainText(
    'ada-lovelace',
  );
});

Then('each new batch starts with that identity already filled in on the Describe step', async ({ app }) => {
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
  app.notes.settingsDisconnectReloads = true;
});

Given('there are unfinished uploads recorded on this machine', async ({ app }) => {
  await producePartialRun(app);
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].completedAt).toBeUndefined();
});

When('"Disconnect" is chosen', async ({ app }) => {
  await app.gotoSection('Settings');
  await app.page.getByText('Defaults', { exact: true }).click();
  const click = () => app.page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  // The connection gate appears before asynchronous storage cleanup and reload.
  // Register the load listener before the action that initiates the reload.
  if (app.notes.settingsDisconnectReloads) await Promise.all([app.page.waitForEvent('load'), click()]);
  else await click();
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

  await app.page.getByRole('button', { name: 'Disconnect' }).click();
  await Promise.all([
    app.page.waitForEvent('load'),
    app.page.getByRole('button', { name: 'Discard & disconnect' }).click(),
  ]);
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
  await app.expectStep('Choose');
  await expect(app.page.getByText('Drop a folder to upload')).toBeVisible();
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
  await app.page.getByText('Defaults', { exact: true }).click();
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

When('Disconnect is chosen after reviewing its security explanation', async ({ app }) => {
  await app.gotoSection('Settings');
  const button = app.page.getByRole('button', { name: 'Disconnect', exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  const explanation = "Clears this browser’s local upload sessions, saved preparations and prepared species. Originals and files already in S3 are unchanged. Remembered connection details remain. Disconnect before leaving a shared or public computer.";
  await expect(app.page.locator('#settings-disconnect-help')).toHaveText(explanation);
  await expect(button).toHaveAccessibleDescription(explanation);
  const remembered = await app.page.evaluate(() => JSON.parse(localStorage.getItem('sparcd-connection')!));
  expect(remembered).toMatchObject({ endpoint: S3_ORIGIN, accessKey: ACCESS_KEY, region: 'us-east-1' });
  expect(remembered).not.toHaveProperty('secretKey');
  app.notes.rememberedBeforeDisconnect = remembered;
  // Settings deliberately reloads after clearing IndexedDB. Wait for that
  // reload, rather than inspecting the briefly visible gate in the old page.
  await Promise.all([
    app.page.waitForEvent('load'),
    button.press('Enter'),
  ]);
});

Then('remembered non-secret connection details remain with no live session', async ({ app }) => {
  const state = await app.page.evaluate(() => ({
    remembered: JSON.parse(localStorage.getItem('sparcd-connection')!),
    session: sessionStorage.getItem('sparcd-connection-tab'),
  }));
  expect(state.remembered).toEqual(app.notes.rememberedBeforeDisconnect);
  expect(state.remembered).not.toHaveProperty('secretKey');
  expect(state.session).toBeNull();
  await expect(app.page.locator('#endpoint')).toHaveValue(S3_ORIGIN);
  await expect(app.page.locator('#accessKey')).toHaveValue(ACCESS_KEY);
  await app.page.getByRole('button', { name: '+ Advanced', exact: true }).click();
  await expect(app.page.locator('#region')).toHaveValue('us-east-1');
  await expect(app.page.locator('#secretKey')).toHaveValue('');
  await expect(app.page.getByRole('button', { name: 'Logout', exact: true })).toHaveCount(0);
});

const disclosure = (page: import('@playwright/test').Page, name: string) => page.locator('details').filter({ has: page.locator('summary', { hasText: name }) });

When('the settings disclosures are exercised', async ({ app }) => {
  await app.gotoSection('Settings');
  for (const name of ['Defaults', 'Advanced']) {
    const section = disclosure(app.page, name);
    await expect(section).toHaveJSProperty('open', false);
    await section.locator('summary').focus();
    await section.locator('summary').press(name === 'Defaults' ? 'Enter' : 'Space');
    await expect(section).toHaveJSProperty('open', true);
  }
  await expect(disclosure(app.page, 'Defaults').getByRole('radio')).toHaveCount(0);
  await expect(disclosure(app.page, 'Defaults').getByPlaceholder(identityField)).toHaveValue(ACCESS_KEY);
  await app.concurrencyModeRadio('Manual').check();
  await app.page.getByLabel('Parallel lanes').fill('12');
});
Then('their preferences survive reopening with both disclosures collapsed', async ({ app }) => {
  await app.gotoSection('New upload');
  await app.gotoSection('Settings');
  for (const name of ['Defaults', 'Advanced']) await expect(disclosure(app.page, name)).toHaveJSProperty('open', false);
  await app.page.getByText('Advanced', { exact: true }).click();
  await expect(app.concurrencyModeRadio('Manual')).toBeChecked();
  await expect(app.page.getByLabel('Parallel lanes')).toHaveValue('12');
});
When('identity is cleared, typed, and left blank', async ({ app }) => {
  await app.gotoSection('Settings');
  await app.page.getByText('Defaults', { exact: true }).click();
  const input = app.page.getByPlaceholder(identityField);
  await expect(input).toHaveValue(ACCESS_KEY);
  await input.fill('');
  await expect(input).toHaveValue('');
  await input.pressSequentially('Ada');
  await input.press('Tab');
  await expect(input).toHaveValue('Ada');
  await input.fill('   ');
  await expect(input).toHaveValue('   ');
});
Then('the account default returns on blur', async ({ app }) => {
  const input = app.page.getByPlaceholder(identityField);
  await input.press('Tab');
  await expect(input).toHaveValue(ACCESS_KEY);
  expect(await app.page.locator('header').evaluate((element) => element.outerHTML)).not.toContain(ACCESS_KEY);
  // Return to New upload so the existing settings helper expands a fresh panel.
  await app.gotoSection('New upload');
});
When('the custom identity is reloaded', async ({ app }) => {
  await app.reopen();
  await app.gotoSection('Settings');
  await app.page.getByText('Defaults', { exact: true }).click();
});
Then('the custom identity is preserved', async ({ app }) => {
  await expect(app.page.getByPlaceholder(identityField)).toHaveValue('Ada Lovelace');
});
When('the blank identity session is restored and shared', async ({ app }) => {
  await app.page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('sparcd-uploader-session')!);
    saved.state.uploaderUser = '   ';
    sessionStorage.setItem('sparcd-uploader-session', JSON.stringify(saved));
  });
  await app.reopen();
  app.notes.identityTab = await app.openSecondTab();
});
Then('both sessions use the confirmed Access-key fallback', async ({ app }) => {
  expect(app.s3.whoamiRequests).toBeGreaterThan(0);
  expect(app.s3.whoamiResponse.body).toContain('<Code>InvalidBucketName</Code>');
  const second = app.notes.identityTab as import('@playwright/test').Page;
  for (const page of [app.page, second]) {
    await page.locator('nav[aria-label="Sections"]').getByRole('button', { name: 'Settings', exact: true }).click();
    await openIdentityInput(page);
    await expect(page.getByPlaceholder(identityField)).toHaveValue(ACCESS_KEY);
    expect(await page.locator('header').evaluate((element) => element.outerHTML)).not.toContain(ACCESS_KEY);
  }
  await second.close();
});

When('expanded settings controls fit on a narrow screen', async ({ app }) => {
  await app.page.setViewportSize({ width: 320, height: 812 });
  const controls = app.page.locator('details summary, details input');
  for (const control of await controls.all()) {
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await app.page.setViewportSize({ width: 1280, height: 720 });
});
