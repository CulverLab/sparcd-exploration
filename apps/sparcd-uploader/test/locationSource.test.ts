import { describe, expect, it } from 'vitest';
import type { SafeS3Client } from '@sparcd/s3-safe';
import { fetchLocations } from '../src/lib/s3';
import { LocationsShapeError } from '../src/lib/locations';

const cfg = { endpoint: 'https://s3.example.test', region: 'us-east-1', accessKey: 'key', secretKey: 'secret', forcePathStyle: false };
const locationsJson = (id: string) => JSON.stringify([{ nameProperty: id, idProperty: id, latProperty: 1, lngProperty: 2, elevationProperty: 3 }]);

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
    const client = fakeClient({ 'collection-bucket/Collections/abc/locations.json': locationsJson('collection') });
    const result = await fetchLocations(cfg, undefined, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('collection');
    expect(result.sourceKey).toBe('Collections/abc/locations.json');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json']);
  });

  it('falls back to settings when the collection file is empty', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/locations.json': '[]',
      'settings-bucket/Settings/locations.json': locationsJson('settings'),
    });
    const result = await fetchLocations(cfg, undefined, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('settings');
    expect(result.sourceBucket).toBe('settings-bucket');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json', 'settings-bucket/Settings/locations.json']);
  });

  it('falls back to settings when the collection file is missing', async () => {
    const client = fakeClient({ 'settings-bucket/Settings/locations.json': locationsJson('settings') });
    const result = await fetchLocations(cfg, undefined, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('settings');
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json', 'settings-bucket/Settings/locations.json']);
  });

  it('surfaces collection access failures instead of selecting global data', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/locations.json': Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    });
    await expect(fetchLocations(cfg, undefined, 'collection-bucket::abc', client)).rejects.toThrow(/Access denied/);
  });

  it('surfaces an unrelated error whose text merely says "not found"', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/locations.json': new Error('proxy: upstream not found'),
      'settings-bucket/Settings/locations.json': locationsJson('settings'),
    });
    await expect(fetchLocations(cfg, undefined, 'collection-bucket::abc', client)).rejects.toThrow(/Could not reach the endpoint/);
    expect(client.reads).toEqual(['collection-bucket/Collections/abc/locations.json']);
  });

  it('falls back to settings on a 404 status with no S3 error name', async () => {
    const client = fakeClient({
      'collection-bucket/Collections/abc/locations.json': Object.assign(new Error('nope'), { $metadata: { httpStatusCode: 404 } }),
      'settings-bucket/Settings/locations.json': locationsJson('settings'),
    });
    const result = await fetchLocations(cfg, undefined, 'collection-bucket::abc', client);
    expect(result.locations[0].id).toBe('settings');
  });

  it('reports a malformed collection file as a shape error', async () => {
    const client = fakeClient({ 'collection-bucket/Collections/abc/locations.json': '{"a":1}' });
    await expect(fetchLocations(cfg, undefined, 'collection-bucket::abc', client)).rejects.toThrow(LocationsShapeError);
  });
});
