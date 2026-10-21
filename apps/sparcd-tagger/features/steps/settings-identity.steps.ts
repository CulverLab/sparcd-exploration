import { fileURLToPath } from 'node:url';
import { parseObservations } from '@sparcd/camtrap';
import { Given, Then, expect, sectionTab, openSettings, gridCell, speciesApply, focusFrame, APP_URL } from './support/world';
import { runLiveSync, readStore } from './support/flows';
import { installS3Mock } from './support/s3mock';
import { BUCKET, PREFIX_A } from './support/data';

const base = '/sparcd-exploration/tagger/';
const source = (path: string) => `${base}@fs${fileURLToPath(new URL(path, import.meta.url))}`;
const storeUrl = source('../../src/store.ts');
const identityUrl = source('../../../../packages/auth-ui/src/loginIdentity.ts');

Given('the account-name service returns Alice Researcher', async ({ page }) => {
  await page.route('**/-/whoami', route => route.fulfill({ json: { id: 'person-alice', name: 'Alice Researcher' } }));
});
Given('the account-name service fails with {string}', async ({ page }, failure: string) => {
  await page.route('**/-/whoami', async route => {
    if (failure === 'network') { await route.abort(); return; }
    const status = ({ forbidden: 403, signature: 403, malformed: 200, rate: 429, server: 503, 'rate-absence': 429, 'server-absence': 503 } as Record<string, number>)[failure];
    await route.fulfill({ status, body: failure.endsWith('-absence') ? '<Error><Code>NoSuchKey</Code></Error>' : failure === 'signature' ? '<Error><Code>SignatureDoesNotMatch</Code></Error>' : 'unexpected response' });
  });
});
Then('Settings has the required section order and disconnect guidance', async ({ page }) => {
  const labels = await page.locator('main section > label:first-child, main section > span:first-child').allTextContents();
  expect(labels.map(label => label.trim())).toEqual(['Tagger Identity', 'Auto-advance', 'Date format', 'Time format', 'Distance units', 'Sync default', 'Burst grouping', 'Connection']);
  const preferences = page.getByRole('group', { name: 'Sync and burst preferences', exact: true });
  await expect(preferences).toHaveClass(/border-t/);
  await expect(preferences.getByText('Sync default', { exact: true })).toBeVisible();
  await preferences.getByLabel('Group rapid sequences into bursts').check();
  await expect(preferences.locator('#burst')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveAccessibleDescription("Clears this browser's local Tagger data and logs you out. Remembered connection details remain. Disconnect before leaving a shared or public computer.");
});
Then('the reordered Settings controls remain usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 860 });
  await page.locator('#user').fill('Phone Researcher');
  await page.locator('#user').press('Tab');
  await expect(page.getByLabel('Move to the next image after assigning a species')).toBeFocused();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/settings551-phone.png', fullPage: true });
});
Then('the identity uses the resolved name and preserves a custom name across reload', async ({ page }) => {
  await expect(page.locator('#user')).toHaveValue('Alice Researcher');
  await expect(page.getByLabel('Connected Access key')).toHaveText('tes…key');
  await page.reload(); await openSettings(page);
  await expect(page.locator('#user')).toHaveValue('Alice Researcher');
  await page.locator('#user').fill('Custom Alice'); await page.locator('#user').blur();
  await page.reload(); await openSettings(page);
  await expect(page.locator('#user')).toHaveValue('Custom Alice');
});
Then('clearing the identity preserves blank input until blur and restores the account name', async ({ page }) => {
  await expect(page.locator('#user')).toHaveValue('Alice Researcher');
  await page.locator('#user').fill('Custom Alice'); await page.locator('#user').fill('   ');
  await expect(page.locator('#user')).toHaveValue('   ');
  await page.locator('#user').press('Tab');
  await expect(page.locator('#user')).toHaveValue('Alice Researcher');
});
Then('missing attribution prevents mouse keyboard drag and write actions', async ({ page, s3 }) => {
  await expect(page.getByRole('button', { name: 'Set Tagger identity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply Coyote', exact: true })).toBeDisabled();
  await focusFrame(page, 'IMG001.JPG');
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
  // Unresolved attribution removes the count/removal editors and disables
  // re-applying the canonical species (the review/confirmation entry point).
  await expect(page.getByRole('spinbutton', { name: 'Count for Mule Deer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Mule Deer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear Species', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Mule Deer Odocoileus hemionus/ })).toBeDisabled();
  await page.keyboard.press('d');
  await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
  await focusFrame(page, 'IMG002.JPG'); await page.keyboard.press('d'); await page.keyboard.press('p');
  const drag = await page.evaluateHandle(() => new DataTransfer());
  await drag.evaluate(data => data.setData('application/x-sparcd-species', JSON.stringify({ scientificName: 'Canis latrans', commonName: 'Coyote', count: 1 })));
  await gridCell(page, 'IMG002.JPG').dispatchEvent('drop', { dataTransfer: drag });
  await page.keyboard.press('ArrowDown'); await expect(gridCell(page, 'IMG003.JPG')).toHaveAttribute('aria-current', 'true');
  expect((await readStore(page, 'drafts')).filter((draft: any) => draft.dirty)).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Sync…', exact: true })).toBeDisabled();
  const errors = await page.evaluate(async url => {
    const { performSync, performRestore } = await import(/* @vite-ignore */ url);
    return Promise.all([performSync, performRestore].map(async fn => {
      try { await fn({ user: 'forged actor' }); return ''; } catch (error) { return String(error); }
    }));
  }, source('../../src/lib/syncRunner.ts'));
  expect(errors.every(error => error.includes('Enter a Tagger identity'))).toBe(true);
  expect(s3.puts).toHaveLength(0);
});
Then('entering a custom identity enables tagging despite the lookup error', async ({ page }) => {
  await page.getByRole('button', { name: 'Set Tagger identity', exact: true }).click();
  await expect(page.locator('#user')).toHaveValue(''); await page.locator('#user').fill('Explicit Identifier'); await page.locator('#user').blur();
  await expect(page.getByRole('button', { name: 'Retry account-name lookup', exact: true })).toBeVisible();
  await page.getByLabel('Move to the next image after assigning a species').uncheck();
  await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG001.JPG');
  const count = page.getByRole('spinbutton', { name: 'Count for Mule Deer', exact: true });
  await expect(count).toHaveValue('2');
  await count.fill('3'); await expect(count).toHaveValue('3');
  await expect(page.getByLabel(/^Reviewed by Explicit Identifier at/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove Mule Deer', exact: true }).click();
  await expect(count).toHaveCount(0);
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click(); await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});
Then('the real Uploader Settings and Tagger share edits in both directions', async ({ page, context, s3 }) => {
  await expect(page.locator('#user')).toHaveValue('Alice Researcher');
  const sibling = await context.newPage(); await installS3Mock(sibling, s3);
  await sibling.route('**/-/whoami', route => route.fulfill({ json: { id: 'alice', name: 'Alice Researcher' } }));
  await sibling.goto(APP_URL); await expect(sectionTab(sibling, 'Browse')).toBeVisible();
  let reloads = 0;
  sibling.on('framenavigated', frame => { if (frame === sibling.mainFrame()) reloads++; });
  // Mount the production Uploader Settings with its real store in this same-origin
  // sibling. The Tagger Vite harness serves both workspace source modules.
  await sibling.evaluate(async ({ settings, uploader, react, dom }) => {
    const reactModule = await import(/* @vite-ignore */ react);
    const React = reactModule.default ?? reactModule;
    const domModule = await import(/* @vite-ignore */ dom);
    const { createRoot } = domModule.default ?? domModule;
    const { Settings } = await import(/* @vite-ignore */ settings);
    const { useStore } = await import(/* @vite-ignore */ uploader);
    useStore.getState().ensureUploaderIdentity();
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); document.body.append(host);
    createRoot(host).render(React.createElement(Settings));
  }, { settings: source('../../../sparcd-uploader/src/sections/Settings.tsx'), uploader: source('../../../sparcd-uploader/src/store.ts'), react: `${base}node_modules/.vite/deps/react.js`, dom: `${base}node_modules/.vite/deps/react-dom_client.js` });
  await sibling.getByText('Defaults', { exact: true }).click();
  const uploader = sibling.locator('#uploader-identity'); await expect(uploader).toHaveValue('Alice Researcher');
  expect(reloads).toBe(0);
  await uploader.fill('   ');
  // A shared default update and a successful lookup must not replace active input.
  await page.evaluate(async url => {
    const { saveLoginIdentityDefault } = await import(/* @vite-ignore */ url);
    saveLoginIdentityDefault('testkey', 'Alice Updated In Tagger', 'whoami');
  }, identityUrl);
  await sibling.evaluate(async url => { const { useStore } = await import(/* @vite-ignore */ url); await useStore.getState().refreshUploaderIdentity(); }, source('../../../sparcd-uploader/src/store.ts'));
  await expect(uploader).toHaveValue('   '); await uploader.blur();
  await expect(uploader).toHaveValue('Alice Researcher');
  await sibling.route('**/-/whoami', route => route.fulfill({ json: { id: 'alice', name: 'Renamed Alice' } }));
  await sibling.evaluate(async url => {
    const { useStore } = await import(/* @vite-ignore */ url);
    await useStore.getState().refreshUploaderIdentity();
  }, source('../../../sparcd-uploader/src/store.ts'));
  await expect(page.locator('#user')).toHaveValue('Renamed Alice');
  await uploader.fill('Uploader Custom'); await uploader.blur(); await expect(page.locator('#user')).toHaveValue('Uploader Custom');
  await page.locator('#user').fill('Tagger Custom'); await page.locator('#user').blur(); await expect(uploader).toHaveValue('Tagger Custom');
  await page.evaluate(async url => {
    const { saveLoginIdentity } = await import(/* @vite-ignore */ url);
    saveLoginIdentity('otherkey', 'Other Login');
  }, identityUrl);
  const uploaderStore = source('../../../sparcd-uploader/src/store.ts');
  await sibling.evaluate(async url => {
    const { useStore } = await import(/* @vite-ignore */ url);
    useStore.getState().connect({ ...useStore.getState().s3Config, accessKey: 'otherkey' }, false);
  }, uploaderStore);
  await expect(page.locator('#user')).toHaveValue('Other Login');
  await expect(uploader).toHaveValue('Other Login');
  await page.locator('#user').fill('Other Login Edited'); await page.locator('#user').blur();
  await expect(uploader).toHaveValue('Other Login Edited');
  await sibling.evaluate(async url => {
    const { useStore } = await import(/* @vite-ignore */ url);
    useStore.getState().connect({ ...useStore.getState().s3Config, accessKey: 'testkey' }, false);
  }, uploaderStore);
  await expect(page.locator('#user')).toHaveValue('Tagger Custom');
  await expect(uploader).toHaveValue('Tagger Custom');
  await page.reload(); await openSettings(page); await expect(page.locator('#user')).toHaveValue('Tagger Custom');
  expect(reloads).toBe(0);
  await sibling.close();
});
Then('actions under successive custom identities retain their attribution after sync', async ({ page, s3 }) => {
  await openSettings(page); await page.locator('#user').fill('Actor A'); await page.locator('#user').blur();
  await page.getByLabel('Move to the next image after assigning a species').uncheck(); await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click();
  await openSettings(page); await page.locator('#user').fill('Actor B'); await page.locator('#user').blur(); await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG005.JPG'); await speciesApply(page, 'Puma concolor').click();
  await focusFrame(page, 'IMG004.JPG'); await speciesApply(page, 'Puma concolor').click();
  await runLiveSync(page);
  const observations = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  expect(observations.find(o => o.mediaId.endsWith('IMG002.JPG') && o.scientificName === 'Canis latrans')?.classifiedBy).toBe('Actor A');
  expect(observations.find(o => o.mediaId.endsWith('IMG005.JPG') && o.scientificName === 'Puma concolor')?.classifiedBy).toBe('Actor B');
  const reviewed = observations.find(o => o.mediaId.endsWith('IMG004.JPG') && o.scientificName === 'Puma concolor');
  expect(reviewed?.classifiedBy).toBe('jdoe');
  expect(reviewed?.reviewEvents?.at(-1)?.reviewedBy).toBe('Actor B');
});
Then('a rejected identity preference write preserves the typed identity through retry', async ({ page }) => {
  await expect(page.locator('#user')).toHaveValue('Alice Researcher');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('sparcd-login-identity-')) throw new DOMException('quota', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.locator('#user').fill('Unsaved Name'); await page.locator('#user').blur();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await page.evaluate(async url => { const { useStore } = await import(/* @vite-ignore */ url); await useStore.getState().refreshTaggerIdentity(); }, storeUrl);
  await expect(page.locator('#user')).toHaveValue('Unsaved Name'); await expect(page.getByRole('alert')).toContainText('could not be saved');
});
