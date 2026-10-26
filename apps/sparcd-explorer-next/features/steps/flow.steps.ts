// Sign in, choose collections, open them, and share the session across tabs.

import type { Page } from '@playwright/test';
import { ALPHA, BRAVO, CHARLIE, NEW_UPLOAD, addUpload, uploadPrefix } from './support/data';
import { installS3Mock } from './support/s3mock';
import {
  APP_URL,
  Given,
  Then,
  When,
  collectionBox,
  expect,
  openCollections,
  photoCount,
  signIn,
  signedIn,
} from './support/world';

const COLLECTIONS: Record<string, { uuid: string }> = { 'Alpha Basin': ALPHA, 'Bravo Flats': BRAVO, 'Charlie Pond': CHARLIE };
const openButton = (page: Page) => page.locator('.choose-foot .bigbtn');
const continueButton = (page: Page) => page.getByRole('button', { name: /^Continue with/ });

// --- Sign in ------------------------------------------------------------------

When('I open the explorer', async ({ page }) => {
  await page.goto(APP_URL);
});

Then('I see step {int} {string} of the three steps', async ({ page }, n: number, label: string) => {
  const steps = page.getByRole('list', { name: 'Steps' });
  await expect(steps.locator('li')).toHaveText([/Sign in/, /Choose collections/, /Explore/]);
  await expect(steps.locator('li[aria-current="step"]')).toHaveText(new RegExp(`${n}\\s*${label}`));
});

Then('the sign-in form asks for {string} and {string}', async ({ page }, user: string, password: string) => {
  await expect(page.getByLabel(user, { exact: true })).toBeVisible();
  await expect(page.getByLabel(password, { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByText('Access key', { exact: true })).toHaveCount(0);
});

Then('the server field reads {string} with the example {string}', async ({ page }, label: string, example: string) => {
  await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('placeholder', example);
  await expect(page.getByText('Endpoint', { exact: true })).toHaveCount(0);
});

Then("the form's button reads {string}", async ({ page }, label: string) => {
  await expect(page.locator('form button[type="submit"]')).toHaveText(label);
});

Then('the HTTPS setting is only under {string}', async ({ page }, advanced: string) => {
  await expect(page.getByText('Secure (HTTPS)')).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(advanced) }).click();
  await expect(page.getByText('Secure (HTTPS)')).toBeVisible();
});

Given('the store does not know the username {string}', async ({ s3 }, name: string) => {
  s3.rejectedKeys.add(name);
});

When('I sign in as {string}', async ({ page }, name: string) => {
  await signIn(page, name);
});

Then('I see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
});

Then('I no longer see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: false }).filter({ visible: true })).toHaveCount(0);
});

Then('I am still on the sign-in step', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose collections' })).toHaveCount(0);
});

Given('I am signed in', async ({ page }) => {
  await signedIn(page);
});

When('I sign out', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign out' }).click();
});

// --- Choose -------------------------------------------------------------------

Then('the open button reads {string} and is disabled', async ({ page }, label: string) => {
  await expect(openButton(page)).toHaveText(label);
  await expect(openButton(page)).toBeDisabled();
});

Then('the open button reads {string}', async ({ page }, label: string) => {
  await expect(openButton(page)).toHaveText(label);
  await expect(openButton(page)).toBeEnabled();
});

When('I tick {string}', async ({ page }, name: string) => {
  await collectionBox(page, name).check();
});

When('I click the row of {string}', async ({ page }, name: string) => {
  await page.locator('.coll-row .nm', { hasText: name }).click();
});

When('I press the open button', async ({ page }) => {
  await openButton(page).click();
});

Given('I have opened {string}', async ({ page }, name: string) => {
  await openCollections(page, name);
});

When('I open {string}', async ({ page }, name: string) => {
  await openCollections(page, name);
});

When('I open {string} and {string} together', async ({ page }, a: string, b: string) => {
  await collectionBox(page, a).check();
  await collectionBox(page, b).check();
  await openButton(page).click();
});

When('I go back to choose collections', async ({ page }) => {
  await page.getByRole('button', { name: /^Change collections?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
});

Then('{string} is ticked', async ({ page }, name: string) => {
  await expect(collectionBox(page, name)).toBeChecked();
});

Then('there is no {string} button', async ({ page }, label: string) => {
  await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveCount(0);
});

When('I clear the picked collections', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear picked collections' }).click();
});

Then('I see the button {string}', async ({ page }, label: string) => {
  await expect(continueButton(page)).toBeVisible();
  await expect(continueButton(page)).toContainText(label);
});

// --- Open ---------------------------------------------------------------------

Then('the header names {string}', async ({ page }, name: string) => {
  await expect(page.locator('h1.collname')).toHaveText(name);
});

Then('the header offers {string}', async ({ page }, label: string) => {
  await expect(page.locator('header').getByRole('button', { name: label })).toBeVisible();
});

Given('reading {string} is slow', async ({ s3 }, name: string) => {
  s3.delays.set(`Collections/${COLLECTIONS[name].uuid}/Uploads/`, 4000);
});

Given('the uploads of {string} can\'t be listed', async ({ s3 }, name: string) => {
  s3.failures.set(`Collections/${COLLECTIONS[name].uuid}/Uploads/`, { status: 403, code: 'AccessDenied' });
});

Given('the photo list of the first {string} upload can\'t be read', async ({ s3 }, name: string) => {
  s3.failures.set(`${uploadPrefix(COLLECTIONS[name], '2023.05.01.10.00.00_fielduser')}media.csv`, {
    status: 403,
    code: 'AccessDenied',
  });
});

Then('I see the steps {string}, {string} and {string}', async ({ page }, a: string, b: string, c: string) => {
  await expect(page.locator('.steps li')).toHaveText([new RegExp(a), new RegExp(b), new RegExp(c)]);
});

When('I cancel opening', async ({ page }) => {
  await page.getByRole('button', { name: 'Cancel' }).click();
});

Then('I am back at the list with {string} ticked', async ({ page }, name: string) => {
  await expect(page.getByRole('list', { name: 'Collections' })).toBeVisible();
  await expect(collectionBox(page, name)).toBeChecked();
});

Then('I can go back to the list', async ({ page }) => {
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.getByRole('list', { name: 'Collections' })).toBeVisible();
});

