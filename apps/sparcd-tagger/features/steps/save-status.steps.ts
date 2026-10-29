import type { Page } from '@playwright/test';
import { Given, Then, expect, openAppConnected, selectCollection, openWorkspace, sectionTab, uploadRow } from './support/world';
import { makeLocalEdit, waitForAutomaticSave, readStore, writeStore } from './support/flows';
import { BUCKET, PREFIX_A, PREFIX_B } from './support/data';
const badge = (page: Page, user = 'priortagger') => uploadRow(page, user).locator('[data-save-status]');
const browse = (page: Page) => sectionTab(page, 'Browse').click();

Given('an untouched upload whose save check is held', async ({ page, s3, scratch }) => {
  scratch.releaseStatus = s3.holdGet(`${PREFIX_A}UploadMeta.json`);
  await openAppConnected(page); await selectCollection(page);
});
Then('its save badge is Checking until the check completes', async ({ page, scratch }) => {
  await expect(badge(page)).toHaveText('Checking…');
  (scratch.releaseStatus as () => void)(); await expect(badge(page)).toContainText('Saved');
});
Then('its Saved popup says there is nothing to do', async ({ page }) => {
  await expect(badge(page)).toHaveAttribute('title', 'All changes are saved. Nothing to do.');
  await expect(page.locator('[data-column="sync"]').first()).toHaveText('Save Status');
});
Given('an upload whose save status cannot be checked', async ({ page, s3 }) => {
  s3.failGetsWith(`${PREFIX_A}UploadMeta.json`, 0, 403, 'AccessDenied');
  await openAppConnected(page); await selectCollection(page); await expect(badge(page)).toHaveText('Recheck');
});
Then('Recheck checks again and returns to Recheck on failure or Saved on success', async ({ page, s3 }) => {
  const key = `${PREFIX_A}UploadMeta.json`;
  await expect(badge(page)).toHaveAttribute('title', 'Save status is unknown. Select to check status again.');
  let release = s3.holdGet(key);
  await badge(page).click(); await expect(badge(page)).toHaveText('Checking…');
  release(); await expect(badge(page)).toHaveText('Recheck');
  s3.getFailures.delete(key); s3.getFailureResponses.delete(key);
  release = s3.holdGet(key);
  await badge(page).click(); await expect(badge(page)).toHaveText('Checking…');
  release(); await expect(badge(page)).toContainText('Saved');
  await expect(page.getByTestId('tag-workspace')).toHaveCount(0);
});
Given('a real save stopped by {string}', async ({ page, scratch }, reason: string) => {
  await openWorkspace(page); scratch.rejectSave = true;
  await page.route('**/*', async route => {
    if (scratch.rejectSave && route.request().method() === 'PUT' && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}observations.csv`)) {
      const [status, code] = reason === 'access' ? [403, 'AccessDenied'] : reason === 'conflict' ? [412, 'PreconditionFailed'] : reason === 'transport' ? [503, 'ServiceUnavailable'] : [400, 'InvalidArgument'];
      await route.fulfill({ status: status as number, contentType: 'application/xml', body: `<Error><Code>${code}</Code><Message>save-status regression</Message></Error>` });
    } else await route.fallback();
  });
  await makeLocalEdit(page);
  await expect(page.getByTestId('automatic-save').getByRole('status')).toContainText(reason === 'conflict' ? 'conflict' : reason === 'transport' ? 'reconnecting' : 'failed', { timeout: 25000 });
  await browse(page);
});
Then('its Browse badge is {string} with popup {string}', async ({ page }, text: string, popup: string) => {
  await expect(badge(page)).toHaveText(text); await expect(badge(page)).toHaveAttribute('title', popup);
  expect(await badge(page).evaluate(node => node.tagName)).toBe('SPAN');
});
Then('its existing Open control shows {string} without resolving anything', async ({ page, s3 }, control: string) => {
  const before = [...await readStore(page, 'automatic'), ...await readStore(page, 'drafts')]; const writes = s3.puts.length;
  await uploadRow(page, 'priortagger').getByRole('button', { name: 'Open →', exact: true }).click();
  await expect(page.getByText(control, { exact: true })).toBeVisible();
  expect(s3.puts.length).toBe(writes);
  expect(before.some((r: any) => r.actions?.length || r.adoptionRequired || r.dirty)).toBe(true);
  expect(([...await readStore(page, 'automatic'), ...await readStore(page, 'drafts')]).some((r: any) => r.actions?.length || r.adoptionRequired || r.dirty)).toBe(true);
});
Then('Retry save retries that upload and reaches Saved without opening another upload', async ({ page, scratch }) => {
  await expect(badge(page)).toHaveText('Retry save'); scratch.rejectSave = false;
  await badge(page).click(); await expect(badge(page)).toContainText('Saved');
  await expect(badge(page, 'fielduser')).toContainText('Saved');
  expect((await readStore(page, 'automatic')).every((r: any) => !r.actions?.length && !r.flight)).toBe(true);
});
Then('it becomes Saved when storage accepts retries again', async ({ page, scratch }) => {
  scratch.rejectSave = false; await expect(badge(page)).toContainText('Saved', { timeout: 35000 });
});

async function seedPending(page: Page, prefix: string, legacy: boolean) {
  if (legacy) {
    await writeStore(page, 'drafts', { id: `${BUCKET}::${prefix}::${prefix}IMG002.JPG`, bucket: BUCKET, uploadPrefix: prefix, mediaPath: `${prefix}IMG002.JPG`, deploymentId: 'SAN15', observations: [], questionable: true, questionableEdited: true, dirty: true, lastEdited: new Date().toISOString() });
  } else {
    const record = await page.evaluate(async ({ bucket, prefix, file }) => {
      const storeUrl = new URL('src/store.ts', location.href).href; const modelUrl = new URL('src/lib/automaticModel.ts', location.href).href;
      const { useStore } = await import(/* @vite-ignore */ storeUrl);
      const { accountScope, automaticId } = await import(/* @vite-ignore */ modelUrl);
      const state = useStore.getState(); const scope = accountScope(state.s3Config);
      return { id: automaticId(scope, bucket, prefix), scope, bucket, uploadPrefix: prefix, collectionKey: state.selectedCollectionKey,
        undo: null, saveFailure: 'retry', actions: [{ id: 'retained-edit', user: 'testkey', at: new Date().toISOString(), changes: [{ path: `${prefix}${file}`, field: 'expert', before: false, after: true }] }] };
    }, { bucket: BUCKET, prefix, file: prefix === PREFIX_A ? 'IMG002.JPG' : 'FOX001.JPG' });
    await writeStore(page, 'automatic', record);
  }
}
Given('legacy unsaved work in an unopened upload', async ({ page }) => {
  await openAppConnected(page); await selectCollection(page); await seedPending(page, PREFIX_A, true);
});
Given('retained retryable work in a different unopened upload', async ({ page }) => {
  await openWorkspace(page); await browse(page); await seedPending(page, PREFIX_B, false);
});
Then('Retry save opens and saves that upload without changing the previous upload', async ({ page, s3 }) => {
  const before = s3.text(BUCKET, `${PREFIX_A}observations.csv`);
  await expect(badge(page, 'fielduser')).toHaveText('Retry save'); await badge(page, 'fielduser').click();
  await waitForAutomaticSave(page);
  await expect(page.getByTestId('tag-workspace')).toHaveAttribute('data-upload-prefix', PREFIX_B);
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(before);
  const records = await readStore(page, 'automatic') as any[];
  expect(records.find(r => r.uploadPrefix === PREFIX_B)?.actions).toEqual([]);
});
Given('local save-status reads fail', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.openCursor; (window as any).failSaveStatus = true;
    IDBObjectStore.prototype.openCursor = function(...args) {
      if (this.name === 'automatic' && (window as any).failSaveStatus) throw new DOMException('status lookup blocked', 'UnknownError');
      return original.apply(this, args);
    };
  });
  await openAppConnected(page); await selectCollection(page);
});
Then('the local failure shows Recheck and recovers after a new check', async ({ page }) => {
  await expect(badge(page)).toHaveText('Recheck');
  await page.evaluate(() => { (window as any).failSaveStatus = false; });
  await badge(page).click(); await expect(badge(page)).toContainText('Saved');
});
Given('an upload list with a Conflict badge at width {int}', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 950 }); await openAppConnected(page); await selectCollection(page);
  await seedPending(page, PREFIX_B, false);
  const records = await readStore(page, 'automatic') as any[];
  await writeStore(page, 'automatic', { ...records.find(r => r.uploadPrefix === PREFIX_B), conflictReason: 'changed elsewhere' });
});
Then('the status and Open fit and the popup is available without opening the upload', async ({ page }) => {
  const status = badge(page, 'fielduser'); const row = uploadRow(page, 'fielduser');
  const popup = page.locator(`[id="${await status.getAttribute('aria-describedby')}"]`);
  await expect(status).toHaveText('Conflict'); await expect(status).toBeVisible();
  await expect(row.getByRole('button', { name: 'Open →' })).toBeVisible();
  for (const target of [status, row.getByRole('button', { name: 'Open →' })]) {
    const box = (await target.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await status.hover(); await expect(popup).toBeVisible();
  await page.mouse.move(0, 0); await status.focus();
  await expect(popup).toHaveText('Changes could not be saved because stored data changed. Use Open to review unsaved changes.');
  await page.keyboard.press('Escape'); await expect(popup).toBeHidden();
  const touch = await page.context().newCDPSession(page);
  const box = (await status.boundingBox())!;
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await expect(popup).toBeVisible();
  await expect(page.getByTestId('tag-workspace')).toHaveCount(0);
  expect(await row.locator('button button').count()).toBe(0);
});

Then('a failed upload read still leaves its Recover badge and pending work intact', async ({ page, s3 }) => {
  s3.failGetsWith(`${PREFIX_A}media.csv`, 0, 403, 'AccessDenied');
  await expect(badge(page)).toHaveText('Recover');
  await uploadRow(page, 'priortagger').getByRole('button', { name: 'Open →', exact: true }).click();
  await expect(page.getByTestId('automatic-save').getByRole('status')).toContainText('could not be read');
  await browse(page);
  await expect(badge(page)).toHaveText('Recover');
  expect((await readStore(page, 'drafts')).some((draft: any) => draft.dirty)).toBe(true);
});

Given('opening an upload failed while reading {string}', async ({ page, s3, scratch }, file: string) => {
  await openAppConnected(page); await selectCollection(page);
  const key = `${PREFIX_A}${file}`;
  scratch.failedActiveRead = key;
  s3.failGetsWith(key, 0, 403, 'AccessDenied');
  await uploadRow(page, 'priortagger').getByRole('button', { name: 'Open →', exact: true }).click();
  await expect(page.getByTestId('automatic-save').getByRole('status')).toContainText('could not be read');
  await browse(page); await expect(badge(page)).toHaveText('Recheck');
});
Then('Recheck retries that read and stays unknown while it is still denied', async ({ page, s3, scratch }) => {
  const key = scratch.failedActiveRead as string;
  const before = s3.readCount(key);
  const release = s3.holdGet(key);
  try {
    await badge(page).click(); await expect(badge(page)).toHaveText('Checking…');
  } finally { release(); }
  await expect.poll(() => s3.readCount(key)).toBeGreaterThan(before);
  await expect(badge(page)).toHaveText('Recheck');
});
Then('Recheck reaches Saved after access is restored without writing changes', async ({ page, s3, scratch }) => {
  const key = scratch.failedActiveRead as string;
  const writes = s3.puts.length;
  const before = s3.readCount(key);
  const retained = { automatic: await readStore(page, 'automatic'), drafts: await readStore(page, 'drafts') };
  s3.getFailures.delete(key); s3.getFailureResponses.delete(key);
  const release = s3.holdGet(key);
  try {
    await badge(page).click(); await expect(badge(page)).toHaveText('Checking…');
  } finally { release(); }
  await expect(badge(page)).toContainText('Saved');
  expect(s3.readCount(key)).toBeGreaterThan(before);
  expect(s3.puts.length).toBe(writes);
  expect(await readStore(page, 'automatic')).toEqual(retained.automatic);
  expect(await readStore(page, 'drafts')).toEqual(retained.drafts);
  await expect(page.getByTestId('tag-workspace')).toHaveCount(0);
  await expect(badge(page, 'fielduser')).toContainText('Saved');
});

Given("another upload's status cannot be checked", async ({ s3 }) => {
  s3.failGetsWith(`${PREFIX_B}UploadMeta.json`, 0, 403, 'AccessDenied');
});
Then('rechecking the other upload leaves the failed active upload untouched', async ({ page, s3 }) => {
  const activeReads = s3.readCount(`${PREFIX_A}media.csv`);
  const writes = s3.puts.length;
  const other = badge(page, 'fielduser');
  await expect(other).toHaveText('Recheck');
  const key = `${PREFIX_B}UploadMeta.json`;
  s3.getFailures.delete(key); s3.getFailureResponses.delete(key);
  const release = s3.holdGet(key);
  try {
    await other.click(); await expect(other).toHaveText('Checking…');
  } finally { release(); }
  await expect(other).toContainText('Saved');
  await expect(badge(page)).toHaveText('Recheck');
  expect(s3.readCount(`${PREFIX_A}media.csv`)).toBe(activeReads);
  expect(s3.puts.length).toBe(writes);
});

Given('Undo failed while checking an already saved upload', async ({ page, s3, scratch }) => {
  await openWorkspace(page);
  scratch.beforeUndoEdit = s3.text(BUCKET, `${PREFIX_A}observations.csv`);
  await makeLocalEdit(page); await waitForAutomaticSave(page);
  scratch.afterUndoEdit = s3.text(BUCKET, `${PREFIX_A}observations.csv`);
  expect(scratch.afterUndoEdit).not.toBe(scratch.beforeUndoEdit);
  const key = `${PREFIX_A}media.csv`;
  scratch.failedActiveRead = key;
  s3.failGetsWith(key, 0, 403, 'AccessDenied');
  const writes = s3.puts.length;
  await page.getByRole('button', { name: 'Undo latest action', exact: true }).click();
  await expect(page.getByTestId('automatic-save').getByRole('status')).toContainText('media.csv');
  expect(s3.puts.length).toBe(writes);
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(scratch.afterUndoEdit);
  await browse(page); await expect(badge(page)).toHaveText('Recheck');
});
Then('the saved action is only undone when Undo is explicitly selected', async ({ page, s3, scratch }) => {
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).toBe(scratch.afterUndoEdit);
  await uploadRow(page, 'priortagger').getByRole('button', { name: 'Open →', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo latest action', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click(); await waitForAutomaticSave(page);
  expect(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).not.toBe(scratch.afterUndoEdit);
});

Given('upload setup fails with {string} work', async ({ page, scratch }, work: string) => {
  await openAppConnected(page); await selectCollection(page);
  if (work === 'retained' || work === 'queued') await seedPending(page, PREFIX_A, work === 'retained');
  scratch.setupDrafts = await readStore(page, 'drafts');
  await page.evaluate(async () => {
    const url = new URL('src/lib/drafts.ts', location.href).href;
    const { useDraftStore } = await import(/* @vite-ignore */ url);
    const load = useDraftStore.getState().loadUpload;
    (window as any).denySetup = true; (window as any).setupAttempts = 0;
    useDraftStore.setState({ loadUpload: async (...args: any[]) => {
      (window as any).setupAttempts++;
      if ((window as any).denySetup) throw new Error('local setup read failed');
      return load(...args);
    } });
  });
  await uploadRow(page, 'priortagger').getByRole('button', { name: 'Open →', exact: true }).click();
  await expect(page.getByTestId('automatic-save').getByRole('status')).toContainText('local setup read failed');
  await browse(page);
});
Then('failed setup offers Recheck and repeated setup failures remain unknown', async ({ page }) => {
  await expect(badge(page)).toHaveText('Recheck');
  const before = await page.evaluate(() => (window as any).setupAttempts);
  await badge(page).click();
  await expect.poll(() => page.evaluate(() => (window as any).setupAttempts)).toBeGreaterThan(before);
  await expect(badge(page)).toHaveText('Recheck');
});
Then('restoring setup lets Recheck show {string} without consuming pending work', async ({ page, s3, scratch }, status: string) => {
  const writes = s3.puts.length;
  await page.evaluate(() => { (window as any).denySetup = false; });
  await badge(page).click(); await expect(badge(page)).toContainText(status);
  expect(s3.puts.length).toBe(writes);
  expect(await readStore(page, 'drafts')).toEqual(scratch.setupDrafts);
  await uploadRow(page, 'priortagger').getByRole('button', { name: 'Open →', exact: true }).click();
  if (status === 'Recover') await expect(page.getByRole('button', { name: 'Recover pending work for this account and upload', exact: true })).toBeVisible();
  else await expect(page.locator('button[title="IMG001.JPG"]')).toBeVisible();
  expect(s3.puts.length).toBe(writes);
});

Then('queued changes wait for an explicit Retry save', async ({ page, s3 }) => {
  const writes = s3.puts.length;
  // Pass the normal automatic-save debounce and maximum scheduling windows.
  await page.waitForTimeout(1200);
  expect(s3.puts.length).toBe(writes);
  expect((await readStore(page, 'automatic')).some((record: any) => record.actions?.length)).toBe(true);
  await page.getByTestId('automatic-save').getByRole('button', { name: 'Retry save', exact: true }).click();
  await waitForAutomaticSave(page);
  expect(s3.puts.length).toBeGreaterThan(writes);
  expect((await readStore(page, 'automatic')).every((record: any) => !record.actions?.length && !record.flight)).toBe(true);
});

Then('an offline retry remains Retry save until a connected retry is selected', async ({ page, context, s3 }) => {
  const writes = s3.puts.length;
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByTestId('automatic-save').getByRole('button', { name: 'Retry save', exact: true }).click();
  await browse(page); await expect(badge(page)).toHaveText('Retry save');
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  // Pass the automatic-save scheduling window to prove reconnect does not
  // silently release work that is still awaiting an actionable Retry save.
  await page.waitForTimeout(1200);
  await expect(badge(page)).toHaveText('Retry save');
  expect(s3.puts.length).toBe(writes);
  expect((await readStore(page, 'automatic')).some((record: any) => record.actions?.length)).toBe(true);
  await badge(page).click(); await expect(badge(page)).toContainText('Saved');
  expect(s3.puts.length).toBeGreaterThan(writes);
  expect((await readStore(page, 'automatic')).every((record: any) => !record.actions?.length && !record.flight)).toBe(true);
});
