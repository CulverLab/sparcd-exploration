import { Given, When, Then, expect } from './fixtures';
import { publishableBatch } from './batches';
import { producePartialRun } from './helpers';
import { BUCKET_A } from './fixtures-data';

const isMetadata = (key: string) => /\/(deployments\.csv|media\.csv|observations\.csv|UploadMeta\.json|UploadComplete\.json)$/.test(key);

When('a fresh upload completes for the status summary', async ({ app }) => {
  await app.dropFolder(publishableBatch());
  await app.walkToUploadStep();
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
});

Given('{int} files were already uploaded before interruption', async ({ app }, count: number) => {
  await producePartialRun(app, publishableBatch().slice(0, count + 1));
  const [batch] = await app.readBatchRecords();
  app.notes.statusSession = batch.id;
  const stored = (await app.readFileRecords()).filter(file => file.state === 'done');
  expect(stored).toHaveLength(count);
  app.notes.statusObject = `${BUCKET_A}/${stored[0].remoteKey}`;
  app.notes.statusFile = stored[0].localPath;
});

When('status recovery is requested from {string}', async ({ app }, page: string) => {
  app.s3.putHooks.length = 0;
  if (page === 'History') {
    await app.gotoSection('History');
    await app.page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  } else {
    await app.page.getByRole('button', { name: 'Retry failed files', exact: true }).click();
  }
});

Then('completion explains {int} newly uploaded and {int} already verified files', async ({ app }, uploaded: number, verified: number) => {
  await expect(app.runPhase()).toHaveText('done', { timeout: 60_000 });
  const dialog = app.page.getByRole('dialog', { name: 'Upload complete' });
  await expect(dialog).toContainText(`Published ${uploaded + verified} files`);
  await expect(dialog).toContainText(`${uploaded} uploaded this attempt; ${verified} already stored and verified.`);
  await dialog.getByRole('button', { name: 'OK' }).click();
  const monitor = app.page.locator('section').filter({ has: app.page.locator('[data-index]') });
  await expect(monitor).toContainText(`${uploaded + verified} complete`);
  await expect(monitor.getByText('Already stored on server — verified', { exact: true })).toHaveCount(verified);
  await expect(monitor).not.toContainText('skipped');
  const states = await monitor.locator('[data-index] .text-right').allTextContents();
  expect(states).toHaveLength(uploaded + verified);
  expect(states.every(state => state === 'done')).toBe(true);
  if (app.notes.statusSession) expect((await app.readBatchRecords())[0].id).toBe(app.notes.statusSession);
  await app.page.setViewportSize({ width: 360, height: 780 });
  await expect.poll(() => monitor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

Then('automatic recovery is not reported', async ({ app }) => {
  await expect(app.page.getByRole('status').filter({ hasText: /automatically|Automatic recovery/ })).toHaveCount(0);
});

Given('a previously stored object is now missing', async ({ app }) => {
  app.s3.objects.delete(app.notes.statusObject as string);
});

Given('a previously stored object has a different {string}', async ({ app }, property: string) => {
  const object = app.s3.objects.get(app.notes.statusObject as string)!;
  if (property === 'size') object.body = Buffer.concat([object.body, Buffer.from('changed')]);
  else object.meta.sha256 = 'different-fingerprint';
});

Then('the mismatched server object is not reported as done', async ({ app }) => {
  await expect(app.runPhase()).toHaveText('error');
  await expect(app.page.getByRole('dialog', { name: 'Upload complete' })).toHaveCount(0);
  const row = app.page.locator('[data-index]').filter({ has: app.page.locator(`span[title$="${String(app.notes.statusFile).split('/').pop()}"]`) });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.text-right')).not.toHaveText('done');
  await expect(row.getByText('Already stored on server — verified', { exact: true })).toHaveCount(0);
  expect((await app.readBatchRecords())[0].completedAt).toBeUndefined();
});

Given('the connection interrupted publication after all files were stored', async ({ app }) => {
  await app.dropFolder(publishableBatch());
  await app.walkToUploadStep();
  let held = false;
  app.s3.gatePut = (_bucket, key) => {
    if (held || !key.endsWith('/UploadMeta.json')) return false;
    held = true;
    return true;
  };
  await (await app.dryRunCheckbox()).uncheck();
  await app.startRun();
  await expect.poll(() => app.s3.gated.find(key => key.endsWith('/UploadMeta.json'))).toBeTruthy();
  app.s3.offline = true;
  app.s3.releaseGatedPut(app.s3.gated.find(key => key.endsWith('/UploadMeta.json'))!);
  await app.waitForRunPhase('partial');
  expect(app.s3.puts.filter(put => !isMetadata(put.key))).toHaveLength(4);
  app.notes.statusSession = (await app.readBatchRecords())[0].id;
});

When('the connection returns for automatic status recovery', async ({ app }) => {
  app.s3.offline = false;
  const gatedBefore = app.s3.gated.length;
  app.s3.gatePut = (_bucket, key) => key.endsWith('/UploadMeta.json');
  await app.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => app.s3.gated.length, { timeout: 60_000 }).toBeGreaterThan(gatedBefore);
  await expect(app.page.getByRole('status').filter({ hasText: 'Automatic recovery: continuing the existing upload after an interruption.' })).toBeVisible();
  app.s3.gatePut = undefined;
  app.s3.releaseGatedPut(app.s3.gated.at(-1)!);
});

Then('the upload explains that it recovered automatically', async ({ app }) => {
  await expect(app.page.getByRole('status').filter({ hasText: 'This upload resumed automatically after an interruption.' })).toBeVisible();
  expect(app.s3.puts.filter(put => !isMetadata(put.key))).toHaveLength(4);
});
