import { Given, When, Then, expect } from './fixtures';
import {
  FOLDER,
  jpegAt,
  jpegNoTime,
  manyJpegs,
  mp4At,
  publishableBatch,
  slowPublishableBatch,
  slowVideo,
  standardBatch,
} from './batches';
import { jpegWithExifDate } from './fixtures-data';

Given('a folder of media has been scanned', async ({ app }) => {
  await app.connect();
  await app.dropFolder([...standardBatch(), mp4At('CLIP_0001.MP4', new Date(Date.UTC(2026, 6, 1, 12, 30, 0)))]);
  await app.waitForInspected();
});

Given('the New upload section is showing the Verify step', async ({ app }) => {
  await app.expectStep('Verify');
  await expect(app.fileListToggle()).toBeVisible();
});

// --- what Inspect establishes ---------------------------------------------

When('the batch is examined', async ({ app }) => {
  await app.waitForInspected();
});

Then("each file's capture time is read from the camera's own metadata", async ({ app }) => {
  const rows = await app.listedFiles();
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(byName['IMG_0001.JPG'].timestamp).toBe('2026-07-01 12:00:00');
  expect(byName['IMG_0002.JPG'].timestamp).toBe('2026-07-01 12:05:00');
  // The MP4's time comes from the container's mvhd creation time, not EXIF.
  expect(byName['CLIP_0001.MP4'].timestamp).toBe('2026-07-01 12:30:00');
});

Then("each file's content fingerprint is computed from its bytes", async ({ app }) => {
  const rows = await app.listedFiles();
  expect(rows).toHaveLength(4);
  for (const row of rows) expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(new Set(rows.map((r) => r.sha256)).size).toBe(4);
});

Then("each image's pixel dimensions and a thumbnail are produced", async ({ app }) => {
  const rows = await app.listedFiles();
  for (const row of rows.filter((r) => r.name.endsWith('.JPG'))) {
    expect(row.dimensions).toBe('64×48');
    expect(row.hasThumbnail).toBe(true);
  }
});

// --- the summary -----------------------------------------------------------

Given('files are still being examined', async ({ app }) => {
  // One file that blocks (unsafe path), one that only warns (no capture time),
  // one that is still being hashed, and one clean file.
  await app.rescan(
    [
      jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
      jpegNoTime('IMG_NOTIME.JPG'),
      { path: `${FOLDER}/../ESCAPE.JPG`, mime: 'image/jpeg', bytes: jpegWithExifDate('2026:07:01 12:00:00', 'esc') },
      slowVideo(),
    ],
    { raw: true },
  );
  await expect(app.fileListToggle()).toBeVisible();
});

Then('the summary shows how many of the files are processed, and their total size', async ({ app }) => {
  await expect
    .poll(() => app.batchSummary(), { timeout: 30_000 })
    .toMatch(/\d of 4 files processed · [\d.]+ (B|KB|MB)/);
  expect(await app.pendingCount()).toBeGreaterThan(0);
});

Then('it shows how many files need attention and how many carry warnings', async ({ app }) => {
  await expect.poll(() => app.batchSummary(), { timeout: 30_000 }).toMatch(/1 need attention/);
  await expect.poll(() => app.batchSummary(), { timeout: 30_000 }).toMatch(/1 warnings/);
});

// --- the folded file list --------------------------------------------------

Then('the summary line is showing and the per-file list is hidden', async ({ app }) => {
  await expect.poll(() => app.fileCount()).toBeGreaterThan(0);
  await expect(app.fileListToggle()).toHaveAttribute('aria-expanded', 'false');
  await expect(app.fileListPane()).toHaveCount(0);
});

When('"Show files" is chosen', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Show files', exact: true }).click();
});

When('"Hide files" is chosen', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Hide files', exact: true }).click();
});

Then('the per-file list is shown', async ({ app }) => {
  await app.showFileList();
  await expect(app.fileListToggle()).toHaveAttribute('aria-expanded', 'true');
});

When('another folder is dropped', async ({ app }) => {
  await app.expectStep('Choose');
  await app.dropFolder(standardBatch());
  await app.expectStep('Verify');
});

When('the count of files needing attention is chosen', async ({ app }) => {
  await expect.poll(() => app.batchSummary(), { timeout: 30_000 }).toMatch(/1 need attention/);
  await expect(app.fileListPane()).toHaveCount(0);
  await app.page.getByRole('button', { name: '1 need attention' }).click();
});

