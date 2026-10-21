import { parseMedia, parseObservations } from '@sparcd/camtrap';
import { When, Then, expect, focusFrame, gridCell, openWorkspace, speciesApply, speciesRow } from './support/world';
import { BUCKET, PREFIX_A } from './support/data';
import { openSyncDialog, readStore, setSyncDryRun, waitForSyncDialogClosed, runLiveSync } from './support/flows';

const path = `${PREFIX_A}IMG002.JPG`;
const expertName = "Toggle needing an expert's opinion";
type RetryDraft = { mediaPath: string; dirty: boolean; questionable: boolean; timeOverride: string | null; observations: { scientificName: string }[] };

When('a Need expert sync fails after publishing media', async ({ page, s3, scratch }) => {
  if (!scratch.savedExpert) await page.getByRole('button', { name: expertName }).click();
  let failed = false;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!failed && request.method() === 'PUT' && request.headers()['if-match'] &&
        decodeURIComponent(new URL(request.url()).pathname).endsWith(`/${PREFIX_A}UploadMeta.json`)) {
      failed = true;
      await route.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code><Message>Simulated retry failure</Message></Error>' });
    } else await route.fallback();
  });
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('p.border-warn')).toBeVisible();
  expect(failed).toBe(true);
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find((media) => media.mediaId === path)?.comments).toContain('[NEED_EXPERT:true]');
  const journals = await readStore(page, 'syncJournals') as { receipt?: { draftRevisions: Record<string, string> } }[];
  expect(journals[0].receipt?.draftRevisions[path]).toBeTruthy();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

When('the interrupted image receives a {string} edit', async ({ page, scratch }, edit: string) => {
  scratch.retryEdit = edit;
  if (edit === 'species') await speciesApply(page, 'Canis latrans').click();
  else if (edit === 'status') await page.getByRole('button', { name: expertName }).click();
  else if (edit === 'time') {
    await gridCell(page, 'IMG001.JPG').click();
    await gridCell(page, 'IMG002.JPG').click({ modifiers: ['ControlOrMeta'] });
    await gridCell(page, 'IMG001.JPG').click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Time shift selection', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Time shift · selection' });
    await dialog.getByRole('button', { name: 'Increase Hour', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply to 1 selected frame →', exact: true }).click();
  }
  await focusFrame(page, 'IMG002.JPG');
  await page.keyboard.press('Control+s');
  if (edit !== 'unchanged') {
    const draft = (await readStore(page, 'drafts') as RetryDraft[]).find((entry) => entry.mediaPath === path)!;
    expect(draft.dirty).toBe(true);
    if (edit === 'status') expect(draft.questionable).toBe(false);
    if (edit === 'time') expect(draft.timeOverride).toBe('2024-01-10T09:00:30.000-07:00');
  }
});

When('the interrupted sync is resumed after a browser reload', async ({ page }) => {
  await page.reload();
  await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
  await waitForSyncDialogClosed(page);
});

Then('the journaled status is saved and the {string} draft is acknowledged correctly', async ({ page, s3 }, edit: string) => {
  const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find((entry) => entry.mediaId === path)!;
  expect(media.comments).toContain('[NEED_EXPERT:true]');
  expect(media.timestamp).toBe('2024-01-10T08:00:30');
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter((entry) => entry.mediaId === path)).toEqual([]);
  const draft = (await readStore(page, 'drafts') as RetryDraft[]).find((entry) => entry.mediaPath === path)!;
  expect(draft.dirty).toBe(edit !== 'unchanged');
  if (edit === 'species') expect(draft.observations[0].scientificName).toBe('Canis latrans');
  if (edit === 'status') expect(draft.questionable).toBe(false);
  if (edit === 'time') expect(draft.timeOverride).toBe('2024-01-10T09:00:30.000-07:00');
  expect(await readStore(page, 'syncJournals')).toEqual([]);
});

Then('the retry result survives another reload', async ({ page, scratch }) => {
  await page.reload();
  await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  await expect(page.getByRole('button', { name: expertName })).toHaveAttribute('aria-pressed', scratch.retryEdit === 'status' ? 'false' : 'true');
  if (scratch.retryEdit === 'species') await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
  const drafts = await readStore(page, 'drafts') as RetryDraft[];
  expect(drafts.find((draft) => draft.mediaPath === path)?.dirty).toBe(scratch.retryEdit !== 'unchanged');
});

Then('the retained edit can be saved separately', async ({ page, s3, scratch }) => {
  await openSyncDialog(page);
  if (scratch.retryEdit === 'unchanged') {
    await expect(page.getByText('No local edits to sync — everything matches the canonical files.')).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
  await waitForSyncDialogClosed(page);
  const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find((entry) => entry.mediaId === path)!;
  if (scratch.retryEdit === 'status') expect(media.comments).not.toContain('[NEED_EXPERT:true]');
  if (scratch.retryEdit === 'species') expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find((entry) => entry.mediaId === path)?.scientificName).toBe('Canis latrans');
  if (scratch.retryEdit === 'time') expect(media.timestamp).toBe('2024-01-10T09:00:30.000-07:00');
  const drafts = await readStore(page, 'drafts') as RetryDraft[];
  expect(drafts.find((draft) => draft.mediaPath === path)?.dirty).toBe(false);
});

When('a saved expert image receives a {string} draft', async ({ page, scratch }, edit: string) => {
  await page.getByRole('button', { name: expertName }).click();
  await runLiveSync(page);
  await page.reload();
  await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  scratch.savedExpert = true;
  if (edit === 'drop') await speciesRow(page, 'Canis latrans').dragTo(gridCell(page, 'IMG002.JPG'));
  else {
    await gridCell(page, 'IMG001.JPG').click();
    await gridCell(page, 'IMG002.JPG').click({ modifiers: ['ControlOrMeta'] });
    await gridCell(page, 'IMG001.JPG').click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Time shift selection', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Time shift · selection' });
    await dialog.getByRole('button', { name: 'Increase Hour', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply to 1 selected frame →', exact: true }).click();
  }
  await page.keyboard.press('Control+s');
  const draft = (await readStore(page, 'drafts') as (RetryDraft & { baseQuestionable: boolean })[]).find(entry => entry.mediaPath === path)!;
  expect(draft.questionable).toBe(true);
  expect(draft.baseQuestionable).toBe(true);
});

Then('the saved expert marker survives retry and the subsequent sync', async ({ page, s3 }) => {
  await expect(page.getByRole('button', { name: expertName })).toHaveAttribute('aria-pressed', 'true');
  await runLiveSync(page);
  await page.reload();
  await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  await expect(page.getByRole('button', { name: expertName })).toHaveAttribute('aria-pressed', 'true');
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find(media => media.mediaId === path)?.comments).toContain('[NEED_EXPERT:true]');
});
