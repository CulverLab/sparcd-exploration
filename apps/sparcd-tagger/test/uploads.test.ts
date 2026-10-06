// Uploads are listed across every bucket of a collection, and each carries the
// bucket its folder was listed from — the bucket every read and write for it uses.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { SafeS3Client } from '@sparcd/s3-safe';
import { listUploads, parseCollectionKey, type CollectionRef } from '../src/lib/s3';
import { draftId, loadDraftsForUpload, putDraft } from '../src/lib/db';

const cfg = { endpoint: 'https://s3.example.test', region: 'us-east-1', accessKey: 'key', secretKey: 'secret', forcePathStyle: true };
const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
const LEGACY = `sparcd-${UUID}`;
const DATA = 'field-data';
const ROOT = `Collections/${UUID}/Uploads/`;

/** Upload folders per bucket, by stamp, and whether each has its media.csv yet. */
function fakeClient(folders: Record<string, Record<string, boolean>>) {
  return {
    async listCommonPrefixes(bucket: string, prefix: string) {
      return Object.keys(folders[bucket] ?? {}).map((stamp) => `${prefix}${stamp}/`);
    },
    async statObject(bucket: string, key: string) {
      if (!folders[bucket]?.[key.slice(ROOT.length).split('/')[0]]) {
        throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      }
      return { size: 1, metadata: {} };
    },
  } as unknown as SafeS3Client;
}

function ref(buckets: string[]): CollectionRef {
  return {
    key: `${buckets[0]}::${UUID}`,
    bucket: buckets[0],
    uuid: UUID,
    buckets,
    dataBucket: buckets.find((b) => !b.startsWith('sparcd-')) ?? null,
    name: null,
    organization: null,
    contact: null,
    description: null,
  };
}

describe('listUploads', () => {
  it('leaves out a folder whose media.csv is not written yet', async () => {
    const client = fakeClient({ [LEGACY]: { '2024.01.15.10.00.00_ann': true, '2024.02.01.09.00.00_bo': false } });
    const uploads = await listUploads(cfg, ref([LEGACY]), client);
    expect(uploads.map((u) => u.stamp)).toEqual(['2024.01.15.10.00.00_ann']);
  });

  it('lists the uploads of both buckets, a folder in both once from the data bucket', async () => {
    const client = fakeClient({
      [DATA]: { '2026.09.01.08.00.00_cy': true, '2024.01.15.10.00.00_ann': true },
      [LEGACY]: { '2024.01.15.10.00.00_ann': true, '2023.06.01.09.30.00_dee': true },
    });
    const uploads = await listUploads(cfg, ref([DATA, LEGACY]), client);
    expect(uploads.map((u) => [u.bucket, u.stamp])).toEqual([
      [DATA, '2026.09.01.08.00.00_cy'],
      [DATA, '2024.01.15.10.00.00_ann'],
      [LEGACY, '2023.06.01.09.30.00_dee'],
    ]);
    expect(uploads[2].prefix).toBe(`${ROOT}2023.06.01.09.30.00_dee/`);
  });
});

describe('drafts saved before data buckets', () => {
  // Before, every upload's bucket came from the collection key, which for a
  // legacy collection named its `sparcd-<uuid>` bucket. A legacy upload is still
  // listed from that bucket — also once the collection gains a data bucket and
  // its key moves there — so its drafts still load.
  it.each([
    ['only its legacy bucket', [LEGACY]],
    ['a data bucket too', [DATA, LEGACY]],
  ])('stay with a legacy upload when the collection has %s', async (_, buckets) => {
    const keyedWith = parseCollectionKey(`${LEGACY}::${UUID}`).bucket;
    const prefix = `${ROOT}2024.01.15.10.00.00_ann/`;
    const mediaPath = `${prefix}IMG001.JPG`;
    await putDraft({
      id: draftId(keyedWith, prefix, mediaPath),
      bucket: keyedWith,
      uploadPrefix: prefix,
      mediaPath,
      deploymentId: `${UUID}:SAN15`,
      observations: [],
      questionable: true,
      timeOverride: null,
      lastEdited: '2024-02-01T00:00:00Z',
      dirty: true,
    });

    const [upload] = await listUploads(cfg, ref(buckets), fakeClient({ [LEGACY]: { '2024.01.15.10.00.00_ann': true } }));
    expect(upload.bucket).toBe(keyedWith);
    const drafts = await loadDraftsForUpload(upload.bucket, upload.prefix);
    expect(drafts.map((d) => d.id)).toEqual([draftId(keyedWith, prefix, mediaPath)]);
  });
});