Then('the per-file list is shown with only that file in it', async ({ app }) => {
  await app.showFileList();
  await expect.poll(async () => (await app.listedFiles()).map((f) => f.name)).toEqual(['BROKEN.JPG']);
});

// --- blocking problems -----------------------------------------------------

Given('one file fails to be examined', async ({ app }) => {
  await app.rescan([
    jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
    { path: `${FOLDER}/BROKEN.JPG`, mime: 'image/jpeg', broken: true },
  ]);
  await app.waitForInspected();
});

Then('that file is marked as needing attention', async ({ app }) => {
  const rows = await app.listedFiles();
  const bad = rows.find((r) => r.name === 'BROKEN.JPG' || r.name === 'ESCAPE.JPG')!;
  expect(bad.status).toBe('Needs attention');
});

Then('the batch cannot continue to the Describe step until it is resolved', async ({ app }) => {
  await expect(app.continueButton()).toBeDisabled();
  const rows = await app.listedFiles();
  await app.dropFileFromList(rows.findIndex((r) => r.name === 'BROKEN.JPG'));
  await expect(app.continueButton()).toBeEnabled();
});

Given("a file's path contains a traversal segment or is empty once normalized", async ({ app }) => {
  await app.rescan(
    [
      jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
      { path: `${FOLDER}/../ESCAPE.JPG`, mime: 'image/jpeg', bytes: jpegWithExifDate('2026:07:01 12:00:00', 'esc') },
    ],
    { raw: true },
  );
  await app.waitForInspected();
});

Then('the batch cannot continue until it is dropped', async ({ app }) => {
  await expect(app.continueButton()).toBeDisabled();
  const rows = await app.listedFiles();
  const i = rows.findIndex((r) => r.name === 'ESCAPE.JPG');
  expect(rows[i].issues).toContain('Unsafe filename');
  await app.dropFileFromList(i);
  await expect(app.continueButton()).toBeEnabled();
});

// --- warnings --------------------------------------------------------------