Then('{string} is marked {string}', async ({ page }, name: string, badge: string) => {
  await expect(page.locator('.coll-row', { hasText: name })).toContainText(badge);
});

When('I reopen {string}', async ({ page, s3, scratch }, name: string) => {
  scratch.reads = s3.readCount(`${uploadPrefix(COLLECTIONS[name], '2023.05.01.10.00.00_fielduser')}media.csv`);
  scratch.collection = name;
  await openButton(page).click();
  await expect(page.locator('#sticky-top')).toBeVisible();
});

Then('the workspace shows without reading the photo lists again', async ({ page, s3, scratch }) => {
  await expect(page.locator('.updated')).toHaveText(/Updated/);
  const key = `${uploadPrefix(COLLECTIONS[scratch.collection as string], '2023.05.01.10.00.00_fielduser')}media.csv`;
  expect(s3.readCount(key)).toBe(scratch.reads);
});

When('a new upload arrives in {string}', async ({ s3 }, name: string) => {
  addUpload(s3, COLLECTIONS[name], NEW_UPLOAD);
});

When('I check for new uploads', async ({ page }) => {
  await page.getByRole('button', { name: 'Check for new uploads' }).click();
});

Then('the header says {string}', async ({ page }, text: string) => {
  await expect(page.locator('.updated')).toHaveText(text);
});

Then('the photo count reads {string}', async ({ page }, text: string) => {
  await expect(photoCount(page)).toHaveText(text);
});

// --- Tabs -----------------------------------------------------------------------

When('I open the explorer in a new tab', async ({ context, s3, scratch }) => {
  const second = await context.newPage();
  await installS3Mock(second, s3);
  await second.goto(APP_URL);
  scratch.second = second;
});

Given('the explorer is open in a second tab', async ({ context, s3, scratch }) => {
  const second = await context.newPage();
  await installS3Mock(second, s3);
  await second.goto(APP_URL);
  await expect(second.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
  scratch.second = second;
});

When('I sign out and sign in as {string} in the second tab', async ({ scratch }, name: string) => {
  const second = scratch.second as Page;
  await second.getByRole('button', { name: 'Sign out' }).click();
  await signIn(second, name);
  await expect(second.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
});

// What a tab that stays open on an old sign-in would send when asked.
Given('another tab holds on to this sign-in', async ({ page, context, scratch }) => {
  scratch.oldSignIn = await page.evaluate(() => {
    const { __sparcdRevision: _, ...config } = JSON.parse(sessionStorage.getItem('sparcd-connection-tab')!);
    return { ...JSON.parse(localStorage.getItem('sparcd-connection-revision')!), type: 'connect', config };
  });
  const stale = await context.newPage();
  await stale.route('**/stale-tab', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Stale tab</title>' }));
  await stale.goto(new URL('/stale-tab', page.url()).href);
  scratch.stale = stale;
});

When('I sign out and sign in as {string}', async ({ page }, name: string) => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, name);
  await expect(page.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
});

// The barrier arrives after the old sign-in, so hearing it means this tab has handled it.
When('the other tab sends its old sign-in', async ({ page, scratch }) => {
  await page.evaluate(() => {
    const channel = new BroadcastChannel('sparcd-connection-live');
    (window as unknown as { heard: Promise<void> }).heard = new Promise((resolve) =>
      channel.addEventListener('message', (e) => e.data?.type === 'test-barrier' && resolve()),
    );
  });
  await (scratch.stale as Page).evaluate((old) => {
    const channel = new BroadcastChannel('sparcd-connection-live');
    channel.postMessage(old);
    channel.postMessage({ type: 'test-barrier' });
    channel.close();
  }, scratch.oldSignIn);
  await page.evaluate(() => (window as unknown as { heard: Promise<void> }).heard);
});

When('I reload the page', async ({ page }) => {
  await page.reload();
});

async function showsChooserFor(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Choose collections' })).toBeVisible();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
  await expect(page.locator('#sticky-top')).toHaveCount(0);
}

Then('this tab shows {string} for {string}', async ({ page }, _heading: string, name: string) => {
  await showsChooserFor(page, name);
});

Then(
  'once the slow read has had time to finish, this tab still shows {string} for {string}',
  async ({ page }, _heading: string, name: string) => {
    await page.waitForTimeout(4500);
    await showsChooserFor(page, name);
  },
);

Then('nothing was remembered for {string}', async ({ page }, name: string) => {
  const remembered = await page.evaluate(
    (who) => Object.keys(localStorage).filter((k) => k.startsWith('sparcd-explorer-last:') && k.endsWith(`|${who}`)),
    name,
  );
  expect(remembered).toEqual([]);
});

Then('the new tab shows {string} without asking for a password', async ({ scratch }, heading: string) => {
  const second = scratch.second as Page;
  await expect(second.getByRole('heading', { name: heading })).toBeVisible();
  await expect(second.locator('#secretKey')).toHaveCount(0);
});

Then('the second tab shows the sign-in step', async ({ scratch }) => {
  const second = scratch.second as Page;
  await expect(second.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
