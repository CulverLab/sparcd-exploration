import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  ExplorerDb,
  REQUESTS_IN_FLIGHT,
  discoverCollections,
  openCollections,
  readCachedCollection,
  syncCollection,
  type OpenProgress,
  type Source,
} from '../src/data';
import { FakeS3, putCollection, putUpload } from './support/fakeS3';
import { collectionRef, deployment, media, observation } from './support/fixtures';

let dbCount = 0;
const newSource = (client: FakeS3, account = 'server.example.org|key'): Source => ({
  client,
  db: new ExplorerDb(`open-test-${++dbCount}`),
  account,
});

const REF = collectionRef('Test', 'abc');

function oneUpload(s3: FakeS3, stamp = '2024.01.01.10.00.00', meta = true) {
  return putUpload(s3, REF.bucket, REF.uuid, stamp, {
    meta,
    deployments: [deployment('ZZ01', 'Ridge', 12.5, -100.25)],
    media: [media(stamp, 'a.jpg', 'ZZ01', '2024-01-01T10:00:00')],
    observations: [observation(stamp, 'a.jpg', 'ZZ01', '2024-01-01T10:00:00', { common: 'Bobcat', scientific: 'Lynx rufus' })],
  });
}

describe('opening a collection', () => {
  it('lists the upload folders, then each folder once, and reads its four files', async () => {
    const s3 = new FakeS3();
    const folder = oneUpload(s3);
    const loaded = await syncCollection(newSource(s3), REF);

    expect(s3.lists).toEqual([`${REF.bucket}/Collections/abc/Uploads/`, `${REF.bucket}/${folder}`]);
    expect(s3.gets.sort()).toEqual(
      ['UploadMeta.json', 'deployments.csv', 'media.csv', 'observations.csv'].map((f) => `${REF.bucket}/${folder}${f}`),
    );
    expect(loaded.uploads).toHaveLength(1);
    expect(loaded.uploads[0]).toMatchObject({ folder, meta: { uploadUser: 'tester' } });
    expect(loaded.uploads[0].deployments[0]).toMatchObject({ locationId: 'ZZ01', latitude: 12.5 });
    expect(loaded.uploads[0].media).toHaveLength(1);
    expect(loaded.uploads[0].observations[0].scientificName).toBe('Lynx rufus');
    expect(Object.keys(loaded.uploads[0].etags).sort()).toEqual(['UploadMeta.json', 'deployments.csv', 'media.csv', 'observations.csv']);
  });

  it('hides an upload without UploadMeta.json, never reads it, and counts it', async () => {
    const s3 = new FakeS3();
    const good = oneUpload(s3, '2024.01.01.10.00.00');
    const interrupted = oneUpload(s3, '2024.02.01.10.00.00', false);
    const loaded = await syncCollection(newSource(s3), REF);

    expect(loaded.uploads.map((u) => u.folder)).toEqual([good]);
    expect(loaded.hiddenUploads).toEqual([interrupted]);
    expect(s3.gets.some((g) => g.includes(interrupted))).toBe(false);
  });

  it('reads an upload with no observations.csv as having no observations', async () => {
    const s3 = new FakeS3();
    putUpload(s3, REF.bucket, REF.uuid, 'u1', { deployments: [deployment('ZZ01', 'Ridge', 12.5, -100.25)], media: [media('u1', 'a.jpg', 'ZZ01')] });
    const loaded = await syncCollection(newSource(s3), REF);
    expect(loaded.uploads[0].observations).toEqual([]);
    expect(loaded.uploads[0].etags['observations.csv']).toBeUndefined();
  });

  it(`keeps at most ${REQUESTS_IN_FLIGHT} requests in flight`, async () => {
    const s3 = new FakeS3();
    for (let i = 0; i < 20; i++) oneUpload(s3, `2024.01.${String(i + 1).padStart(2, '0')}.10.00.00`);
    s3.latency = 2;
    const loaded = await syncCollection(newSource(s3), REF);
    expect(loaded.uploads).toHaveLength(20);
    expect(s3.peak).toBe(REQUESTS_IN_FLIGHT);
  });

  it('shares the pool of 8 across collections opened together', async () => {
    const s3 = new FakeS3();
    const other = collectionRef('Other', 'def');
    for (let i = 0; i < 10; i++) {
      oneUpload(s3, `2024.01.${String(i + 1).padStart(2, '0')}.10.00.00`);
      putUpload(s3, other.bucket, other.uuid, `2024.03.${String(i + 1).padStart(2, '0')}.10.00.00`, {
        meta: true,
        media: [],
      });
    }
    s3.latency = 2;
    const loaded = await openCollections(newSource(s3), [REF, other]);
    expect(loaded.map((c) => c.uploads.length)).toEqual([10, 10]);
    expect(s3.peak).toBe(REQUESTS_IN_FLIGHT);
  });

  it('reports progress as finding uploads, reading data, then drawing', async () => {
    const s3 = new FakeS3();
    oneUpload(s3, 'u1');
    oneUpload(s3, 'u2');
    const steps: OpenProgress[] = [];
    await syncCollection(newSource(s3), REF, { onProgress: (p) => steps.push(p) });
    expect(steps).toEqual([
      { collection: REF.key, step: 'finding', done: 0, total: 0 },
      { collection: REF.key, step: 'reading', done: 0, total: 2 },
      { collection: REF.key, step: 'reading', done: 1, total: 2 },
      { collection: REF.key, step: 'reading', done: 2, total: 2 },
      { collection: REF.key, step: 'drawing', done: 2, total: 2 },
    ]);
  });

  it('reports a file it cannot read, keeps the rest, and names the file', async () => {
    const s3 = new FakeS3();
    const folder = oneUpload(s3);
    s3.failures.set(`${REF.bucket}/${folder}media.csv`, Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }));
    const loaded = await syncCollection(newSource(s3), REF);
    expect(loaded.problems).toEqual([{ folder, file: 'media.csv', message: 'Failed to read media.csv (HTTP 500).' }]);
    expect(loaded.uploads[0].deployments).toHaveLength(1);
    expect(loaded.uploads[0].media).toEqual([]);
  });

  it('fails in plain words when the collection cannot be listed', async () => {
    const s3 = new FakeS3();
    s3.failures.set(
      `${REF.bucket}/Collections/abc/Uploads/`,
      Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    );
    await expect(syncCollection(newSource(s3), REF)).rejects.toThrow(/Access denied reading the uploads of "Test"/);
  });
});

