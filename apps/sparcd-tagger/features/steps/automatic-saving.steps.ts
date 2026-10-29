import { parseMedia, MEDIA_COL, parseObservations, parseCsvRows, serializeCsvRows, OBS_COL } from '@sparcd/camtrap';
import { When, Then, expect, focusFrame, speciesApply, openWorkspace, openSettings, openFindFilter, selectedTiles, focusedTile, sectionTab } from './support/world';
import { BUCKET, PREFIX_A, observationsCsv } from './support/data';
const path = `${PREFIX_A}IMG002.JPG`;
const status = (page: import('@playwright/test').Page) => page.getByTestId('automatic-save');
async function saved(page: import('@playwright/test').Page) { await expect(status(page).getByRole('status')).toHaveText('Saved'); }

When('Coyote is applied for automatic saving', async ({ page, s3, scratch }) => {
  scratch.originalMedia = s3.text(BUCKET, `${PREFIX_A}media.csv`);
  scratch.snapshotKeys = s3.keys(BUCKET).filter(key => key.includes('.sparcd-tagger-snapshots/'));
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
});
Then('the Coyote is saved without manual controls or per-edit snapshots', async ({ page, s3, scratch }) => {
  await saved(page);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === path)?.scientificName).toBe('Canis latrans');
  await expect(page.getByRole('button', { name: /^Sync/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Snapshots/ })).toHaveCount(0);
  expect(s3.keys(BUCKET).filter(key => key.includes('.sparcd-tagger-snapshots/'))).toEqual(scratch.snapshotKeys);
  if (scratch.originalMedia) expect(s3.text(BUCKET, `${PREFIX_A}.sparcd-tagger-original/media.csv`)).toBe(scratch.originalMedia);
});
When('the automatically saved upload is reloaded', async ({ page }) => { await page.reload(); await openWorkspace(page); await saved(page); });
When('the latest automatic action is undone', async ({ page }) => {
  await saved(page);
  await page.getByRole('button', { name: 'Undo latest action', exact: true }).click();
  await saved(page);
});
Then('the Coyote addition is reversed and its audit history remains', async ({ page, s3 }) => {
  await saved(page);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path && o.scientificName)).toEqual([]);
  const meta = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`));
  expect(meta.taggerActions).toHaveLength(2); expect(meta.taggerActions[1].undoOf).toBe(meta.taggerActions[0].id);
  await expect(page.getByRole('button', { name: 'Undo latest action', exact: true })).toBeDisabled();
});
When('two species edits straddle an automatic save', async ({ page }) => {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route('**/*', async route => {
    if (!held && route.request().method() === 'PUT' && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}observations.csv`)) {
      held = true; entered(); await gate;
    }
    await route.fallback();
  });
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click();
  await waiting;
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Odocoileus hemionus').click();
  release(); await saved(page);
});
Then('both species edits reach shared storage', async ({ s3 }) => {
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path).map(o => o.scientificName).sort()).toEqual(['Canis latrans', 'Odocoileus hemionus'].sort());
});
When('a completed edit loses connectivity before automatic saving', async ({ page, s3, scratch }) => {
  scratch.snapshotKeys = s3.keys(BUCKET).filter(key => key.includes('.sparcd-tagger-snapshots/'));
  await sectionTab(page, 'Tag').click();
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click();
  await page.context().setOffline(true);
});
Then('further collection edits and Undo are disabled', async ({ page }) => {
  await expect(status(page)).toContainText('Pending/reconnecting');
  await expect(page.getByRole('button', { name: 'Apply Mule Deer', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Undo latest action', exact: true })).toBeDisabled();
});
When('the connection returns', async ({ page }) => { await page.context().setOffline(false); });
When('connectivity changes while Find and the Overview selection are active', async ({ page, s3, scratch }) => {
  await saved(page);
  await sectionTab(page, 'Tag').click();
  await openFindFilter(page);
  await page.getByLabel('Find image', { exact: true }).fill('IMG00');
  await page.getByLabel('Match text', { exact: true }).fill('IMG');
  await expect(page.locator('#image-filter-panel')).toBeVisible();
  // Find navigation clears selection by design. Establish a known multi-
  // selection after Find is active, using the existing selection gesture.
  await page.locator('[data-testid="overview-image"][data-image-name="IMG001.JPG"]').click();
  await page.locator('[data-testid="overview-image"][data-image-name="IMG002.JPG"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedTiles(page)).toHaveCount(2);
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG002.JPG');
  scratch.selectedOffline = await selectedTiles(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-image-name')));
  scratch.findBeforeOffline = await page.getByLabel('Find image', { exact: true }).inputValue();
  scratch.filterBeforeOffline = await page.getByLabel('Match text', { exact: true }).inputValue();
  scratch.putsBeforeOffline = s3.puts.length;
  await page.context().setOffline(true);
  await expect(status(page)).toContainText('Pending/reconnecting');
});
Then('the workspace and Find state survive offline and reconnection without another write', async ({ page, s3, scratch }) => {
  await expect(page.getByTestId('tag-workspace')).toBeVisible();
  await expect(page.locator('#image-filter-panel')).toBeVisible();
  await expect(page.getByLabel('Find image', { exact: true })).toHaveValue(scratch.findBeforeOffline as string);
  await expect(page.getByLabel('Match text', { exact: true })).toHaveValue(scratch.filterBeforeOffline as string);
  expect(await selectedTiles(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-image-name')))).toEqual(scratch.selectedOffline);
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG002.JPG');
  await expect(page.getByRole('button', { name: 'Apply Coyote', exact: true })).toBeDisabled();
  await page.context().setOffline(false);
  await saved(page);
  await expect(page.getByRole('button', { name: 'Apply Coyote', exact: true })).toBeEnabled();
  expect(s3.puts.length).toBe(scratch.putsBeforeOffline);
  await expect(page.getByRole('button', { name: 'Find & filter', exact: true })).toHaveAttribute('aria-expanded', 'true');
});
When('an existing identification is reviewed and automatically saved', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG'); await speciesApply(page, 'Odocoileus hemionus').click(); await saved(page);
});
Then('its review is reversed with the original event and identifier retained', async ({ s3 }) => {
  const observation = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!;
  expect(observation.reviewEvents).toHaveLength(1);
  expect(observation.reviewEvents![0].reviewedBy).toBeTruthy(); expect(observation.reviewEvents![0].reversedBy).toBeTruthy();
});

When('the original canonical values are recorded for Undo verification', async ({ s3, scratch }) => {
  scratch.locationOriginal = Object.fromEntries(['media.csv', 'observations.csv', 'deployments.csv'].map(name => [name, s3.text(BUCKET, `${PREFIX_A}${name}`)]));
});
When('the location change finishes automatic saving', async ({ page }) => { await saved(page); });
When('the original deployment metadata is absent', async ({ page, s3 }) => {
  s3.put(BUCKET, `${PREFIX_A}deployments.csv`, '', 'text/csv');
  await page.reload(); await openWorkspace(page); await saved(page);
});
Then('the original location and capture values are restored without replacing audit history', async ({ s3, scratch }) => {
  for (const [name, value] of Object.entries(scratch.locationOriginal as Record<string, string>)) expect(parseCsvRows(s3.text(BUCKET, `${PREFIX_A}${name}`))).toEqual(parseCsvRows(value));
  const events = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).taggerActions;
  expect(events.at(-1).undoOf).toBe(events.at(-2).id);
});
When('a count is edited without finishing the field', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await page.getByRole('spinbutton', { name: 'Count for Mule Deer' }).fill('12');
});
Then('its unfinished value is not published or presented as Saved', async ({ page, s3 }) => {
  await expect(status(page)).toContainText('Uncommitted input');
  // Flush accepted work without finishing the active editor; this must remain
  // a local text draft, regardless of network debounce timers.
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!.count).toBe(2);
});
When('the count is finished with the save shortcut', async ({ page }) => { await page.keyboard.press('Control+s'); await saved(page); });
Then('its completed count is saved and can be undone', async ({ page, s3 }) => {
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!.count).toBe(12);
  await page.getByRole('button', { name: 'Undo latest action', exact: true }).click(); await saved(page);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!.count).toBe(2);
});
When('Coyote and deer are automatically saved on one image', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click();
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Odocoileus hemionus').click(); await saved(page);
});
When("another writer replaces them with bobcat and this client refreshes", async ({ page, s3 }) => {
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row[OBS_COL.mediaId] !== path);
  const bobcat = parseCsvRows(observationsCsv(PREFIX_A, [{ id: 'remote-bobcat', file: 'IMG002.JPG', timestamp: '2024-01-10T08:00:30', scientificName: 'Lynx rufus', count: 1, comments: '[COMMONNAME:Bobcat]' }]))[0];
  rows.push(bobcat); s3.put(BUCKET, `${PREFIX_A}observations.csv`, serializeCsvRows(rows), 'text/csv');
  await page.reload(); await openWorkspace(page); await saved(page);
});
When('Puma is added to the refreshed image', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Puma concolor').click(); await saved(page);
});
Then('bobcat and Puma are stored without resurrecting Coyote or deer', async ({ s3 }) => {
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path).map(o => o.scientificName).sort()).toEqual(['Lynx rufus', 'Puma concolor'].sort());
});

