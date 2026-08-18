import { Given, When, Then, expect } from './fixtures';
import { FOLDER, jpegAt, manyJpegs, mp4At, other, publishableBatch, standardBatch } from './batches';
import type { FileSpec } from './app';
import { jpegWithExifDate } from './fixtures-data';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The chosen directory's own name becomes the top segment of every
// webkitRelativePath, so name it the same as the dragged folder.
const tmpDir = (name: string) =>
  join(tmpdir(), 'sparcd-bdd-folders', `${name}-${Math.random().toString(36).slice(2)}`, FOLDER);

Given('the New upload section is showing the Drop step', async ({ app }) => {
  await app.expectStep('Files');
  await expect(app.page.getByText('Drop a folder of media')).toBeVisible();
});

// --- only JPEG and MP4 are taken ------------------------------------------

When('a folder is chosen that also contains other files', async ({ app }) => {
  await app.dropFolder([
    jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
    mp4At('CLIP_0001.MP4', new Date(Date.UTC(2026, 6, 1, 12, 30, 0))),
    other('NOTES.TXT'),
    other('THUMBS.PNG'),
    other('README'),
  ]);
  await app.waitForInspected();
});

Then('only the JPEG and MP4 files are listed for upload', async ({ app }) => {
  const names = (await app.listedFiles()).map((f) => f.name).sort();
  expect(names).toEqual(['CLIP_0001.MP4', 'IMG_0001.JPG']);
  expect(await app.fileCount()).toBe(2);
});

Then('every other file in the folder is ignored', async ({ app }) => {
  const names = (await app.listedFiles()).map((f) => f.name);
  for (const ignored of ['NOTES.TXT', 'THUMBS.PNG', 'README']) {
    expect(names).not.toContain(ignored);
  }
});

// --- subfolders ------------------------------------------------------------

Given('the chosen folder contains subfolders of images', async ({ app }) => {
  app.notes.batch = [
    jpegAt('IMG_TOP.JPG', '2026:07:01 12:00:00'),
    { path: `${FOLDER}/DCIM/100EK113/IMG_0001.JPG`, mime: 'image/jpeg', bytes: jpegWithExifDate('2026:07:01 12:01:00', 'a') },
    { path: `${FOLDER}/DCIM/101EK113/IMG_0002.JPG`, mime: 'image/jpeg', bytes: jpegWithExifDate('2026:07:01 12:02:00', 'b') },
  ] satisfies FileSpec[];
});

When('the folder is chosen', async ({ app }) => {
  await app.dropFolder(app.notes.batch as FileSpec[]);
  await app.waitForInspected();
});

Then('media in every subfolder is included in the batch', async ({ app }) => {
  expect(await app.fileCount()).toBe(3);
});

Then('each file keeps its path relative to the chosen folder', async ({ app }) => {
  const paths = (await app.listedFiles()).map((f) => f.relPath).sort();
  expect(paths).toEqual([
    `${FOLDER}/DCIM/100EK113/IMG_0001.JPG`,
    `${FOLDER}/DCIM/101EK113/IMG_0002.JPG`,
    `${FOLDER}/IMG_TOP.JPG`,
  ]);
});

// --- drag vs dialog --------------------------------------------------------

When('a folder is dragged onto the drop area', async ({ app }) => {
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
  app.notes.dragged = (await app.listedFiles()).map((f) => ({ name: f.name, relPath: f.relPath }));
});

Then('its media is scanned exactly as if it had been picked from the dialog', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Start over' }).click();
  await app.expectStep('Files');
  await app.pickFolder(standardBatch(), tmpDir('drag-vs-dialog'));
  await app.waitForInspected();
  const picked = (await app.listedFiles()).map((f) => ({ name: f.name, relPath: f.relPath }));
  expect(picked.sort((a, b) => a.relPath.localeCompare(b.relPath))).toEqual(
    (app.notes.dragged as { name: string; relPath: string }[]).sort((a, b) =>
      a.relPath.localeCompare(b.relPath),
    ),
  );
});

// --- empty folder ----------------------------------------------------------

When('a folder containing no JPEG or MP4 files is chosen', async ({ app }) => {
  await app.dropFolder([other('NOTES.TXT'), other('IMAGE.PNG')]);
});

Then('the tool reports that the folder was read but held no images or videos', async ({ app }) => {
  await expect(app.page.getByText('No images or videos in that folder')).toBeVisible();
  await expect(app.page.getByText(/The folder was read but held no/)).toBeVisible();
});

Then('it stays on the Drop step so another folder can be chosen', async ({ app }) => {
  await app.expectStep('Files');
  await expect(app.page.getByText('Choose another folder')).toBeVisible();
});

// --- no folder picker ------------------------------------------------------

