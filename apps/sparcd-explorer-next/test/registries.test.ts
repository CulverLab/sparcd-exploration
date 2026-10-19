import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ExplorerDb, cachedRegistries, fetchRegistries, type Source } from '../src/data';
import { FakeS3 } from './support/fakeS3';
import { collectionRef } from './support/fixtures';

const REF = collectionRef('Test', 'abc');
const speciesJson = (common: string) =>
  JSON.stringify([{ name: common, scientificName: 'Lynx rufus', speciesIconURL: '', keyBinding: null }]);
const locationsJson = (name: string) =>
  JSON.stringify([{ nameProperty: name, idProperty: 'ZZ01', latProperty: 12.5, lngProperty: -100.25, elevationProperty: 1500 }]);

let dbCount = 0;
function source(s3: FakeS3, account = 'https://server.example.org:443|alice'): Source {
  return { client: s3, db: new ExplorerDb(`registries-test-${++dbCount}`), account };
}

function withRegistries(common = 'Bobcat', place = 'Ridge') {
  return new FakeS3()
    .put(REF.bucket, `Collections/${REF.uuid}/species.json`, speciesJson(common))
    .put(REF.bucket, `Collections/${REF.uuid}/locations.json`, locationsJson(place));
}

describe('species lists and location registries', () => {
  it('are cached per account and collection, so a cached collection opens with its names', async () => {
    const s3 = withRegistries();
    const src = source(s3);
    expect(await cachedRegistries(src, [REF])).toEqual({ species: [[]], registry: [] });
    const read = await fetchRegistries(src, [REF]);
    expect(read.species[0][0].commonName).toBe('Bobcat');
    expect(read.registry[0].name).toBe('Ridge');

    s3.resetCounts();
    expect(await cachedRegistries(src, [REF])).toEqual(read);
    expect(s3.gets).toEqual([]);
  });

  it('never show one account the names cached for another', async () => {
    const s3 = withRegistries();
    const alice = source(s3);
    await fetchRegistries(alice, [REF]);
    const bob = { ...alice, account: 'https://server.example.org:443|bob' };
    expect(await cachedRegistries(bob, [REF])).toEqual({ species: [[]], registry: [] });
  });

  it('take a corrected name on the next read', async () => {
    const s3 = withRegistries('Bobcat', 'Ridge');
    const src = source(s3);
    await fetchRegistries(src, [REF]);
    s3.put(REF.bucket, `Collections/${REF.uuid}/species.json`, speciesJson('Bobcat (corrected)'));
    await fetchRegistries(src, [REF]);
    expect((await cachedRegistries(src, [REF])).species[0][0].commonName).toBe('Bobcat (corrected)');
  });

  it('keep the cached copy when a later read fails', async () => {
    const s3 = withRegistries();
    const src = source(s3);
    await fetchRegistries(src, [REF]);
    s3.failures.set(
      `${REF.bucket}/Collections/${REF.uuid}/species.json`,
      Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    );
    const read = await fetchRegistries(src, [REF]);
    expect(read.species[0][0].commonName).toBe('Bobcat');
    expect((await cachedRegistries(src, [REF])).species[0][0].commonName).toBe('Bobcat');
  });
});
