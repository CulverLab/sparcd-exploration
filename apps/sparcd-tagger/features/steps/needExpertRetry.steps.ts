import { parseMedia, parseObservations, parseCsvRows, serializeCsvRows, MEDIA_COL } from '@sparcd/camtrap';
import { When, Then, expect, focusFrame, gridCell, openWorkspace, speciesApply } from './support/world';
import { BUCKET, PREFIX_A } from './support/data';
import { readStore, waitForAutomaticSave } from './support/flows';
const path = `${PREFIX_A}IMG002.JPG`;
const expertName = "Toggle needing an expert's opinion";
async function holdMetadata(page: import('@playwright/test').Page, scratch: Record<string, unknown>) {
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  scratch.retryRelease = release;
  let failed = false;
  await page.route('**/*', async route => {
    if (!failed && route.request().method() === 'PUT' && route.request().headers()['if-match'] && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}UploadMeta.json`)) {
      failed = true; enter(); await gate;
      await route.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code><Message>Simulated retry failure</Message></Error>' });
    } else await route.fallback();
  });
  return entered;
}
// Start the gate without awaiting it before the UI action that reaches it.
When('a Need expert save is held after publishing media', async ({ page, s3, scratch }) => {
  const entered = holdMetadata(page, scratch);
  await focusFrame(page, 'IMG002.JPG'); await page.getByRole('button', { name: expertName }).click(); await entered;
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find(row => row.mediaId === path)!.comments).toContain('[NEED_EXPERT:true]');
});
async function edit(page: import('@playwright/test').Page, name: string) {
  if (name === 'species') await speciesApply(page, 'Canis latrans').click();
  if (name === 'drop') await page.getByRole('button', { name: 'Clear Species', exact: true }).click();
  if (name === 'status') await page.getByRole('button', { name: expertName }).click();
  if (name === 'time') {
    await gridCell(page, 'IMG001.JPG').click(); await gridCell(page, 'IMG002.JPG').click({ modifiers: ['ControlOrMeta'] }); await gridCell(page, 'IMG001.JPG').click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Time shift selection', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Time shift · selection' });
    await dialog.getByRole('button', { name: 'Increase Hour', exact: true }).click(); await dialog.getByRole('button', { name: 'Apply to 1 selected frame →', exact: true }).click();
  }
}
When('a later {string} action is accepted during that save', async ({ page }, name: string) => { await focusFrame(page, 'IMG002.JPG'); await edit(page, name); });
When('a saved expert image receives a {string} action during an earlier save', async ({ page, s3, scratch }, name: string) => {
  scratch.savedExpert = true;
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}media.csv`)); rows.find(row => row[MEDIA_COL.mediaId] === path)![MEDIA_COL.comments] += '[NEED_EXPERT:true]';
  s3.put(BUCKET, `${PREFIX_A}media.csv`, serializeCsvRows(rows), 'text/csv');
  await page.reload(); await openWorkspace(page); await waitForAutomaticSave(page);
  const entered = holdMetadata(page, scratch);
  await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click(); await entered;
  await focusFrame(page, 'IMG002.JPG'); await edit(page, name);
});
When('the earlier save fails and the browser reloads', async ({ page, scratch }) => {
  (scratch.retryRelease as () => void)(); await expect(page.getByTestId('automatic-save')).toContainText('Save failed');
  expect(await readStore(page, 'syncJournals')).toHaveLength(1);
  await page.reload(); await openWorkspace(page); await waitForAutomaticSave(page);
});
Then('the complete {string} result is stored with no pending drafts', async ({ page, s3, scratch }, name: string) => {
  const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find(row => row.mediaId === path)!;
  expect(media.comments.includes('[NEED_EXPERT:true]')).toBe(name !== 'status');
  expect(media.timestamp).toBe(name === 'time' ? '2024-01-10T09:00:30.000-07:00' : '2024-01-10T08:00:30');
  const species = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.mediaId === path && row.scientificName);
  expect(species.map(row => row.scientificName)).toEqual(name === 'species' || !!scratch.savedExpert && name !== 'drop' ? ['Canis latrans'] : []);
  expect((await readStore(page, 'drafts') as { dirty: boolean }[]).filter(row => row.dirty)).toEqual([]);
  expect(await readStore(page, 'syncJournals')).toEqual([]);
});
Then('retrying and reloading cannot duplicate its attribution events', async ({ page, s3 }) => {
  const before = s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`);
  await waitForAutomaticSave(page); await page.reload(); await openWorkspace(page); await waitForAutomaticSave(page);
  expect(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).toBe(before);
  const actions = JSON.parse(before).taggerActions as { id: string }[]; expect(new Set(actions.map(action => action.id)).size).toBe(actions.length);
});