describe('cancel', () => {
  it('aborts the requests in flight and starts no more', async () => {
    const s3 = new FakeS3();
    for (let i = 0; i < 30; i++) oneUpload(s3, `u${String(i).padStart(2, '0')}`);
    s3.latency = 20;
    const controller = new AbortController();
    const opening = syncCollection(newSource(s3), REF, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(s3.lists.length).toBeGreaterThan(1);
      expect(s3.inFlight).toBeGreaterThan(0);
    });
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(s3.inFlight).toBe(0);
    const started = s3.gets.length + s3.lists.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(s3.gets.length + s3.lists.length).toBe(started);
    expect(started).toBeLessThan(31 + 30 * 4);
  });

  it('leaves a cancelled first open looking unread', async () => {
    const s3 = new FakeS3();
    for (let i = 0; i < 10; i++) oneUpload(s3, `u${i}`);
    s3.latency = 10;
    const source = newSource(s3);
    const controller = new AbortController();
    const opening = syncCollection(source, REF, { signal: controller.signal });
    await vi.waitFor(() => expect(s3.gets.length).toBeGreaterThan(0));
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect((await discoverCollections({ ...source, client: withCollectionMarker(s3) }))[0].cached).toBe(false);
  });
});

describe('cancel during a refresh', () => {
  // Read once, then change every observations.csv and add an upload, so a
  // refresh has many files to write.
  async function cachedThenChanged() {
    const s3 = new FakeS3();
    const folders = Array.from({ length: 12 }, (_, i) => oneUpload(s3, `u${String(i).padStart(2, '0')}`));
    const source = newSource(s3);
    await syncCollection(source, REF);
    const before = await readCachedCollection(source.db, source.account, REF);
    for (const folder of folders) s3.put(REF.bucket, `${folder}observations.csv`, '');
    oneUpload(s3, 'u99');
    s3.resetCounts();
    return { s3, source, before };
  }

  it('leaves the cache exactly as it was when cancelled mid-read', async () => {
    const { s3, source, before } = await cachedThenChanged();
    s3.latency = 10;
    const controller = new AbortController();
    const refreshing = syncCollection(source, REF, { signal: controller.signal });
    await vi.waitFor(() => expect(s3.gets.length).toBeGreaterThan(3));
    controller.abort();
    await expect(refreshing).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readCachedCollection(source.db, source.account, REF)).toEqual(before);
  });

  it('writes nothing when the final progress report cancels', async () => {
    const { source, before } = await cachedThenChanged();
    const controller = new AbortController();
    const refreshing = syncCollection(source, REF, {
      signal: controller.signal,
      onProgress: (p) => p.step === 'drawing' && controller.abort(),
    });
    await expect(refreshing).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readCachedCollection(source.db, source.account, REF)).toEqual(before);
  });

  it('leaves a first open unread when the final progress report cancels', async () => {
    const s3 = new FakeS3();
    oneUpload(s3);
    const source = newSource(s3);
    const controller = new AbortController();
    const opening = syncCollection(source, REF, {
      signal: controller.signal,
      onProgress: (p) => p.step === 'drawing' && controller.abort(),
    });
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readCachedCollection(source.db, source.account, REF)).toBeNull();
    expect(await source.db.uploads.count()).toBe(0);
  });
});

function withCollectionMarker(s3: FakeS3): FakeS3 {
  putCollection(s3, REF.bucket, REF.uuid, 'Test');
  return s3;
}

describe('discoverCollections', () => {
  it('lists collections and marks the ones already read here', async () => {
    const s3 = new FakeS3();
    putCollection(s3, REF.bucket, REF.uuid, 'Test');
    putCollection(s3, 'sparcd-def', 'def', 'Other');
    oneUpload(s3);
    const source = newSource(s3);
    expect((await discoverCollections(source)).map((c) => [c.name, c.cached])).toEqual([
      ['Other', false],
      ['Test', false],
    ]);
    await syncCollection(source, REF);
    expect((await discoverCollections(source)).map((c) => [c.name, c.cached])).toEqual([
      ['Other', false],
      ['Test', true],
    ]);
  });
});