Given('a file carries no camera capture time', async ({ app }) => {
  await app.rescan([jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'), jpegNoTime('IMG_NOTIME.JPG')]);
  await app.waitForInspected();
});

Then('it is shown as a warning at Verify', async ({ app }) => {
  const row = (await app.listedFiles()).find((r) => r.name === 'IMG_NOTIME.JPG')!;
  expect(row.status).toBe('Warning');
  expect(row.issues).toContain('No camera time');
});

Then('the batch can still continue to the Describe step, where the estimate can be overridden', async ({ app }) => {
  await expect(app.continueButton()).toBeEnabled();
  await app.continueToAssign();
  await expect(app.page.getByRole('heading', { name: 'Capture times' })).toBeVisible();
});

Given('two files in the batch have identical contents', async ({ app }) => {
  const twin = jpegWithExifDate('2026:07:01 12:00:00', 'same-bytes');
  await app.rescan([
    { path: `${FOLDER}/IMG_A.JPG`, mime: 'image/jpeg', bytes: twin },
    { path: `${FOLDER}/IMG_B.JPG`, mime: 'image/jpeg', bytes: twin },
    jpegAt('IMG_C.JPG', '2026:07:01 12:10:00'),
  ]);
  await app.waitForInspected();
});

Then('both are flagged as duplicates of each other', async ({ app }) => {
  const rows = await app.listedFiles();
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(byName['IMG_A.JPG'].issues).toContain('Duplicate of another file');
  expect(byName['IMG_B.JPG'].issues).toContain('Duplicate of another file');
  expect(byName['IMG_A.JPG'].sha256).toBe(byName['IMG_B.JPG'].sha256);
  expect(byName['IMG_C.JPG'].issues).not.toContain('Duplicate');
});

Then('they are a warning, so the batch can proceed with them kept or dropped', async ({ app }) => {
  const rows = await app.listedFiles();
  expect(rows.find((r) => r.name === 'IMG_A.JPG')!.status).toBe('Warning');
  await expect(app.continueButton()).toBeEnabled();
  await app.dropFileFromList(rows.findIndex((r) => r.name === 'IMG_A.JPG'));
  await expect(app.continueButton()).toBeEnabled();
  expect(await app.fileCount()).toBe(2);
});

Given('a file is larger than 100 MiB', async ({ app }) => {
  await app.rescan([
    jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
    {
      path: `${FOLDER}/HUGE.JPG`,
      mime: 'image/jpeg',
      bytes: jpegWithExifDate('2026:07:01 12:20:00', 'huge'),
      padBytes: 101 * 1024 * 1024,
    },
  ]);
  await app.waitForInspected();
});

Then('it is flagged as unusually large for a camera trap', async ({ app }) => {
  const row = (await app.listedFiles()).find((r) => r.name === 'HUGE.JPG')!;
  expect(row.issues).toContain('Large file (>100 MiB)');
  expect(row.status).toBe('Warning');
});

Then('it does not block the batch', async ({ app }) => {
  await expect(app.continueButton()).toBeEnabled();
});

// --- dropping files --------------------------------------------------------

When('a file is removed from the list', async ({ app }) => {
  const twin = jpegWithExifDate('2026:07:01 12:00:00', 'twin');
  await app.rescan([
    { path: `${FOLDER}/IMG_A.JPG`, mime: 'image/jpeg', bytes: twin },
    { path: `${FOLDER}/IMG_B.JPG`, mime: 'image/jpeg', bytes: twin },
    jpegAt('IMG_C.JPG', '2026:07:01 12:10:00'),
  ]);
  await app.waitForInspected();
  const rows = await app.listedFiles();
  expect(rows.find((r) => r.name === 'IMG_B.JPG')!.issues).toContain('Duplicate');
  await app.dropFileFromList(rows.findIndex((r) => r.name === 'IMG_A.JPG'));
});

Then('it is excluded from the upload', async ({ app }) => {
  const names = (await app.listedFiles()).map((r) => r.name);
  expect(names).not.toContain('IMG_A.JPG');
  expect(await app.fileCount()).toBe(2);
});

Then('the duplicate warnings on the remaining files are recalculated', async ({ app }) => {
  const rows = await app.listedFiles();
  expect(rows.find((r) => r.name === 'IMG_B.JPG')!.issues).not.toContain('Duplicate');
  expect(await app.batchSummary()).not.toContain('warnings');
});

// --- the Continue gate -----------------------------------------------------

Given('at least one file is marked as needing attention', async ({ app }) => {
  await app.rescan([
    jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
    { path: `${FOLDER}/BROKEN.JPG`, mime: 'image/jpeg', broken: true },
  ]);
  await app.waitForInspected();
  expect((await app.listedFiles()).some((r) => r.status === 'Needs attention')).toBe(true);
});

Then('it explains that files needing attention must be resolved first', async ({ app }) => {
  await expect(app.continueButton()).toHaveAttribute(
    'title',
    'Resolve files that need attention first',
  );
});

// --- working while examination continues -----------------------------------

Given('a large batch is still being examined', async ({ app }) => {
  await app.holdInspect('BIG_CLIP.MP4');
  await app.rescan(publishableBatch());
  await expect(app.fileListToggle()).toBeVisible();
  await expect.poll(() => app.pendingCount()).toBeGreaterThan(0);
});

Given('no file has been marked as needing attention', async ({ app }) => {
  expect(await app.batchSummary()).not.toContain('need attention');
});

Then('Continue is available', async ({ app }) => {
  await expect(app.continueButton()).toBeEnabled();
});

Then('examination carries on in the background while the user works on Assign', async ({ app }) => {
  await app.continueToAssign();
  await app.waitForCollections();
  await app.chooseDeployment('Bear Canyon');
  await app.setUploader('Ada Lovelace');
  await app.continueToUpload();
  // The Upload step reports the still-running examination, then it completes
  // without anyone going back to Inspect.
  await expect(app.page.getByText(/still being inspected/)).toBeVisible();
  await app.releaseHeldInspect();
  await expect(app.page.getByText(/still being inspected/)).toHaveCount(0, { timeout: 60_000 });
  await expect(app.page.getByText(/^\d+ files ready · /)).toBeVisible();
});

Given('a batch is still being examined', async ({ app }) => {
  await app.rescan(manyJpegs(1200));
  await expect(app.fileListToggle()).toBeVisible();
  await expect.poll(() => app.pendingCount()).toBeGreaterThan(0);
  app.notes.pendingBefore = await app.pendingCount();
});

When('the user switches to History or Settings and back', async ({ app }) => {
  await app.gotoSection('Settings');
  await expect(app.page.getByRole('heading', { name: 'Connection', exact: true })).toBeVisible();
  await app.gotoSection('New upload');
  await expect(app.fileListToggle()).toBeVisible();
});

Then('examination has continued in the background rather than restarting', async ({ app }) => {
  await expect
    .poll(() => app.pendingCount(), { timeout: 30_000 })
    .toBeLessThan(app.notes.pendingBefore as number);
  await app.waitForInspected();
  expect(await app.fileCount()).toBe(1200);
});

When('"Back" is chosen', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Back', exact: true }).click();
});

Then('the batch is cleared and the wizard returns to the Choose step', async ({ app }) => {
  await app.expectStep('Choose');
  await expect(app.page.getByText('Drop a folder to upload')).toBeVisible();
  await expect(app.fileListToggle()).toHaveCount(0);
});

// --- very large batches ----------------------------------------------------

Given('a batch of several thousand files', async ({ app }) => {
  await app.rescan(manyJpegs(3000));
  await expect(app.fileListToggle()).toBeVisible();
  await expect.poll(() => app.fileCount(), { timeout: 60_000 }).toBe(3000);
});

Then('the list scrolls smoothly with only the visible rows drawn', async ({ app }) => {
  const drawn = await app.drawnRowCount();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(60);
  const first = (await app.listedFiles())[0].name;
  await app.fileListPane().evaluate((el) => {
    el.scrollTop = 20_000;
  });
  await expect.poll(async () => (await app.listedFiles())[0]?.name).not.toBe(first);
  expect(await app.drawnRowCount()).toBeLessThan(60);
});

Then('files can be stepped through and dropped from the keyboard', async ({ app }) => {
  await app.fileListPane().evaluate((el) => {
    el.scrollTop = 0;
  });
  await app.fileListPane().focus();
  await app.page.keyboard.press('j');
  await app.page.keyboard.press('j');
  await app.page.keyboard.press('k');
  await app.page.keyboard.press('d');
  await expect.poll(() => app.fileCount()).toBe(2999);
});

async function previewBatchSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const path = '/sparcd-exploration/uploader/src/store.ts';
    const { useStore } = await import(/* @vite-ignore */ path);
    const { files, validations, step, uploadTimeZone, flipId } = useStore.getState();
    return JSON.stringify({ files, validations, step, uploadTimeZone, flipId });
  });
}