Given('the browser cannot present a folder picker', async ({ app }) => {
  await app.makeFolderPickerUnavailable();
});

Then('the drop area offers to choose individual photos or videos instead', async ({ app }) => {
  await expect(app.page.getByText('Choose photos or videos')).toBeVisible();
  await expect(app.page.getByText('Choose folder', { exact: true })).toHaveCount(0);
  await expect(app.page.locator('input[type="file"][accept="image/jpeg,video/mp4"]')).toBeAttached();
});

Then('it states that whole-folder selection is desktop-only', async ({ app }) => {
  await expect(app.page.getByText(/Whole-folder selection is desktop-only/)).toBeVisible();
});

// --- rescanning ------------------------------------------------------------

Given('a batch has already been scanned', async ({ app }) => {
  await app.dropFolder(standardBatch());
  await app.waitForInspected();
  expect(await app.fileCount()).toBe(3);
});

When('another folder is chosen', async ({ app }) => {
  await app.page.getByRole('button', { name: 'Start over' }).click();
  await app.expectStep('Files');
  await app.dropFolder([
    { path: 'OTHERCARD/NEW_0001.JPG', mime: 'image/jpeg', bytes: jpegWithExifDate('2026:08:01 08:00:00', 'n1') },
    { path: 'OTHERCARD/NEW_0002.JPG', mime: 'image/jpeg', bytes: jpegWithExifDate('2026:08:01 08:05:00', 'n2') },
  ]);
  await app.waitForInspected();
});

Then('the earlier batch is discarded', async ({ app }) => {
  const paths = (await app.listedFiles()).map((f) => f.relPath);
  expect(paths.every((p) => p.startsWith('OTHERCARD/'))).toBe(true);
  expect(await app.fileCount()).toBe(2);
});

Then('examination starts over on the new batch', async ({ app }) => {
  const rows = await app.listedFiles();
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(['OK', 'Warning']).toContain(row.status);
  expect(await app.batchSummary()).not.toContain('processing');
});

// --- de-duplication --------------------------------------------------------

When('a folder is scanned', async ({ app }) => {
  // A listing that yields the same path twice, plus one distinct file.
  await app.dropRawEntries([
    jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00', 'first'),
    jpegAt('IMG_0002.JPG', '2026:07:01 12:05:00', 'second'),
    jpegAt('IMG_0001.JPG', '2026:07:01 12:09:00', 'third'),
  ]);
  await app.waitForInspected();
});

Then('each distinct path within the folder appears at most once in the batch', async ({ app }) => {
  const paths = (await app.listedFiles()).map((f) => f.relPath);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths.sort()).toEqual([`${FOLDER}/IMG_0001.JPG`, `${FOLDER}/IMG_0002.JPG`]);
  expect(await app.fileCount()).toBe(2);
});

// --- dragged folders retain no durable access ------------------------------

When('a folder is supplied by dragging it onto the page', async ({ app }) => {
  await app.makeFolderPickerUnavailable();
  await app.dropFolder(publishableBatch());
  await expect(app.fileListPane()).toBeVisible();
});

Then('no lasting access to that folder is retained', async ({ app }) => {
  await app.walkToUploadStep();
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('done');
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].fileAccessMode).toBe('reselect-required');
  expect(batches[0].dirHandle).toBeUndefined();
});

Then('a later resume of that upload asks for the folder to be selected again', async ({ app }) => {
  // Make the session resumable again by clearing its completion marker, then
  // check Resume raises a file picker rather than reading the folder silently.
  await app.page.evaluate(async () => {
    const open = indexedDB.open('sparcd-uploader');
    const db: IDBDatabase = await new Promise((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const tx = db.transaction('batches', 'readwrite');
    const store = tx.objectStore('batches');
    const all: IDBRequest<Record<string, unknown>[]> = store.getAll();
    await new Promise((resolve) => {
      all.onsuccess = () => {
        for (const row of all.result) {
          delete row.completedAt;
          store.put(row);
        }
        resolve(null);
      };
    });
  });
  await app.gotoSection('History');
  const chooser = app.page.waitForEvent('filechooser', { timeout: 20_000 });
  await app.page.getByRole('button', { name: 'Resume' }).click();
  expect((await chooser).isMultiple()).toBe(true);
});

// --- scanning feedback -----------------------------------------------------

When('a large folder is being read', async ({ app }) => {
  await app.dropFolder(manyJpegs(40), { readDelayMs: 60 });
});

Then('the drop area reports that the folder is being scanned', async ({ app }) => {
  await expect(app.page.getByText('Scanning folder…')).toBeVisible();
  await app.waitForInspected();
  expect(await app.fileCount()).toBe(40);
});
