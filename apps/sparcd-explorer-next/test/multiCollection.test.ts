import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  ExplorerDb,
  buildModel,
  locationRows,
  openCollections,
  readCachedCollection,
  summarize,
  type Source,
} from '../src/data';
import { FakeS3, putUpload } from './support/fakeS3';
import { collection, collectionRef, deployment, filter, media, modelOf, observation } from './support/fixtures';

const A = collection('Alpha set', 'aaa').upload('u1', {
  deployments: [deployment('SR07', 'Spring', 12.5, -100.25)],
  media: [media('u1', 'a1.jpg', 'SR07', '2023-01-01T10:00:00'), media('u1', 'a2.jpg', 'SR07', '2023-02-01T10:00:00')],
  observations: [observation('u1', 'a1.jpg', 'SR07', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
});
const B = collection('Bravo set', 'bbb')
  .upload('u1', {
    deployments: [deployment('SR-07', 'Spring', 12.5, -100.25)],
    media: [media('u1', 'b1.jpg', 'SR-07', '2024-01-01T10:00:00')],
  })
  .upload('u2', {
    deployments: [deployment('XY01', 'Elsewhere', 12.9, -100.9)],
    media: [media('u2', 'b2.jpg', 'XY01', '2024-03-01T10:00:00')],
  });

describe('several collections open together', () => {
  const model = modelOf([A, B]);
  const result = filter(model);

  it('keep each row’s collection', () => {
    expect(model.collections.map((c) => c.name)).toEqual(['Alpha set', 'Bravo set']);
    expect(model.photos.map((p) => [p.fileName, p.collection])).toEqual([
      ['a1.jpg', 0],
      ['a2.jpg', 0],
      ['b1.jpg', 1],
      ['b2.jpg', 1],
    ]);
    expect(new Set(model.sites.map((s) => s.collection))).toEqual(new Set([0, 1]));
  });

  it('group one location ID across collections', () => {
    const rows = locationRows(model, result, { separate: false });
    const spring = rows.find((r) => r.key === 'id:SR07')!;
    expect(spring).toMatchObject({ ids: ['SR-07', 'SR07'], collections: [0, 1], photos: 3 });
  });

  it('split by collection too when each location ID shows separately', () => {
    const rows = locationRows(model, result, { separate: true });
    expect(rows.filter((r) => r.name === 'Spring').map((r) => [r.collections, r.photos])).toEqual([
      [[0], 2],
      [[1], 1],
    ]);
  });

  it('filter by collection and total per collection', () => {
    const onlyB = filter(model, { collections: ['sparcd-bbb::bbb'] });
    expect(onlyB.photos.map((i) => model.photos[i].fileName)).toEqual(['b1.jpg', 'b2.jpg']);
    expect(summarize(model, result, { separate: false }).byCollection).toEqual([
      { collection: 0, photos: 2, tagged: 1, detections: 1 },
      { collection: 1, photos: 2, tagged: 0, detections: 0 },
    ]);
  });

  it('share one hex grid', () => {
    expect(model.sites.filter((s) => s.name === 'Spring').map((s) => s.hex)).toEqual([model.sites[0].hex, model.sites[0].hex]);
  });

  it('give the same model for the same collections in any open', () => {
    expect(buildModel([A.build(), B.build()])).toEqual(model);
  });
});

describe('adding a collection', () => {
  it('does not refetch the cached one', async () => {
    const s3 = new FakeS3();
    const a = collectionRef('Alpha set', 'aaa');
    const b = collectionRef('Bravo set', 'bbb');
    putUpload(s3, a.bucket, a.uuid, 'u1', { deployments: [deployment('SR07', 'Spring', 12.5, -100.25)], media: [media('u1', 'a1.jpg', 'SR07')] });
    putUpload(s3, b.bucket, b.uuid, 'u1', { deployments: [deployment('XY01', 'Else', 12.9, -100.9)], media: [media('u1', 'b1.jpg', 'XY01')] });
    const source: Source = { client: s3, db: new ExplorerDb('multi-collection-test'), account: 'server.example.org|key' };

    await openCollections(source, [a]);
    expect(await readCachedCollection(source.db, source.account, a)).not.toBeNull();
    s3.resetCounts();

    const both = await openCollections(source, [a, b]);
    expect(s3.gets.filter((g) => g.startsWith(`${a.bucket}/`))).toEqual([]);
    expect(s3.gets.filter((g) => g.startsWith(`${b.bucket}/`))).toHaveLength(3);
    expect(both.map((c) => c.changed)).toEqual([false, true]);
  });
});
