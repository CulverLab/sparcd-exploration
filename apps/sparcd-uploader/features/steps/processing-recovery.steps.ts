import { Given, When, Then, expect } from './fixtures';
import type { App } from './app';
import { publishableBatch } from './batches';

const NAME = 'BIG_CLIP.MP4';
const metadata = /\/(deployments\.csv|media\.csv|observations\.csv|UploadMeta\.json|UploadComplete\.json)$/;

async function failProcessingDuringUpload(app: App, persistent: boolean): Promise<void> {
  await app.holdInspect(NAME);
  await app.page.evaluate(({ name, persistent }) => {
    const state = window as unknown as { __processingFailureEnabled: boolean };
    state.__processingFailureEnabled = true;
    const post = Worker.prototype.postMessage;
    let failed = false;
    Worker.prototype.postMessage = function (message: { id: string; file?: File }, ...rest: [Transferable[]?]) {
      if (state.__processingFailureEnabled && message.file?.name === name && (persistent || !failed)) {
        failed = true;
        setTimeout(() => this.onmessage?.call(this, new MessageEvent('message', {
          data: { id: message.id, error: 'Network error while reading source file' },
        })), 0);
        return;
      }
      post.call(this, message, ...(rest as [Transferable[]]));
    };
  }, { name: NAME, persistent });
  await app.dropFolder(publishableBatch());
  await app.walkToUploadStep({ uploader: 'Ada Lovelace', description: 'Processing recovery' });
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await expect.poll(() => app.s3.puts.filter((p) => !metadata.test(p.key)).length).toBe(3);
  await app.releaseHeldInspect();
  await app.waitForRunPhase('partial');
  const [batch] = await app.readBatchRecords();
  app.notes.processingBatch = batch;
  app.notes.completedMedia = app.s3.puts.filter((p) => !metadata.test(p.key)).map((p) => p.key);
  const failed = (await app.readFileRecords()).find((f) => f.fileName === NAME)!;
  expect(failed.state).toBe('failed');
  expect(failed.sha256).toBeUndefined();
}

Given('file processing fails transiently after uploading starts', async ({ app }) => {
  await failProcessingDuringUpload(app, false);
});

Given('file processing keeps failing after uploading starts', async ({ app }) => {
  await failProcessingDuringUpload(app, true);
});

Then('the processing error keeps its source filename visible', async ({ app }) => {
  const row = app.page.locator('[data-index]').filter({ hasText: 'Network error while reading source file' });
  await expect(row.getByText(NAME, { exact: true })).toBeVisible();
});

When('processing recovery is requested from {string}', async ({ app }, page: string) => {
  if (page === 'Upload') {
    await app.page.getByRole('button', { name: 'Retry failed files', exact: true }).click();
  } else {
    if (page === 'History after reload') {
      await app.reopen();
      await app.seedPickedFolder(publishableBatch());
    } else {
      await app.page.evaluate(() => {
        window.showDirectoryPicker = async () => { throw new Error('Unexpected folder picker for available source files'); };
      });
    }
    await app.gotoSection('History');
    await app.page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  }
});

Then('every source file is published in the original upload without duplicating completed files', async ({ app }) => {
  await app.waitForRunPhase('done');
  const before = app.notes.processingBatch as Record<string, unknown>;
  const [batch] = await app.readBatchRecords();
  expect(batch.id).toBe(before.id);
  expect(batch.uploadPrefix).toBe(before.uploadPrefix);
  expect(batch.completedAt).toBeTruthy();
  const puts = app.s3.puts.filter((p) => !metadata.test(p.key));
  expect(puts).toHaveLength(4);
  for (const key of app.notes.completedMedia as string[]) expect(puts.filter((p) => p.key === key)).toHaveLength(1);
  expect((await app.readFileRecords()).every((f) => f.state === 'done')).toBe(true);
  const media = app.s3.puts.find((p) => p.key.endsWith('/media.csv'))!;
  expect(media.body).toContain(NAME);
  expect(app.s3.puts.some((p) => p.key.endsWith('/UploadComplete.json'))).toBe(true);
  await expect(app.page.getByText(/Still inspecting/)).not.toBeVisible();
  await app.page.evaluate(async () => {
    const path = '/sparcd-exploration/uploader/src/store.ts';
    const { useStore } = await import(/* @vite-ignore */ path);
    const source = useStore.getState().files.find((file: { fileName: string }) => file.fileName === 'BIG_CLIP.MP4');
    // A reload has no wizard File objects; same-session recovery must update them.
    if (source && (source.processState !== 'ready' || source.processError !== undefined)) {
      throw new Error('Recovered source file still has stale processing state');
    }
  });
});

Then('failed History recovery preserves the original upload lock', async ({ app }) => {
  await expect(app.page.getByText('Some source files could not be processed. Check the files and try Resume again.')).toBeVisible();
  await app.gotoSection('New upload');
  await expect(app.page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(app.page.getByRole('button', { name: 'Start upload', exact: true })).not.toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Retry failed files', exact: true })).toBeEnabled();
  const batches = await app.readBatchRecords();
  expect(batches).toHaveLength(1);
  expect(batches[0].id).toBe((app.notes.processingBatch as Record<string, unknown>).id);
});

When('source processing becomes available again', async ({ app }) => {
  await app.page.evaluate(() => {
    (window as unknown as { __processingFailureEnabled: boolean }).__processingFailureEnabled = false;
  });
});

Then('the unreadable file is named and publication remains blocked', async ({ app }) => {
  await expect(app.page.getByText(/Couldn't resume this upload/)).toContainText(NAME);
  await expect(app.page.getByText(/Couldn't resume this upload/)).toContainText('source file is readable');
  expect(app.s3.puts.filter((p) => metadata.test(p.key))).toHaveLength(0);
  expect((await app.readBatchRecords())[0].completedAt).toBeUndefined();
  await expect(app.page.getByRole('button', { name: 'Retry failed files', exact: true })).toBeEnabled();
});

When('retry processing is held in progress', async ({ app }) => {
  await app.holdInspect(NAME);
  await app.page.getByRole('button', { name: 'Retry failed files', exact: true }).click();
});

Then('recovery progress is visible and another retry is disabled', async ({ app }) => {
  await expect(app.page.getByRole('status').filter({ hasText: 'Preparing resume' })).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Preparing resume…', exact: true })).toBeDisabled();
});

When('retry processing is released', async ({ app }) => {
  await app.releaseHeldInspect();
});
