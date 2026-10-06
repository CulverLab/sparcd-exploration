import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';

const clients: FakeClient[] = [];

class FakeClient {
  listCommonPrefixes = vi.fn();
  getObject = vi.fn();
  statObject = vi.fn();

  constructor() {
    clients.push(this);
  }
}

vi.mock('@sparcd/s3-safe', () => ({
  SafeS3Client: FakeClient,
  listCollections: vi.fn(),
  // One bucket, every listed folder already past the media.csv check.
  listUploadFolders: async (client: FakeClient, ref: { buckets: string[] }) =>
    ((await client.listCommonPrefixes()) as string[]).map((prefix) => ({ bucket: ref.buckets[0], prefix })),
  parseCollectionKey: (key: string) => ({ bucket: 'bucket', uuid: key }),
  translateReadError: (error: unknown) => error,
}));

const { clearClientCache, getClient, listCollectionDeploymentLocationIds, listPublishedUploads } = await import('../src/lib/s3');

const CFG: S3Config = {
  endpoint: 'https://store.example',
  region: 'us-east-1',
  accessKey: 'access',
  secretKey: 'secret',
  forcePathStyle: true,
};

const REF = {
  key: 'bucket::collection',
  bucket: 'bucket',
  uuid: 'collection',
  buckets: ['bucket'],
  dataBucket: null,
  name: null,
  organization: null,
  contact: null,
  description: null,
};
const COMPLETE = 'Collections/collection/Uploads/complete/';
const INCOMPLETE = 'Collections/collection/Uploads/incomplete/';
const META = JSON.stringify({
  uploadPath: COMPLETE,
  uploadUser: 'alice',
  uploadDate: '2026-01-01T00:00:00.000Z',
  imageCount: 1,
  imagesWithSpecies: 0,
});

describe('UploadMeta publication gate', () => {
  beforeEach(() => {
    clearClientCache();
    clients.length = 0;
  });

  it('excludes an unmarked upload from published uploads', async () => {
    const client = getClient(CFG) as unknown as FakeClient;
    client.listCommonPrefixes.mockResolvedValue([COMPLETE, INCOMPLETE]);
    client.getObject.mockImplementation(async (_bucket: string, key: string) => {
      if (key === `${INCOMPLETE}UploadMeta.json`) throw new Error('NoSuchKey');
      if (key === `${COMPLETE}UploadMeta.json`) return new TextEncoder().encode(META);
      if (key === `${COMPLETE}deployments.csv`) return new TextEncoder().encode('d1,LOC1\n');
      throw new Error(`unexpected key ${key}`);
    });

    await expect(listPublishedUploads(CFG, REF)).resolves.toEqual([
      expect.objectContaining({ prefix: COMPLETE, deploymentId: 'd1' }),
    ]);
  });

  it('surfaces marker read failures instead of treating published uploads as absent', async () => {
    const client = getClient(CFG) as unknown as FakeClient;
    client.listCommonPrefixes.mockResolvedValue([COMPLETE]);
    client.getObject.mockRejectedValue(new Error('Failed to fetch'));

    await expect(listPublishedUploads(CFG, REF)).rejects.toThrow('Failed to fetch');
  });

  it('excludes an unmarked upload from deployment locations', async () => {
    const client = getClient(CFG) as unknown as FakeClient;
    client.listCommonPrefixes.mockResolvedValue([COMPLETE, INCOMPLETE]);
    client.statObject.mockImplementation(async (_bucket: string, key: string) => {
      if (key === `${INCOMPLETE}UploadMeta.json`) throw new Error('NoSuchKey');
      return { size: 1, metadata: {} };
    });
    client.getObject.mockResolvedValue(new TextEncoder().encode('d1,LOC1\n'));

    await expect(listCollectionDeploymentLocationIds(CFG, REF)).resolves.toEqual(['LOC1']);
    expect(client.getObject).toHaveBeenCalledTimes(1);
  });
});