Then('the fitted image preview supports keyboard, dismissal and offline viewing', async ({ app, context }) => {
  const page = app.page;
  const count = await app.fileCount();
  const before = await previewBatchSnapshot(page);
  await page.evaluate(() => {
    history.replaceState({ previewTest: 'prior' }, '', location.href);
    history.pushState({ previewTest: 'inspect' }, '', location.href);
  });
  const list = app.fileListPane();
  const opener = page.getByRole('button', { name: 'Preview IMG_0001.JPG', exact: true });
  await context.setOffline(true);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Preview IMG_0001.JPG', exact: true });
  const close = dialog.getByRole('button', { name: 'Close preview', exact: true });
  await expect(close).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(dialog.locator('img')).toHaveJSProperty('naturalWidth', 64);
  await expect(dialog.locator('img')).toHaveCSS('object-fit', 'contain');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('d');
  await dialog.locator('img').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
  await list.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(list).toBeFocused();
  await page.getByText('IMG_0001.JPG', { exact: true }).dblclick();
  await expect(dialog).toBeVisible();
  await close.click();
  await expect.poll(() => page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
  expect(await app.fileCount()).toBe(count);
  expect(await previewBatchSnapshot(page)).toBe(before);
  await page.goForward();
  await expect.poll(() => page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => history.state?.previewTest)).toBe('prior');
  await context.setOffline(false);
});

Then('the video preview is fitted and reports decoding errors without changing the batch', async ({ app }) => {
  const page = app.page;
  const count = await app.fileCount();
  const before = await previewBatchSnapshot(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'Preview CLIP_0001.MP4', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview CLIP_0001.MP4', exact: true });
  const video = dialog.locator('video');
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).not.toHaveAttribute('autoplay');
  await expect(video).toHaveCSS('object-fit', 'contain');
  await expect(video).toHaveJSProperty('paused', true);
  const bounds = await dialog.boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, width: 320, height: 640 });
  await expect(dialog.getByRole('button', { name: 'Close preview' })).toBeInViewport();
  // The fixture is a metadata-only MP4; dispatching error also makes the
  // decoder-error assertion deterministic across browser versions.
  await video.dispatchEvent('error');
  await expect(dialog.getByRole('status')).toContainText('Your batch is unchanged');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await app.fileCount()).toBe(count);
  expect(await previewBatchSnapshot(page)).toBe(before);
});

