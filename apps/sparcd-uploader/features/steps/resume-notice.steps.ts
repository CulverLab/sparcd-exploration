import { Given, Then, expect } from './fixtures';
import { publishableBatch } from './batches';
import { producePartialRun } from './helpers';

Given('the resume notice has a {word} upload', async ({ app }, kind: string) => {
  if (kind === 'failed' || kind === 'multiple') {
    await producePartialRun(app);
  } else {
    app.s3.putDelayMs = 150;
    await app.dropFolder(publishableBatch());
    await app.walkToUploadStep({ uploader: 'Ada Lovelace' });
    await app.dryRunCheckbox().uncheck();
    if (kind === 'publication') {
      app.s3.putHooks.push((_bucket, key) => key.endsWith('UploadMeta.json')
        ? { status: 400, code: 'InvalidRequest', message: 'Publication refused' } : undefined);
    } else {
      app.s3.holdPut = () => true;
    }
    await app.startRun();
    if (kind === 'publication') await app.waitForRunPhase('error');
    else {
      await app.waitForRunPhase('uploading');
      await app.page.getByRole('button', { name: 'Cancel', exact: true }).click();
      app.s3.releaseHeldPuts();
      await expect(app.page.getByText('cancelled').first()).toBeVisible();
    }
  }
  const [batch] = await app.readBatchRecords();
  const files = await app.readFileRecords();
  app.notes.noticeStamp = String(batch.uploadPrefix).split('/').pop();
  if (kind === 'publication') {
    expect(files.every(file => file.state === 'done')).toBe(true);
    expect(batch.completedAt).toBeUndefined();
  }
  if (kind === 'multiple') {
    await app.page.evaluate(async () => {
      const request = indexedDB.open('sparcd-uploader');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction(['batches', 'files'], 'readwrite');
      const batches = transaction.objectStore('batches');
      const records = transaction.objectStore('files');
      const get = batches.getAll();
      get.onsuccess = () => {
        const original = get.result[0];
        const id = `${original.id}-newer-paused`;
        batches.put({ ...original, id, uploadPrefix: `${original.uploadPrefix}-newer-paused`, startedAt: '2099-01-01T00:00:00Z' });
        const rows = records.getAll();
        rows.onsuccess = () => rows.result.filter(row => row.sessionId === original.id).forEach(row =>
          records.put({ ...row, id: `${id}::${row.localPath}`, sessionId: id, state: 'pending' }));
      };
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    });
  }
  await app.reopen();
});

Then('the notice explains the {word} upload in both themes and phone layouts', async ({ app }, kind: string) => {
  const notice = app.page.getByRole('status', { name: 'Unfinished uploads' });
  await expect(notice).toContainText(app.notes.noticeStamp as string);
  if (kind === 'failed' || kind === 'multiple') {
    await expect(notice).toContainText('An interrupted upload failed:');
    await expect(notice).toContainText('1 failed');
    await expect(notice).toContainText('Open History to fix.');
    if (kind === 'multiple') {
      await expect(notice).toContainText('+1 more in History');
      await expect(notice).not.toContainText('newer-paused');
    }
  } else if (kind === 'publication') {
    await expect(notice).toContainText('All files uploaded, but publication is incomplete.');
    await expect(notice).toContainText('Open History to review and finish.');
    await expect(notice).not.toContainText('failed');
  } else {
    await expect(notice).toContainText('An interrupted upload is waiting:');
    await expect(notice).toContainText('Open History to review and continue.');
    await expect(notice).not.toContainText('failed');
  }
  for (const width of [320, 375, 1280]) {
    await app.page.setViewportSize({ width, height: 720 });
    for (const theme of ['light', 'dark']) {
      await app.page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await expect(notice.getByRole('button', { name: 'Open History', exact: true })).toBeInViewport();
      expect(await notice.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const paragraph = notice.locator('p');
      const color = await paragraph.evaluate(el => {
        const sample = document.createElement('span');
        sample.style.color = 'var(--warn)';
        document.body.append(sample);
        const expected = getComputedStyle(sample).color;
        sample.remove();
        return { actual: getComputedStyle(el).color, expected };
      });
      expect(color.actual).toBe(color.expected);
    }
  }
});

Then('the notice opens History from the keyboard', async ({ app }) => {
  const button = app.page.getByRole('status', { name: 'Unfinished uploads' }).getByRole('button', { name: 'Open History', exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  await app.page.keyboard.press('Enter');
  await expect(app.page.getByText('Published uploads', { exact: true })).toBeVisible();
});

Then('there is no unfinished upload notice', async ({ app }) => {
  await expect(app.page.getByText('Drop a folder to upload')).toBeVisible();
  await expect(app.page.getByRole('status', { name: 'Unfinished uploads' })).toHaveCount(0);
});
