import { test, expect, type FileChooser } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { App } from '../../features/steps/app';
import { S3Mock } from '../../features/steps/s3mock';
import { seedDefaultStorage } from '../../features/steps/fixtures-data';
import { jpegAt } from '../../features/steps/batches';

for (const path of ['Flip files', 'Flip directory', 'preparation directory'] as const) {
  for (const replace of [false, true]) {
    test(`${path}: ${replace ? 'account replacement rejects stale selection and allows a fresh retry' : 'cancel then reselect preserves normal recovery'}`, async ({ page }, info) => {
      const s3 = new S3Mock(); seedDefaultStorage(s3);
      const app = new App(page, s3);
      await app.open({ noFolderPicker: path === 'Flip files', noDirectoryHandle: path !== 'Flip files' });
      await app.connect();
      const area = page.getByRole('region', { name: 'Prepare species for local tagging' });
      await area.getByRole('button', { name: 'Collection for species preparation', exact: true }).click();
      await area.getByRole('option').filter({ hasText: 'Alpha Collection' }).click();
      await area.getByRole('button', { name: 'Prepare species', exact: true }).click();
      await expect(area.getByRole('status')).toContainText('Species prepared for');
      const spec = { ...jpegAt('OLD.JPG', '2026:07:01 12:00:00'), ...(path === 'Flip files' ? { path: 'OLD.JPG' } : {}) };
      await app.dropFolder([spec]); await app.waitForInspected();
      await expect(page.getByText('Local preparation saved. Original files remain in your folder.', { exact: true })).toBeVisible();
      if (path.startsWith('Flip')) {
        await page.getByRole('button', { name: 'Tag species before upload', exact: true }).click();
        await page.waitForURL(/\/tagger\/\?batch=/);
        const record = (await app.readFlipRecords())[0];
        await page.goto(record.returnUrl);
      } else await page.reload();
      const button = page.getByRole('button', { name: path === 'Flip files' ? 'Choose photos or videos' : path === 'Flip directory' ? 'Choose folder' : 'Reselect saved batch folder', exact: true });
      async function openPicker() {
        const pending = page.waitForEvent('filechooser');
        await button.click();
        return pending;
      }
      let chooser = await openPicker();
      if (!replace) {
        if (path === 'Flip files') await chooser.setFiles([]);
        else {
          // Playwright rejects [] for directory inputs before reaching Chrome.
          // Send the empty picker result through Chrome's DOM protocol instead.
          const cdp = await page.context().newCDPSession(page);
          try {
            const { root } = await cdp.send('DOM.getDocument');
            const selector = path.startsWith('Flip') ? 'input[type="file"]' : 'section[aria-label="Saved local preparation"] input[type="file"]';
            const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
            await cdp.send('DOM.setFileInputFiles', { nodeId, files: [] });
          } finally { await cdp.detach(); }
        }
        await expect(button).toBeEnabled();
        chooser = await openPicker();
      } else {
        // The established shared-session transport is the production boundary.
        await page.evaluate(() => {
          const channel = new BroadcastChannel('sparcd-connection-live');
          const current = JSON.parse(localStorage.getItem('sparcd-connection-revision') ?? 'null');
          const counter = Number.isSafeInteger(current?.revision?.counter)
            ? current.revision.counter + 1
            : 1;
          channel.postMessage({
            protocol: 1,
            revision: { counter, id: crypto.randomUUID() },
            connected: true,
            type: 'connect',
            config: { endpoint: 'https://replacement.example', region: 'us-west-2', accessKey: 'AKIAREPLACEMENT', secretKey: 'replacement-secret', forcePathStyle: false, secure: true },
          });
          channel.close();
        });
        await expect(page.locator('header')).toContainText('replacement.example');
      }
      async function selectOriginal(picker: FileChooser) {
        if (path === 'Flip files') return picker.setFiles({ name: 'OLD.JPG', mimeType: 'image/jpeg', buffer: spec.bytes! });
        // Keep disk bytes until the worker and browser context have finished.
        const folder = info.outputPath('SDCARD'); await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'OLD.JPG'), spec.bytes!);
        await picker.setFiles(folder);
      }
      await selectOriginal(chooser);
      if (replace) {
        await expect(page.getByRole('alert').filter({ hasText: 'The batch or connection changed' })).toBeVisible();
        await expect(app.activeStep()).toContainText('Choose');
        await expect(page.getByRole('button', { name: 'Tag species before upload', exact: true })).toHaveCount(0);
        // A new explicit recovery belongs to the replacement session.
        await selectOriginal(await openPicker());
      }
      await app.waitForInspected();
      await expect(area.getByRole('status')).toContainText('Species prepared for Alpha Collection');
      await app.showFileList();
      await expect(app.fileListPane()).toContainText('OLD.JPG');
      await expect(page.getByRole('alert').filter({ hasText: 'The batch or connection changed' })).toHaveCount(0);
    });
  }
}