When('the automatic save completes', async ({ page }) => { await saved(page); });
When('an invalid count is submitted with the save shortcut', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await page.getByRole('spinbutton', { name: 'Count for Mule Deer' }).fill('0');
  await page.keyboard.press('Control+s');
});
Then('the invalid count stays focused and shared storage is unchanged', async ({ page, s3 }) => {
  const input = page.getByRole('spinbutton', { name: 'Count for Mule Deer' });
  await expect(input).toBeFocused(); expect(await input.evaluate(el => (el as HTMLInputElement).validity.valid)).toBe(false);
  await expect(status(page)).toContainText('Uncommitted input');
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!.count).toBe(2);
});
async function denyNextMetadata(page: import('@playwright/test').Page) {
  let denied = false;
  await page.route('**/*', async route => {
    if (!denied && route.request().method() === 'PUT' && route.request().headers()['if-match'] && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}UploadMeta.json`)) {
      denied = true;
      await route.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code><Message>Permission denied by regression fixture</Message></Error>' });
    } else await route.fallback();
  });
}
When('an automatic save fails after publishing observations', async ({ page }) => {
  await sectionTab(page, 'Tag').click();
  await denyNextMetadata(page); await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click();
});
When('the Undo fails after publishing its observations', async ({ page }) => {
  await denyNextMetadata(page); await status(page).getByRole('button', { name: 'Undo latest action', exact: true }).click();
});
When('the location Undo fails after publishing media', async ({ page, s3, scratch }) => {
  let denied = false;
  scratch.locationUndoPuts = s3.puts.length;
  await page.route('**/*', async route => {
    if (!denied && route.request().method() === 'PUT' && route.request().headers()['if-match'] && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}observations.csv`)) {
      denied = true;
      await route.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code></Error>' });
    } else await route.fallback();
  });
  await status(page).getByRole('button', { name: 'Undo latest action', exact: true }).click();
});
When('the interrupted location Undo is recovered by {string}', async ({ page }, recovery: string) => {
  if (recovery === 'reload') { await page.reload(); await openWorkspace(page); }
  else await status(page).getByRole('button', { name: 'Retry save', exact: true }).click();
  await saved(page);
});
Then('the location Undo journal is cleared without repeating media', async ({ page, s3, scratch }) => {
  const { readStore } = await import('./support/flows');
  expect(await readStore(page, 'syncJournals')).toEqual([]);
  expect(s3.puts.slice(scratch.locationUndoPuts as number).filter(write => write.key === `${PREFIX_A}media.csv`)).toHaveLength(1);
  await expect(status(page).getByRole('button', { name: 'Undo latest action', exact: true })).toBeDisabled();
});
When('an unfinished count is paused by {string}', async ({ page }, pause: string) => {
  await focusFrame(page, 'IMG001.JPG');
  const count = page.getByRole('spinbutton', { name: 'Count for Mule Deer' });
  if (pause === 'connectivity') {
    await count.fill('12'); await page.context().setOffline(true);
    await expect(status(page)).toContainText('Pending/reconnecting');
  } else {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    let denied = false;
    await page.route('**/*', async route => {
      if (!denied && route.request().method() === 'PUT' && route.request().headers()['if-match'] && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}UploadMeta.json`)) {
        denied = true; entered(); await gate;
        await route.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code></Error>' });
      } else await route.fallback();
    });
    await count.fill('3'); await count.press('Enter'); await reached;
    await count.fill('12'); release();
    await expect(status(page)).toContainText('Save failed');
  }
});
Then('the unfinished count remains visible with editing disabled', async ({ page }) => {
  const count = page.getByRole('spinbutton', { name: 'Count for Mule Deer' });
  await expect(count).toBeVisible(); await expect(count).toBeDisabled(); await expect(count).toHaveValue('12');
  await expect(status(page)).toContainText('Finish the active input before Undo.');
  await expect(page.getByRole('button', { name: 'Remove Mule Deer', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear Species', exact: true })).toBeDisabled();
});
When('editing resumes after {string}', async ({ page }, pause: string) => {
  if (pause === 'connectivity') await page.context().setOffline(false);
  else await status(page).getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Count for Mule Deer' })).toBeEnabled();
});
Then('the unfinished count can be finished and saved', async ({ page, s3 }) => {
  const count = page.getByRole('spinbutton', { name: 'Count for Mule Deer' });
  await expect(count).toHaveValue('12');
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!.count).not.toBe(12);
  await count.focus(); await page.keyboard.press('Control+s'); await saved(page);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === `${PREFIX_A}IMG001.JPG`)!.count).toBe(12);
});
Then('pending work and its journal remain available with retry announced', async ({ page }) => {
  await expect(status(page).getByRole('status')).toContainText('Save failed');
  await expect(status(page).getByRole('button', { name: 'Retry save' })).toBeEnabled();
  await expect(status(page).getByRole('button', { name: 'Undo latest action' })).toBeDisabled();
  const { readStore } = await import('./support/flows');
  expect(await readStore(page, 'syncJournals')).toHaveLength(1);
  const records = await readStore(page, 'automatic') as { actions: unknown[] }[];
  expect(records[0].actions.length).toBeGreaterThan(0);
});
When('the failed save is explicitly discarded', async ({ page }) => {
  await status(page).getByRole('button', { name: 'Discard local changes and use current storage', exact: true }).click();
  await expect(status(page)).toContainText('Using current stored data');
});
Then("discard releases the disconnect guard and clears only this account's recovery", async ({ page }) => {
  const { readStore } = await import('./support/flows');
  expect(await readStore(page, 'syncJournals')).toEqual([]);
  const records = await readStore(page, 'automatic') as { actions: unknown[]; flight?: unknown }[];
  expect(records[0].actions).toEqual([]); expect(records[0].flight).toBeUndefined();
  await openSettings(page);
  await expect(page.locator('main').getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
});
Then('the Coyote is saved exactly once and its journal is cleared', async ({ page, s3 }) => {
  const { readStore } = await import('./support/flows');
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path && o.scientificName === 'Canis latrans')).toHaveLength(1);
  expect(JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).taggerActions).toHaveLength(1);
  expect(await readStore(page, 'syncJournals')).toEqual([]);
});
When('another writer replaces Coyote without refreshing this client', async ({ s3 }) => {
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row[OBS_COL.mediaId] !== path);
  rows.push(parseCsvRows(observationsCsv(PREFIX_A, [{ id: 'remote-bobcat', file: 'IMG002.JPG', timestamp: '2024-01-10T08:00:30', scientificName: 'Lynx rufus', count: 1, comments: '[COMMONNAME:Bobcat]' }]))[0]);
  s3.put(BUCKET, `${PREFIX_A}observations.csv`, serializeCsvRows(rows), 'text/csv');
});
When('Puma is applied against the stale workspace', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Puma concolor').click();
});
Then('the conflicting remote edit survives and local work is retained', async ({ page, s3 }) => {
  await expect(status(page)).toContainText('Save conflict');
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path).map(o => o.scientificName)).toEqual(['Lynx rufus']);
  await status(page).getByText('Compare local changes with storage', { exact: true }).click();
  await expect(status(page)).toContainText('Retained change:');
  await expect(status(page)).toContainText('Puma');
  await expect(status(page)).toContainText('Currently stored:');
});
When('current storage is explicitly chosen', async ({ page }) => { await status(page).getByRole('button', { name: 'Discard local changes and use current storage' }).click(); await expect(status(page)).toContainText('Using current stored data'); });
When('another writer moves the camera to New York without refreshing this client', async ({ s3 }) => {
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}deployments.csv`));
  rows[0][2] = 'Remote New York camera';
  rows[0][3] = '-74.006000'; rows[0][4] = '40.712800';
  s3.put(BUCKET, `${PREFIX_A}deployments.csv`, serializeCsvRows(rows), 'text/csv');
});
Then('the refreshed camera location and editing time zone are used without reloading', async ({ page }) => {
  await page.getByRole('button', { name: 'Change location', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change location', exact: true });
  await expect(dialog).toContainText('Remote New York camera (SAN15)');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Puma concolor').click(); await saved(page);
  const { readStore } = await import('./support/flows');
  const records = await readStore(page, 'automatic') as { undo?: { timeZone?: string } }[];
  expect(records[0].undo?.timeZone).toBe('America/New_York');
});
When('the pending values are explicitly reapplied', async ({ page }) => { await status(page).getByRole('button', { name: 'Reapply my affected values to current storage' }).click(); await saved(page); });
Then('the remote bobcat remains and discarded edits do not return after reload', async ({ page, s3 }) => {
  await page.reload(); await openWorkspace(page); await saved(page);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path).map(o => o.scientificName)).toEqual(['Lynx rufus']);
  const { readStore } = await import('./support/flows');
  const records = await readStore(page, 'automatic') as { actions: unknown[]; pendingDrafts: object }[];
  expect(records[0].actions).toEqual([]); expect(records[0].pendingDrafts).toEqual({});
});
Then('only the remote bobcat remains', async ({ s3 }) => { expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path).map(o => o.scientificName)).toEqual(['Lynx rufus']); });
When('Undo is requested with the keyboard', async ({ page }) => { await page.locator('body').click({ position: { x: 1, y: 1 } }); await page.keyboard.press('Control+z'); });
Then('Undo explains the changed stored data and preserves bobcat', async ({ page, s3 }) => {
  await expect(status(page)).toContainText('affected data changed'); await expect(status(page).getByRole('button', { name: 'Undo latest action' })).toBeDisabled();
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(o => o.mediaId === path).map(o => o.scientificName)).toEqual(['Lynx rufus']);
});
When('another writer marks this image as needing an expert', async ({ s3 }) => {
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}media.csv`));
  const row = rows.find(row => row[MEDIA_COL.mediaId] === path)!;
  row[MEDIA_COL.comments] = `${row[MEDIA_COL.comments] || ''}[NEED_EXPERT:true]`;
  s3.put(BUCKET, `${PREFIX_A}media.csv`, serializeCsvRows(rows), 'text/csv');
});
Then('the unrelated remote expert marker remains', async ({ s3 }) => { expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find(row => row.mediaId === path)!.comments).toContain('[NEED_EXPERT:true]'); });
When('application Redo shortcuts are pressed', async ({ page }) => { await page.locator('body').click({ position: { x: 1, y: 1 } }); await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+y'); });
Then('the Coyote is still saved and Undo is available', async ({ page, s3 }) => {
  await saved(page); await expect(status(page).getByRole('button', { name: 'Undo latest action' })).toBeEnabled();
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(o => o.mediaId === path)!.scientificName).toBe('Canis latrans');
});
When('two tabs request the same persisted Undo', async ({ page, context, s3 }) => {
  const { installS3Mock } = await import('./support/s3mock');
  const second = await context.newPage(); await installS3Mock(second, s3); await openWorkspace(second); await saved(second);
  await Promise.all([status(page).getByRole('button', { name: 'Undo latest action' }).click(), status(second).getByRole('button', { name: 'Undo latest action' }).click()]);
  await expect.poll(() => JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).taggerActions.length).toBe(2);
  const { readStore } = await import('./support/flows');
  await expect.poll(async () => (await readStore(page, 'automatic') as { undo: unknown }[])[0].undo).toBeNull();
  await second.close(); await page.reload(); await openWorkspace(page); await saved(page);
});
When('two tabs edit from different recovery versions', async ({ page, context, s3 }) => {
  const { installS3Mock } = await import('./support/s3mock');
  const second = await context.newPage(); await installS3Mock(second, s3); await openWorkspace(second); await saved(second);
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click(); await saved(page);
  await focusFrame(second, 'IMG002.JPG'); await speciesApply(second, 'Puma concolor').click();
  await expect(status(second)).toContainText(/another tab|Another tab/);
  await second.close(); await page.reload(); await openWorkspace(page);
});
Then("both tabs' accepted actions remain available for explicit review", async ({ page, s3 }) => {
  await expect(status(page)).toContainText('another tab');
  const { readStore } = await import('./support/flows');
  const record = (await readStore(page, 'automatic') as { recoveryBranches: { actions: { changes: { species?: string }[] }[] }[]; undo: unknown }[])[0];
  expect(record.recoveryBranches[0].actions[0].changes.some(change => change.species === 'Puma concolor')).toBe(true);
  expect(record.undo).not.toBeNull();
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(row => row.mediaId === path)!.scientificName).toBe('Canis latrans');
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeDisabled();
});
Then('Coyote and Puma are stored and the latest action alone can be undone', async ({ page, s3 }) => {
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.mediaId === path).map(row => row.scientificName).sort()).toEqual(['Canis latrans', 'Puma concolor']);
  await status(page).getByRole('button', { name: 'Undo latest action' }).click(); await saved(page);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.mediaId === path).map(row => row.scientificName)).toEqual(['Canis latrans']);
});
Then('automatic saving does not show an access-denied error', async ({ page }) => { await expect(status(page)).not.toContainText('Access denied'); });
Then('automatic saving shows the confirmed media access-denied error', async ({ page }) => { await expect(status(page)).toContainText(/Save failed.*Access denied reading media.csv/); });
Then('credentials can be repaired without discarding pending work', async ({ page }) => {
  await expect(status(page).getByRole('button', { name: 'Repair credentials for this account' })).toBeEnabled();
  const { readStore } = await import('./support/flows'); expect((await readStore(page, 'automatic') as { actions: unknown[] }[])[0].actions).toHaveLength(1);
});

When('Retry and the save shortcut are used while offline', async ({ page }) => {
  await status(page).getByRole('button', { name: 'Retry save' }).click(); await page.keyboard.press('Control+s');
});
When('the conflict is reloaded and connectivity changes', async ({ page }) => {
  await page.reload(); await openWorkspace(page); await expect(status(page)).toContainText('Save conflict');
  await page.context().setOffline(true); await expect(status(page)).toContainText('Pending/reconnecting');
  await page.context().setOffline(false); await page.keyboard.press('Control+s');
});
Then('the conflict remains paused with its retained local work', async ({ page, s3 }) => {
  await expect(status(page)).toContainText('Save conflict');
  await expect(page.getByRole('region', { name: 'Review save conflict' })).toBeVisible();
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.mediaId === path).map(row => row.scientificName)).toEqual(['Lynx rufus']);
  const { readStore } = await import('./support/flows'); expect((await readStore(page, 'automatic') as { actions: unknown[] }[])[0].actions).toHaveLength(1);
});
When('another writer removes this image from canonical media', async ({ s3, scratch }) => {
  scratch.originalImage = s3.get(BUCKET, path)!.body.toString('base64');
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}media.csv`)).filter(row => row[MEDIA_COL.mediaId] !== path);
  s3.put(BUCKET, `${PREFIX_A}media.csv`, serializeCsvRows(rows), 'text/csv');
});
Then('the removed image is reported as a retained conflict', async ({ page }) => {
  await expect(status(page)).toContainText('Save conflict'); await expect(status(page)).toContainText('removed from storage');
  await page.getByText('Compare local changes with storage', { exact: true }).click();
  await expect(status(page)).toContainText('Image removed from storage');
  const { readStore } = await import('./support/flows'); expect((await readStore(page, 'automatic') as { actions: unknown[] }[])[0].actions).toHaveLength(1);
});
Then('the removed image stays absent and its original media object is untouched', async ({ s3, scratch }) => {
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).some(row => row.mediaId === path)).toBe(false);
  expect(s3.get(BUCKET, path)!.body.toString('base64')).toBe(scratch.originalImage);
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).some(row => row.mediaId === path && row.scientificName === 'Puma concolor')).toBe(false);
});
