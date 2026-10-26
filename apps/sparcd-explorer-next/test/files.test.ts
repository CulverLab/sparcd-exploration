import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ExplorerDb, accountKey, checkPhotoFiles, missingKeys, syncCollection, type Source } from '../src/data';
import { serializeMedia, type Media } from '@sparcd/camtrap';
import { FakeS3, putUpload } from './support/fakeS3';
import { collectionRef, deployment } from './support/fixtures';

let dbCount = 0;
const REF = collectionRef('Test', 'abc');
const ACCOUNT = accountKey({ endpoint: 'https://server.example.org', accessKey: 'reader' });
const folderOf = (stamp: string) => `Collections/${REF.uuid}/Uploads/${stamp}/`;
const row = (stamp: string, file: string): Media => {
  const path = `${folderOf(stamp)}${file}`;
  return { mediaId: path, deploymentId: 'test:ZZ01', mediaPath: path, fileName: file, timestamp: '', mimeType: 'image/jpeg', comments: '' };
};

/** Two uploads: u1 lists a.jpg (there) and b.jpg (never arrived); u2 lists c.jpg (there). */
async function setup() {
  const s3 = new FakeS3();
  const db = new ExplorerDb(`files-test-${++dbCount}`);
  const source: Source = { client: s3, db, account: ACCOUNT };
  for (const [stamp, files] of [['u1', ['a.jpg', 'b.jpg']], ['u2', ['c.jpg']]] as const) {
    putUpload(s3, REF.bucket, REF.uuid, stamp, { deployments: [deployment('ZZ01', 'Ridge', 12.5, -100.25)], media: files.map((f) => row(stamp, f)) });
  }
  s3.put(REF.bucket, `${folderOf('u1')}a.jpg`, 'jpeg').put(REF.bucket, `${folderOf('u2')}c.jpg`, 'jpeg');
  const loaded = [await syncCollection(source, REF)];
  s3.resetCounts();
  return { s3, db, source, loaded };
}

describe('photo files media.csv lists but storage lacks', () => {
  it('are the media rows whose key the listing lacks', () => {
    const listed = new Set(['x/a.jpg', 'x/c.jpg']);
    expect(missingKeys([{ mediaPath: 'x/a.jpg' }, { mediaPath: 'x/b.jpg' }, { mediaPath: 'x/extra/c.jpg' }], listed)).toEqual([
      'x/b.jpg',
      'x/extra/c.jpg',
    ]);
  });

  it('are found by listing every visible upload folder, every page', async () => {
    const { s3, source, loaded } = await setup();
    s3.pageSize = 2;
    expect(await checkPhotoFiles(source, loaded)).toEqual({
      missing: new Set([`${REF.bucket}/${folderOf('u1')}b.jpg`]),
      listed: expect.arrayContaining([`${REF.bucket}/${folderOf('u1')}`, `${REF.bucket}/${folderOf('u2')}`]),
      failed: 0,
    });
    expect(s3.lists.sort()).toEqual([`${REF.bucket}/${folderOf('u1')}**`, `${REF.bucket}/${folderOf('u2')}**`]);
    expect(s3.gets).toEqual([]);
  });

  it('are cached per folder by its media.csv ETag, so a reopen lists nothing', async () => {
    const { s3, source, loaded } = await setup();
    await checkPhotoFiles(source, loaded);
    s3.resetCounts();
    expect((await checkPhotoFiles(source, loaded)).missing.size).toBe(1);
    expect(s3.lists).toEqual([]);
  });

  it('are listed again for a folder whose media.csv changed, and for every folder on Refresh', async () => {
    const { s3, source, loaded } = await setup();
    await checkPhotoFiles(source, loaded);
    s3.put(REF.bucket, `${folderOf('u2')}media.csv`, serializeMedia([row('u2', 'c.jpg'), row('u2', 'd.jpg')]));
    const changed = [await syncCollection(source, REF)];
    s3.resetCounts();
    expect((await checkPhotoFiles(source, changed)).missing.size).toBe(2);
    expect(s3.lists).toEqual([`${REF.bucket}/${folderOf('u2')}**`]);

    s3.resetCounts();
    s3.put(REF.bucket, `${folderOf('u1')}b.jpg`, 'jpeg');
    expect((await checkPhotoFiles(source, changed, { force: true })).missing.size).toBe(1);
    expect(s3.lists.sort()).toEqual([`${REF.bucket}/${folderOf('u1')}**`, `${REF.bucket}/${folderOf('u2')}**`]);
  });

  it('keep each account apart', async () => {
    const { s3, db, source, loaded } = await setup();
    await checkPhotoFiles(source, loaded);
    s3.resetCounts();
    await checkPhotoFiles({ ...source, account: accountKey({ endpoint: 'https://server.example.org', accessKey: 'other' }) }, loaded);
    expect(s3.lists).toHaveLength(2);
    expect(await db.files.count()).toBe(4);
  });

  it('count a folder that fails to list as complete, and list it again next time', async () => {
    const { s3, source, loaded } = await setup();
    s3.failures.set(`${REF.bucket}/${folderOf('u1')}`, Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } }));
    expect(await checkPhotoFiles(source, loaded)).toEqual({ missing: new Set(), listed: [`${REF.bucket}/${folderOf('u2')}`], failed: 1 });
    s3.failures.clear();
    s3.resetCounts();
    expect((await checkPhotoFiles(source, loaded)).missing.size).toBe(1);
    expect(s3.lists).toEqual([`${REF.bucket}/${folderOf('u1')}**`]);
  });

  it("keep a folder's last answer when Refresh can't list it, and list it again next time", async () => {
    const { s3, source, loaded } = await setup();
    await checkPhotoFiles(source, loaded);
    const missing = new Set([`${REF.bucket}/${folderOf('u1')}b.jpg`]);
    for (const failure of [new TypeError('Failed to fetch'), Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } })]) {
      s3.failures.set(`${REF.bucket}/${folderOf('u1')}`, failure);
      expect(await checkPhotoFiles(source, loaded, { force: true })).toEqual({ missing, listed: [`${REF.bucket}/${folderOf('u2')}`], failed: 1 });
    }
    s3.failures.clear();
    s3.resetCounts();
    expect(await checkPhotoFiles(source, loaded)).toEqual({ missing, listed: [`${REF.bucket}/${folderOf('u1')}`], failed: 0 });
    expect(s3.lists).toEqual([`${REF.bucket}/${folderOf('u1')}**`]);
  });

  it('stop when cancelled, keeping only what finished', async () => {
    const { s3, db, source, loaded } = await setup();
    s3.latency = 20;
    s3.pageSize = 1;
    const controller = new AbortController();
    const check = checkPhotoFiles(source, loaded, { signal: controller.signal });
    setTimeout(() => controller.abort(new DOMException('Cancelled', 'AbortError')), 10);
    await expect(check).rejects.toThrow('Cancelled');
    expect(await db.files.count()).toBe(0);
  });
});
