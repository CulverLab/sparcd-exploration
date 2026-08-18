import { expect } from '@playwright/test';
import type { App, FileSpec } from './app';
import { publishableBatch, standardBatch } from './batches';

/** Replace the batch without leaving the connection, ending back on Assign. */
export async function rescanFromAssign(app: App, specs: FileSpec[], opts: { raw?: boolean } = {}): Promise<void> {
  await app.page.getByRole('button', { name: 'Back' }).click();
  await expect(app.fileListPane()).toBeVisible();
  await app.rescan(specs, opts);
  await app.continueToAssign();
  await app.waitForCollections();
}

/** Reconnect (a new connection id ⇒ fresh reads) after changing what storage allows. */
export async function reconnectAndReturnToAssign(
  app: App,
  specs: FileSpec[] = standardBatch(),
): Promise<void> {
  await app.disconnectFromHeader();
  await expect(app.connectForm()).toBeVisible();
  await app.fillConnection();
  await app.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await app.dropFolder(specs);
  await app.waitForInspected();
  await app.continueToAssign();
}

/** The body of the first PUT whose key ends with `suffix`. */
export function writtenBody(app: App, suffix: string): string {
  const put = app.s3.puts.find((p) => p.key.endsWith(suffix));
  expect(put, `no object was written ending in ${suffix}`).toBeTruthy();
  return put!.body;
}

/** Every non-empty row of a written CSV, split into fields. */
export function writtenCsvRows(app: App, suffix: string): string[][] {
  return writtenBody(app, suffix)
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const out: string[] = [];
      let field = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            field += '"';
            i++;
          } else if (ch === '"') inQuotes = false;
          else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') {
          out.push(field);
          field = '';
        } else field += ch;
      }
      out.push(field);
      return out;
    });
}

/** Swap the batch while keeping the Assign choices, ending back on Upload. */
export async function rescanFromUpload(app: App, specs: FileSpec[]): Promise<void> {
  await app.page.getByRole('button', { name: 'Back' }).click();
  await expect(app.page.getByRole('heading', { name: 'Target collection' })).toBeVisible();
  await app.page.getByRole('button', { name: 'Back' }).click();
  await expect(app.fileListPane()).toBeVisible();
  await app.rescan(specs);
  await app.page.getByRole('button', { name: 'Continue' }).click();
  await expect(app.page.getByRole('heading', { name: 'Target collection' })).toBeVisible();
  await app.continueToUpload();
}

export const FAILING_FILE = 'IMG_0002.JPG';

/** Drive a wet run that ends `partial`, with one file refused by storage. */
export async function producePartialRun(app: App, specs: FileSpec[] = publishableBatch()): Promise<void> {
  // A small write delay so the session ledger is fully written before the first
  // objects land — see CORRECTIONS.md on the open-session/per-file-state race.
  app.s3.putDelayMs = 150;
  app.notes.sourceSpecs = specs;
  await app.dropFolder(specs);
  await app.walkToUploadStep({ uploader: 'Ada Lovelace', description: 'July retrieval' });
  app.s3.putHooks.push((_b, key) =>
    key.endsWith(FAILING_FILE) ? { status: 400, code: 'InvalidRequest', message: 'refused' } : undefined,
  );
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('partial', 120_000);
}

/** Drive a wet run all the way through to a published upload. */
export async function produceCompleteRun(app: App, specs: FileSpec[] = publishableBatch()): Promise<void> {
  app.s3.putDelayMs = 150;
  app.notes.sourceSpecs = specs;
  await app.dropFolder(specs);
  await app.walkToUploadStep({ uploader: 'Ada Lovelace', description: 'July retrieval' });
  await app.dryRunCheckbox().uncheck();
  await app.startRunWhileInspecting();
  await app.waitForRunPhase('done');
}
