import { parseCsvRows, serializeCsvRows, parseMedia, OBS_COL } from '@sparcd/camtrap';
import { When, Then, expect, openWorkspace } from './support/world';
import { BUCKET, PREFIX_A, SNAPSHOT_PREFIX, observationsCsv } from './support/data';
import { readStore, writeStore } from './support/flows';
import { sha256 } from './support/s3mock';

When('a pre-upgrade {string} journal with {string} receipts is loaded', async ({ page, s3, scratch }, operation: string, status: string) => {
  scratch.legacySnapshots = Object.fromEntries(s3.keys(BUCKET).filter(key => key.includes('.sparcd-tagger-snapshots/')).map(key => [key, s3.text(BUCKET, key)]));
  const body = operation === 'restore'
    ? s3.text(BUCKET, `${SNAPSHOT_PREFIX}observations.csv`)
    : serializeCsvRows([...parseCsvRows(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).filter(row => row[OBS_COL.mediaId] !== `${PREFIX_A}IMG002.JPG`),
      ...parseCsvRows(observationsCsv(PREFIX_A, [{ id: 'legacy-coyote', file: 'IMG002.JPG', timestamp: '2024-01-10T08:00:30', scientificName: 'Canis latrans', count: 1, comments: '[COMMONNAME:Coyote]' }]))]);
  const metadata = JSON.stringify({ ...JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)), comments: [{ comment: `Recovered legacy ${operation}`, user: 'original-actor' }] });
  scratch.legacyBodies = { 'observations.csv': body, 'UploadMeta.json': metadata };
  const etag = (name: string) => `"${s3.etag(BUCKET, `${PREFIX_A}${name}`)}"`;
  const originalMedia = s3.text(BUCKET, `${PREFIX_A}media.csv`);
  const originalETag = etag('media.csv');
  const media = `${originalMedia}\n`;
  s3.put(BUCKET, `${PREFIX_A}media.csv`, media, 'text/csv');
  await writeStore(page, 'syncJournals', {
    id: `${BUCKET}::${PREFIX_A}`, bucket: BUCKET, uploadPrefix: PREFIX_A,
    snapshotPrefix: SNAPSHOT_PREFIX, user: 'original-actor', startedAt: '2024-05-05T10:00:00.000Z',
    objects: [
      { role: 'media', key: `${PREFIX_A}media.csv`, baseETag: originalETag, baseHash: sha256(originalMedia), body: media, intendedHash: sha256(media), status, ...(status === 'written' ? { newETag: etag('media.csv') } : {}) },
      ...Object.entries(scratch.legacyBodies as Record<string, string>).map(([name, body]) => ({ role: name === 'observations.csv' ? 'observations' : 'uploadMeta', key: `${PREFIX_A}${name}`, baseETag: etag(name), baseHash: s3.hash(BUCKET, `${PREFIX_A}${name}`), body, intendedHash: sha256(body), status: 'pending' })),
    ],
  });
  // A later legacy local edit is distinct from the journal's submitted bodies.
  // Recovery must finish the old operation, then retain this actual intent for
  // review rather than fabricating an empty action merely to show a dialog.
  const path = `${PREFIX_A}IMG005.JPG`;
  await writeStore(page, 'drafts', {
    id: `${BUCKET}::${PREFIX_A}::${path}`, bucket: BUCKET, uploadPrefix: PREFIX_A, mediaPath: path,
    deploymentId: parseMedia(media).find(row => row.mediaId === path)!.deploymentId,
    observations: [{ scientificName: 'Puma concolor', commonName: 'Mountain Lion', count: 1, requestedSpecies: '', freeTags: '', classifiedBy: 'original-actor' }],
    questionable: false, timeOverride: null, lastEdited: '2024-05-05T10:01:00.000Z', dirty: true,
  });
  scratch.legacyPutsBefore = s3.puts.length;
  await page.reload(); await openWorkspace(page);
});
Then('recovery requires explicit confirmation of the connected account', async ({ page, s3, scratch }) => {
  await expect(page.getByTestId('automatic-save')).toContainText('Existing pending work needs recovery confirmation');
  expect(s3.puts.length).toBe(scratch.legacyPutsBefore);
  await expect(page.getByTestId('automatic-save').getByRole('button', { name: 'Undo latest action' })).toBeDisabled();
});
When('existing pending work is adopted for this account', async ({ page }) => {
  await page.getByRole('button', { name: 'Recover pending work for this account and upload' }).click();
});
Then('the old journal completes without repeating an applied write', async ({ page, s3, scratch }) => {
  await expect(page.getByTestId('automatic-save')).toContainText('interrupted legacy write is recovered');
  expect(await readStore(page, 'syncJournals')).toEqual([]);
  const writes = s3.puts.slice(scratch.legacyPutsBefore as number);
  expect(writes.filter(write => write.key === `${PREFIX_A}media.csv`)).toEqual([]);
  for (const [name, body] of Object.entries(scratch.legacyBodies as Record<string, string>)) {
    expect(s3.text(BUCKET, `${PREFIX_A}${name}`)).toBe(body);
    expect(writes.filter(write => write.key === `${PREFIX_A}${name}`)).toHaveLength(1);
  }
});
Then('retained legacy intent requires explicit review', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Review save conflict' })).toBeVisible();
  const records = await readStore(page, 'automatic') as { actions: unknown[] }[];
  expect(records[0].actions.length).toBeGreaterThan(0);
  await page.getByText('Compare local changes with storage', { exact: true }).click();
  await expect(page.getByTestId('automatic-save')).toContainText('Mountain Lion');
});
Then('the recovered legacy bytes and historical snapshots survive reload', async ({ page, s3, scratch }) => {
  await page.reload(); await openWorkspace(page);
  await expect(page.getByTestId('automatic-save').getByRole('status')).toHaveText('Saved');
  for (const [name, body] of Object.entries(scratch.legacyBodies as Record<string, string>)) expect(s3.text(BUCKET, `${PREFIX_A}${name}`)).toBe(body);
  for (const [key, body] of Object.entries(scratch.legacySnapshots as Record<string, string>)) expect(s3.text(BUCKET, key)).toBe(body);
  await expect(page.getByRole('button', { name: /^Sync|^Snapshots/ })).toHaveCount(0);
});
