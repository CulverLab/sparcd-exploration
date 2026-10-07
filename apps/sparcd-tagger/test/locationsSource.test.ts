import { describe, expect, it } from 'vitest';
import type { SafeS3Client } from '@sparcd/s3-safe';
import { fetchLocations } from '../src/lib/locations';

const cfg = { endpoint: 'https://s3.example.test', region: 'us-east-1', accessKey: 'key', secretKey: 'secret', forcePathStyle: false };
const locationsJson = (id: string) =>
  JSON.stringify([
    { nameProperty: id, idProperty: id, latProperty: 32, lngProperty: -110, elevationProperty: 800 },
  ]);

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

describe('collection location source selection', () => {
  it('reads a non-empty collection file before discovering settings', async () => {
    const client = fakeClient({ 'collection-bucket/Collections/abc/locations.json': locationsJson('COLL') });
    const result = await fetchLocations(cfg, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('COLL');
    expect(result.sourceKey).toBe('Collections/abc/locations.json');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json']);
  });

  it('falls back to settings when the collection file is empty', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/locations.json': '[]',
      'settings-bucket/Settings/locations.json': locationsJson('GLOBAL'),
    });
    const result = await fetchLocations(cfg, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('GLOBAL');
    expect(result.sourceBucket).toBe('settings-bucket');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json', 'settings-bucket/Settings/locations.json']);
  });

  it('falls back to settings when the collection file is missing', async () => {
    const client = fakeClient({ 'settings-bucket/Settings/locations.json': locationsJson('GLOBAL') });
    const result = await fetchLocations(cfg, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('GLOBAL');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json', 'settings-bucket/Settings/locations.json']);
  });

  it('surfaces collection access failures instead of selecting global data', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/locations.json': Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    });
    await expect(fetchLocations(cfg, 'collection-bucket::abc', client)).rejects.toThrow(/Access denied/);
  });

  it('reads settings when no collection is selected', async () => {
    const client = fakeClient({ 'settings-bucket/Settings/locations.json': locationsJson('GLOBAL') });
    const result = await fetchLocations(cfg, null, client);
    expect(result.settingsBucket).toBe('settings-bucket');
    expect(client.reads).toEqual(['settings-bucket/Settings/locations.json']);
  });
});