Then('removing the previewed file closes it and releases its local URL', async ({ app }) => {
  const page = app.page;
  await page.evaluate(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (window as unknown as { previewRevocations: string[] }).previewRevocations = [];
    URL.revokeObjectURL = (url) => {
      (window as unknown as { previewRevocations: string[] }).previewRevocations.push(url);
      original(url);
    };
  });
  await page.getByRole('button', { name: 'Preview IMG_0001.JPG', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview IMG_0001.JPG', exact: true });
  const image = dialog.locator('img');
  await expect(image).toHaveJSProperty('naturalWidth', 64);
  const url = await image.getAttribute('src');
  await page.evaluate(async () => {
    const path = '/sparcd-exploration/uploader/src/store.ts';
    const { useStore } = await import(/* @vite-ignore */ path);
    const store = useStore.getState();
    store.removeFile(store.files.find((file: { fileName: string }) => file.fileName === 'IMG_0001.JPG').id);
  });
  await expect(dialog).toHaveCount(0);
  await expect(app.fileListPane()).toBeFocused();
  await expect.poll(() => page.evaluate((url) =>
    (window as unknown as { previewRevocations: string[] }).previewRevocations.includes(url!), url)).toBe(true);
  await expect.poll(() => page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
});

Then('the original local video plays offline and stops on close', async ({ app, context }) => {
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(new URL('../fixtures/inspect-preview.mp4', import.meta.url));
  await app.rescan([{ path: `${FOLDER}/PLAYABLE.MP4`, mime: 'video/mp4', bytes }]);
  await app.waitForInspected();
  if (!(await app.fileListPane().count())) await app.fileListToggle().click();
  const before = await previewBatchSnapshot(app.page);
  await context.setOffline(true);
  await app.page.getByRole('button', { name: 'Preview PLAYABLE.MP4', exact: true }).click();
  const dialog = app.page.getByRole('dialog');
  const video = dialog.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect(video).toHaveJSProperty('paused', true);
  const close = dialog.getByRole('button', { name: 'Close preview' });
  await app.page.keyboard.press('Tab');
  await expect(video).toBeFocused();
  await app.page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', false);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  await app.page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', true);
  // Native media controls live in a browser-owned shadow tree. A host-only
  // focus assertion would miss a trap that skips those controls entirely.
  const session = await context.newCDPSession(app.page);
  async function traverseNativeControls(key: 'Tab' | 'Shift+Tab') {
    let reachedClose = false;
    let nativeControls = 0;
    for (let index = 0; index < 20; index++) {
      await app.page.keyboard.press(key);
      if (await close.evaluate(button => button === document.activeElement)) {
        reachedClose = true;
        break;
      }
      expect(await dialog.evaluate(modal => modal.contains(document.activeElement))).toBe(true);
      const tree = await session.send('Accessibility.getFullAXTree');
      nativeControls += tree.nodes.filter(node => node.properties?.some(property => property.name === 'focused' && property.value.value)
        && node.role?.value !== 'RootWebArea' && node.role?.value !== 'Video').length;
    }
    expect(reachedClose).toBe(true);
    expect(nativeControls).toBeGreaterThan(0);
    await expect(close).toBeFocused();
  }
  await traverseNativeControls('Tab');
  await traverseNativeControls('Shift+Tab');
  await session.detach();
  await app.page.keyboard.press('Tab');
  await expect(video).toBeFocused();
  await video.evaluate((v: HTMLVideoElement) => {
    (window as unknown as { previewPlayer: HTMLVideoElement }).previewPlayer = v;
    return v.play();
  });
  await app.page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => app.page.evaluate(() =>
    (window as unknown as { previewPlayer: HTMLVideoElement }).previewPlayer.paused)).toBe(true);
  expect(await previewBatchSnapshot(app.page)).toBe(before);
  await context.setOffline(false);
});

