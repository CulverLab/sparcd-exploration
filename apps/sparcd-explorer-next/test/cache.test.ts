import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ExplorerDb, accountKey, readCachedCollection, syncCollection, type Source } from '../src/data';
import { serializeObservations } from '@sparcd/camtrap';
import { FakeS3, putUpload } from './support/fakeS3';
import { collectionRef, deployment, media, observation } from './support/fixtures';

let dbCount = 0;
const REF = collectionRef('Test', 'abc');
const ACCOUNT = accountKey({ endpoint: 'https://server.example.org', accessKey: 'reader' });

function setup() {
  const s3 = new FakeS3();
  const db = new ExplorerDb(`cache-test-${++dbCount}`);
  const source: Source = { client: s3, db, account: ACCOUNT };
  const folders = ['u1', 'u2'].map((stamp) =>
    putUpload(s3, REF.bucket, REF.uuid, stamp, {
      deployments: [deployment('ZZ01', 'Ridge', 12.5, -100.25)],
      media: [media(stamp, 'a.jpg', 'ZZ01', '2024-01-01T10:00:00')],
      observations: [observation(stamp, 'a.jpg', 'ZZ01', '2024-01-01T10:00:00')],
    }),
  );
  return { s3, db, source, folders };
}

describe('the cache', () => {
  it('reopens a collection from the cache with no request', async () => {
    const { s3, db, source } = setup();
    const first = await syncCollection(source, REF);
    s3.resetCounts();

    const cached = await readCachedCollection(db, ACCOUNT, REF);
    expect(s3.gets).toEqual([]);
    expect(s3.lists).toEqual([]);
    expect(cached).toMatchObject({ uploads: first.uploads, hiddenUploads: [], changed: false });
  });

  it('has nothing for a collection never read here', async () => {
    const { db } = setup();
    expect(await readCachedCollection(db, ACCOUNT, REF)).toBeNull();
  });

  it('checks ETags in the background and fetches nothing when nothing changed', async () => {
    const { s3, source } = setup();
    await syncCollection(source, REF);
    s3.resetCounts();

    const again = await syncCollection(source, REF);
    expect(s3.lists).toHaveLength(3);
    expect(s3.gets).toEqual([]);
    expect(again.changed).toBe(false);
  });

  it('refetches only the file whose ETag changed', async () => {
    const { s3, source, folders } = setup();
    await syncCollection(source, REF);
    s3.resetCounts();
    // Tagging in the Tagger rewrites observations.csv, which gives it a new ETag.
    s3.put(
      REF.bucket,
      `${folders[1]}observations.csv`,
      serializeObservations([observation('u2', 'a.jpg', 'ZZ01', '2024-01-01T10:00:00', { common: 'Bobcat', scientific: 'Lynx rufus' })]),
    );

    const fresh = await syncCollection(source, REF);
    expect(s3.gets).toEqual([`${REF.bucket}/${folders[1]}observations.csv`]);
    expect(fresh.changed).toBe(true);
    expect(fresh.uploads[1].observations[0].scientificName).toBe('Lynx rufus');
    expect((await readCachedCollection(source.db, ACCOUNT, REF))!.uploads[1].observations[0].scientificName).toBe('Lynx rufus');
  });

  it('picks up a new upload on refresh without refetching the others', async () => {
    const { s3, source } = setup();
    await syncCollection(source, REF);
    s3.resetCounts();
    const added = putUpload(s3, REF.bucket, REF.uuid, 'u3', { media: [media('u3', 'b.jpg', 'ZZ01', '2024-02-01T10:00:00')] });

    const fresh = await syncCollection(source, REF);
    expect(fresh.uploads.map((u) => u.folder)).toContain(added);
    expect(s3.gets.every((g) => g.includes(added))).toBe(true);
    expect(fresh.changed).toBe(true);
  });

  it('drops an upload that is gone from storage', async () => {
    const { s3, source, folders } = setup();
    await syncCollection(source, REF);
    for (const f of ['UploadMeta.json', 'deployments.csv', 'media.csv', 'observations.csv', 'IMG_0001.JPG']) {
      s3.remove(REF.bucket, `${folders[0]}${f}`);
    }
    const fresh = await syncCollection(source, REF);
    expect(fresh.uploads.map((u) => u.folder)).toEqual([folders[1]]);
    expect(fresh.changed).toBe(true);
    expect((await readCachedCollection(source.db, ACCOUNT, REF))!.uploads.map((u) => u.folder)).toEqual([folders[1]]);
  });

  it('retries a file that failed instead of keeping the partial result', async () => {
    const { s3, source, folders } = setup();
    const key = `${REF.bucket}/${folders[0]}media.csv`;
    s3.failures.set(key, Object.assign(new Error('flaky'), { $metadata: { httpStatusCode: 503 } }));
    const partial = await syncCollection(source, REF);
    expect(partial.uploads[0].media).toEqual([]);
    expect(partial.problems).toHaveLength(1);

    s3.failures.clear();
    s3.resetCounts();
    const whole = await syncCollection(source, REF);
    expect(s3.gets).toEqual([key]);
    expect(whole.uploads[0].media).toHaveLength(1);
    expect(whole.problems).toEqual([]);
  });

  it('keeps cached rows for a folder that fails to list', async () => {
    const { s3, source, folders } = setup();
    await syncCollection(source, REF);
    s3.failures.set(`${REF.bucket}/${folders[0]}`, Object.assign(new Error('down'), { $metadata: { httpStatusCode: 503 } }));
    const fresh = await syncCollection(source, REF);
    expect(fresh.uploads.map((u) => u.folder)).toEqual(folders);
    expect(fresh.problems).toEqual([{ folder: folders[0], file: 'listing', message: `Failed to read ${folders[0]} (HTTP 503).` }]);
  });

  it('notices an upload becoming hidden', async () => {
    const { s3, source, folders } = setup();
    await syncCollection(source, REF);
    s3.remove(REF.bucket, `${folders[0]}UploadMeta.json`);
    const fresh = await syncCollection(source, REF);
    expect(fresh.hiddenUploads).toEqual([folders[0]]);
    expect(fresh.uploads.map((u) => u.folder)).toEqual([folders[1]]);
    expect(fresh.changed).toBe(true);
  });

  it('never shows one account the rows cached for another endpoint or access key', async () => {
    const { source } = setup();
    await syncCollection(source, REF);
    const otherServer = accountKey({ endpoint: 'other.example.org', accessKey: 'reader' });
    const otherKey = accountKey({ endpoint: 'server.example.org', accessKey: 'writer' });
    expect(await readCachedCollection(source.db, otherServer, REF)).toBeNull();
    expect(await readCachedCollection(source.db, otherKey, REF)).toBeNull();
  });

  it('treats the same server written with or without a scheme as one account', () => {
    expect(accountKey({ endpoint: 'server.example.org/', accessKey: 'reader' })).toBe(ACCOUNT);
    expect(accountKey({ endpoint: 'server.example.org', accessKey: 'reader', secure: true })).toBe(ACCOUNT);
    expect(accountKey({ endpoint: 'https://server.example.org:443', accessKey: 'reader' })).toBe(ACCOUNT);
    expect(accountKey({ endpoint: 'server.example.org', accessKey: 'reader', secure: false })).toBe(
      accountKey({ endpoint: 'http://server.example.org', accessKey: 'reader' }),
    );
  });

  it('keeps http and https, and different ports, of one host apart', () => {
    const http = accountKey({ endpoint: 'http://server.example.org', accessKey: 'reader' });
    expect(http).not.toBe(ACCOUNT);
    expect(accountKey({ endpoint: 'server.example.org', accessKey: 'reader', secure: false })).not.toBe(ACCOUNT);
    expect(accountKey({ endpoint: 'server.example.org:9000', accessKey: 'reader' })).not.toBe(ACCOUNT);
    expect(accountKey({ endpoint: 'http://server.example.org:9000', accessKey: 'reader' })).not.toBe(
      accountKey({ endpoint: 'http://server.example.org:9001', accessKey: 'reader' }),
    );
  });

  it('keeps the cache across sessions: signing out clears nothing', async () => {
    const { source, db } = setup();
    await syncCollection(source, REF);
    db.close();
    const reopened = new ExplorerDb(db.name);
    expect((await readCachedCollection(reopened, ACCOUNT, REF))!.uploads).toHaveLength(2);
  });
});
