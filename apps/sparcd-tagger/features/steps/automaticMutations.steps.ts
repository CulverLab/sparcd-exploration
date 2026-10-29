import { parseMedia, parseObservations, parseCsvRows, OBS_COL } from '@sparcd/camtrap';
import { When, Then, expect, focusFrame, gridCell, speciesApply } from './support/world';
import { BUCKET, PREFIX_A } from './support/data';
import { waitForAutomaticSave } from './support/flows';
const path = `${PREFIX_A}IMG002.JPG`;
const expert = "Toggle needing an expert's opinion";
When('all species on an identified image are removed and automatically saved', async ({ page, s3, scratch }) => {
  scratch.originalSpecies = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(row => row.mediaId === `${PREFIX_A}IMG001.JPG`);
  await focusFrame(page, 'IMG001.JPG'); await page.getByRole('button', { name: 'Clear Species', exact: true }).click(); await waitForAutomaticSave(page);
});
Then('the stored removal retains a blank slot and its provenance', async ({ s3 }) => {
  const rows = parseCsvRows(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row[OBS_COL.mediaId] === `${PREFIX_A}IMG001.JPG`);
  expect(rows).toHaveLength(1); expect(rows[0][OBS_COL.scientificName]).toBe(''); expect(rows[0][OBS_COL.comments]).toContain('REMOVED');
});
Then('its original species and identifier are restored', async ({ s3, scratch }) => {
  const original = scratch.originalSpecies as ReturnType<typeof parseObservations>[number];
  const row = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).find(row => row.mediaId === original.mediaId)!;
  expect(row.scientificName).toBe(original.scientificName); expect(row.count).toBe(original.count); expect(row.classifiedBy).toBe(original.classifiedBy);
});
async function selectTwo(page: import('@playwright/test').Page) {
  await gridCell(page, 'IMG002.JPG').click(); await gridCell(page, 'IMG005.JPG').click({ modifiers: ['ControlOrMeta'] });
}
When('a species is assigned to a two-image selection and automatically saved', async ({ page, s3, scratch }) => {
  scratch.bulkOriginal = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  await selectTwo(page); await speciesApply(page, 'Canis latrans').click(); await waitForAutomaticSave(page);
  const rows = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.scientificName === 'Canis latrans' && [path, `${PREFIX_A}IMG005.JPG`].includes(row.mediaId));
  expect(rows.map(row => row.mediaId).sort()).toEqual([path, `${PREFIX_A}IMG005.JPG`].sort());
});
When('a different image is selected', async ({ page }) => { await gridCell(page, 'IMG001.JPG').click(); });
Then("only the bulk action's original targets are reversed", async ({ s3, scratch }) => {
  const rows = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.scientificName);
  expect(rows.map(row => [row.mediaId, row.scientificName, row.count])).toEqual((scratch.bulkOriginal as ReturnType<typeof parseObservations>).filter(row => row.scientificName).map(row => [row.mediaId, row.scientificName, row.count]));
  const audit = JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).taggerActions; expect(audit).toHaveLength(2); expect(audit[0].changes).toHaveLength(2);
});
When('a two-image selection is shifted and automatically saved', async ({ page, s3, scratch }) => {
  scratch.bulkTimes = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).map(row => [row.mediaId, row.timestamp, row.timestampSource]);
  await selectTwo(page); await page.getByRole('button', { name: 'Time shift selection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Time shift · selection' });
  await dialog.getByRole('button', { name: 'Increase Hour', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply to 2 selected frames →', exact: true }).click(); await waitForAutomaticSave(page);
});
Then('the original timestamps and source markers are restored', async ({ s3, scratch }) => {
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).map(row => [row.mediaId, row.timestamp, row.timestampSource])).toEqual(scratch.bulkTimes);
});
When('Need expert alone is automatically saved', async ({ page, s3 }) => {
  await focusFrame(page, 'IMG002.JPG'); await page.getByRole('button', { name: expert, exact: true }).click(); await waitForAutomaticSave(page);
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find(row => row.mediaId === path)!.comments).toContain('[NEED_EXPERT:true]');
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row.mediaId === path)).toEqual([]);
});
Then('only the expert status is reversed', async ({ s3 }) => {
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).find(row => row.mediaId === path)!.comments).not.toContain('[NEED_EXPERT:true]');
});
When('storage refuses safe conditional replacement', async ({ page, s3, scratch }) => {
  scratch.unsafeOriginal = Object.fromEntries(['media.csv', 'observations.csv', 'UploadMeta.json', 'deployments.csv'].map(name => [name, s3.text(BUCKET, `${PREFIX_A}${name}`)]));
  s3.replaceMode = 'unsupported'; await focusFrame(page, 'IMG002.JPG'); await speciesApply(page, 'Canis latrans').click();
});
Then('canonical data remains unchanged and recovery explains the refusal', async ({ page, s3, scratch }) => {
  await expect(page.getByTestId('automatic-save')).toContainText(/Save failed|Save conflict/);
  for (const [name, body] of Object.entries(scratch.unsafeOriginal as Record<string, string>)) expect(s3.text(BUCKET, `${PREFIX_A}${name}`)).toBe(body);
  await expect(page.getByTestId('automatic-save')).toContainText(/conditional|safe|precondition/i);
});
