import { describe, expect, it } from 'vitest';
import type { SafeS3Client } from '@sparcd/s3-safe';
import { diffSpecies } from '../src/lib/keys';
import { fetchSpecies, SpeciesShapeError } from '../src/lib/species';

const cfg = { endpoint: 'https://s3.example.test', region: 'us-east-1', accessKey: 'key', secretKey: 'secret', forcePathStyle: false };
const speciesJson = (name: string) => JSON.stringify([{ name, scientificName: name, speciesIconURL: '', keyBinding: null }]);

function fakeClient(objects: Record<string, string | Error>) {
  const reads: string[] = [];
  const client = {
    reads,
    async listBuckets() { return ['settings-bucket']; },
    async statObject(bucket: string, key: string) {
      if (!objects[`${bucket}/${key}`]) throw new Error('NoSuchKey');
    },
    async getObject(bucket: string, key: string) {
      reads.push(`${bucket}/${key}`);
      const value = objects[`${bucket}/${key}`];
      if (value instanceof Error) throw value;
      if (value === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return new TextEncoder().encode(value);
    },
  } as unknown as SafeS3Client & { reads: string[] };
  return client;
}

describe('collection species source selection', () => {
  it('reads a non-empty collection file before discovering settings', async () => {
    const client = fakeClient({ 'collection-bucket/Collections/abc/species.json': speciesJson('collection') });
    const result = await fetchSpecies(cfg, 'collection-bucket::abc', client);
    expect(result.species[0].scientificName).toBe('collection');
    expect(result.sourceKey).toBe('Collections/abc/species.json');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/species.json']);
  });

  it('falls back to settings when the collection file is empty', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/species.json': '[]',
      'settings-bucket/Settings/species.json': speciesJson('settings'),
    });
    const result = await fetchSpecies(cfg, 'collection-bucket::abc', client);
    expect(result.species[0].scientificName).toBe('settings');
    expect(result.sourceBucket).toBe('settings-bucket');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/species.json', 'settings-bucket/Settings/species.json']);
  });

  it('falls back to settings when the collection file is missing', async () => {
    const client = fakeClient({ 'settings-bucket/Settings/species.json': speciesJson('settings') });
    const result = await fetchSpecies(cfg, 'collection-bucket::abc', client);
    expect(result.species[0].scientificName).toBe('settings');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/species.json', 'settings-bucket/Settings/species.json']);
  });

  it('surfaces collection access failures instead of selecting global data', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/species.json': Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    });
    await expect(fetchSpecies(cfg, 'collection-bucket::abc', client)).rejects.toThrow(/Access denied/);
  });

  it('surfaces an unrelated error whose text merely says "not found"', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/species.json': new Error('proxy: upstream not found'),
      'settings-bucket/Settings/species.json': speciesJson('settings'),
    });
    await expect(fetchSpecies(cfg, 'collection-bucket::abc', client)).rejects.toThrow(/Could not reach the endpoint/);
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/species.json']);
  });

  it('falls back to settings on a 404 status with no S3 error name', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/species.json': Object.assign(new Error('nope'), { $metadata: { httpStatusCode: 404 } }),
      'settings-bucket/Settings/species.json': speciesJson('settings'),
    });
    const result = await fetchSpecies(cfg, 'collection-bucket::abc', client);
    expect(result.species[0].scientificName).toBe('settings');
  });

  it('reports a malformed collection file as a shape error', async () => {
    const client = fakeClient({ 'collection-bucket/Collections/abc/species.json': '{"a":1}' });
    await expect(fetchSpecies(cfg, 'collection-bucket::abc', client)).rejects.toThrow(SpeciesShapeError);
  });

  it('reconciles local overrides against the selected collection list', () => {
    const localBefore = [{ scientificName: 'local', commonName: 'Local', keyBinding: 'L' }];
    const diff = diffSpecies(localBefore, [{ scientificName: 'collection', commonName: 'Collection', keyBinding: null }]);
    expect(diff.added.map((entry) => entry.scientificName)).toEqual(['collection']);
    expect(diff.removed.map((entry) => entry.scientificName)).toEqual(['local']);
  });
});