Then('preview preserves filter and scroll and restores focus after virtualization', async ({ app }) => {
  await app.rescan(manyJpegs(100));
  await app.waitForInspected();
  if (!(await app.fileListPane().count())) await app.fileListToggle().click();
  const list = app.fileListPane();
  await list.evaluate(el => { el.scrollTop = 1000; });
  const opener = app.page.getByRole('button', { name: 'Preview IMG_0025.JPG', exact: true });
  await expect(opener).toBeInViewport();
  const name = await opener.getAttribute('aria-label');
  const scroll = await list.evaluate(el => el.scrollTop);
  await opener.click();
  await app.page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(await list.evaluate(el => el.scrollTop)).toBe(scroll);
  await expect.poll(() => app.page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
  await opener.click();
  // Force the opening row out of the virtual window while background is inert.
  await list.evaluate(el => { el.scrollTop = 5000; });
  await expect(app.page.getByRole('button', { name: name!, exact: true })).toHaveCount(0);
  await app.page.keyboard.press('Escape');
  await expect(list).toBeFocused();
  expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(4000);
  await app.rescan([jpegNoTime('WARNING.JPG'), jpegAt('OK.JPG', '2026:07:01 12:00:00')]);
  await app.waitForInspected();
  await app.page.getByRole('button', { name: /1 warnings/ }).click();
  await app.page.getByRole('button', { name: 'Preview WARNING.JPG', exact: true }).click();
  await app.page.keyboard.press('Escape');
  await expect(app.page.getByRole('button', { name: 'Preview WARNING.JPG', exact: true })).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Preview OK.JPG', exact: true })).toHaveCount(0);
});

Then('preview loading and image errors leave the batch intact in light and dark themes', async ({ app }) => {
  for (const theme of ['light', 'dark']) {
    await app.page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    const before = await previewBatchSnapshot(app.page);
    await app.page.evaluate(() => {
      const block = (event: Event) => {
        if (event.target instanceof HTMLImageElement && event.target.alt === 'IMG_0001.JPG') event.stopImmediatePropagation();
      };
      (window as unknown as { previewLoadBlock: EventListener }).previewLoadBlock = block;
      document.addEventListener('load', block, true);
    });
    await app.page.getByRole('button', { name: 'Preview IMG_0001.JPG', exact: true }).click();
    const dialog = app.page.getByRole('dialog');
    await expect(dialog.getByRole('status')).toContainText('Loading preview');
    await dialog.locator('img').dispatchEvent('error');
    await expect(dialog.getByRole('status')).toContainText('Your batch is unchanged');
    await expect(dialog.getByRole('button', { name: 'Close preview' })).toBeInViewport();
    await dialog.click({ position: { x: 1, y: 150 } });
    await expect(dialog).toBeVisible();
    await app.page.keyboard.press('Escape');
    await expect.poll(() => app.page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
    expect(await previewBatchSnapshot(app.page)).toBe(before);
    await app.page.evaluate(() => document.removeEventListener('load',
      (window as unknown as { previewLoadBlock: EventListener }).previewLoadBlock, true));
  }
});

Then('resetting the batch closes the preview and releases the local media', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Preview IMG_0001.JPG', exact: true }).click();
  const image = app.page.getByRole('dialog').locator('img');
  await expect(image).toHaveJSProperty('naturalWidth', 64);
  const url = await image.getAttribute('src');
  await app.page.evaluate(async () => {
    const path = '/sparcd-exploration/uploader/src/store.ts';
    const { useStore } = await import(/* @vite-ignore */ path);
    useStore.getState().resetBatch();
  });
  await expect(app.page.getByRole('dialog')).toHaveCount(0);
  expect(await app.fileCount()).toBe(0);
  await expect.poll(() => app.page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
  expect(await app.page.evaluate(async url => {
    try { await fetch(url!); return false; } catch { return true; }
  }, url)).toBe(true);
});

Then('a long preview filename wraps at phone width in both themes', async ({ app }) => {
  const name = `camera_${'long_filename_'.repeat(12)}.JPG`;
  await app.rescan([jpegAt(name, '2026:07:01 12:00:00')]);
  await app.waitForInspected();
  if (!(await app.fileListPane().count())) await app.fileListToggle().click();
  await app.page.setViewportSize({ width: 320, height: 480 });
  for (const theme of ['light', 'dark']) {
    await app.page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await app.page.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
    const dialog = app.page.getByRole('dialog');
    await expect(dialog.getByText(name, { exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Close preview' })).toBeInViewport();
    await expect(dialog.locator('img')).toHaveJSProperty('naturalWidth', 64);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const image = await dialog.locator('img').boundingBox();
    expect(image!.height).toBeGreaterThan(0);
    expect(image!.y + image!.height).toBeLessThanOrEqual(480);
    await app.page.keyboard.press('Escape');
    await expect.poll(() => app.page.evaluate(() => history.state?.inspectPreview)).toBeFalsy();
  }
});
