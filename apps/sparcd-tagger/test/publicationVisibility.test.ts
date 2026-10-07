import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';

class FakeClient {
  listCommonPrefixes = vi.fn();
  statObject = vi.fn();
}

let client: FakeClient;

vi.mock('@sparcd/s3-safe', () => ({
  SafeS3Client: class {
    listCommonPrefixes(...args: unknown[]) { return client.listCommonPrefixes(...args); }
    statObject(...args: unknown[]) { return client.statObject(...args); }
  },
  listCollections: vi.fn(),
  // One bucket, every listed folder already past the media.csv check.
  listUploadFolders: async (_client: unknown, ref: { buckets: string[] }) =>
    ((await client.listCommonPrefixes()) as string[]).map((prefix) => ({ bucket: ref.buckets[0], prefix })),
  parseCollectionKey: (key: string) => ({ bucket: 'bucket', uuid: key }),
  translateReadError: (error: unknown) => error,
}));

const { clearClientCache, listUploads } = await import('../src/lib/s3');

const CFG: S3Config = {
  endpoint: 'https://store.example',
  region: 'us-east-1',
  accessKey: 'access',
  secretKey: 'secret',
  forcePathStyle: true,
};
const REF = { uuid: 'collection', buckets: ['bucket'] };

describe('UploadMeta publication gate', () => {
  beforeEach(() => {
    client = new FakeClient();
    clearClientCache();
  });

  it('filters prefixes whose marker is genuinely missing', async () => {
    const published = 'Collections/collection/Uploads/published/';
    const interrupted = 'Collections/collection/Uploads/interrupted/';
    client.listCommonPrefixes.mockResolvedValue([published, interrupted]);
    client.statObject.mockImplementation(async (_bucket: string, key: string) => {
      if (key === `${interrupted}UploadMeta.json`) throw new Error('NoSuchKey');
      return { size: 1 };
    });

    await expect(listUploads(CFG, REF)).resolves.toEqual([
      { bucket: 'bucket', prefix: published, stamp: 'published' },
    ]);
  });

  it('surfaces marker read failures instead of hiding a published prefix', async () => {
    const published = 'Collections/collection/Uploads/published/';
    client.listCommonPrefixes.mockResolvedValue([published]);
    client.statObject.mockRejectedValue(new Error('Failed to fetch'));

    await expect(listUploads(CFG, REF)).rejects.toThrow('Failed to fetch');
  });
});
