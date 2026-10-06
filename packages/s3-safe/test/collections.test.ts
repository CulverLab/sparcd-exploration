import { describe, it, expect } from 'vitest';
import {
  SafeS3Client,
  BucketNotAllowedError,
  isLegacyBucket,
  listCollections,
  listUploadFolders,
  parseCollectionKey,
  translateReadError,
} from '../src/index';

// `listCollections` only ever calls `listBuckets()`, `listCommonPrefixes()` and
// `getObject()`, so a duck-typed stub covering those is enough to exercise its
// filtering, merging, skip-on-error, and sort behavior without a live backend.
// Folders are derived from the object keys; `unlistable` buckets refuse listing.
function fakeClient(
  buckets: string[],
  objects: Record<string, unknown | Error>,
  unlistable: string[] = [],
): SafeS3Client & { listed: string[] } {
  const listed: string[] = [];
  return {
    listed,
    async listBuckets() {
      return buckets;
    },
    async listCommonPrefixes(bucket: string, prefix: string) {
      listed.push(bucket);
      if (unlistable.includes(bucket)) throw new Error('AccessDenied');
      const folders = new Set<string>();
      for (const path of Object.keys(objects)) {
        if (!path.startsWith(`${bucket}/${prefix}`)) continue;
        const rest = path.slice(bucket.length + 1 + prefix.length);
        if (rest.includes('/')) folders.add(prefix + rest.slice(0, rest.indexOf('/') + 1));
      }
      return [...folders].sort();
    },
    async getObject(bucket: string, key: string) {
      const hit = objects[`${bucket}/${key}`];
      if (hit === undefined || hit instanceof Error) throw hit ?? new Error('NoSuchKey');
      return new TextEncoder().encode(JSON.stringify(hit));
    },
  } as unknown as SafeS3Client & { listed: string[] };
}

describe('parseCollectionKey', () => {
  it('splits a `bucket::uuid` key', () => {
    expect(parseCollectionKey('sparcd-ABC::abc')).toEqual({ bucket: 'sparcd-ABC', uuid: 'abc' });
  });
});

describe('listCollections', () => {
  it('keeps only `sparcd-<uuid>` buckets, skips unreadable markers, and sorts by name', async () => {
    const client = fakeClient(
      // `other` lacks the prefix; bare `sparcd-` has nothing after it; `sparcd-NOPE`
      // is a candidate whose marker GET fails and must be skipped, not fatal.
      ['sparcd-ZED', 'sparcd-ALF', 'other-bucket', 'sparcd-', 'sparcd-NOPE'],
      {
        'sparcd-ZED/Collections/zed/collection.json': {
          nameProperty: 'Zebra',
          organizationProperty: 'Org Z',
          contactInfoProperty: 'a@b.edu',
          descriptionProperty: 'desc Z',
        },
        'sparcd-ALF/Collections/alf/collection.json': { nameProperty: 'Alpha' },
        'sparcd-NOPE/Collections/nope/collection.json': new Error('AccessDenied'),
      },
    );

    const result = await listCollections(client);

    // Alpha sorts before Zebra; the prefix-only and non-prefixed buckets and the
    // unreadable candidate are all absent.
    expect(result.map((c) => c.bucket)).toEqual(['sparcd-ALF', 'sparcd-ZED']);
    expect(result[0]).toEqual({
      key: 'sparcd-ALF::alf',
      bucket: 'sparcd-ALF',
      uuid: 'alf', // lowercased from the bucket suffix
      buckets: ['sparcd-ALF'],
      dataBucket: null,
      name: 'Alpha',
      organization: null, // absent organizationProperty → null
      contact: null,
      description: null,
    });
    expect(result[1].organization).toBe('Org Z');
    expect(result[1].contact).toBe('a@b.edu');
    expect(result[1].description).toBe('desc Z');
  });

  it('keeps a collection whose optional metadata fields are not strings', async () => {
    // A producer bug / schema drift (number, object) must not throw and drop the
    // whole collection from discovery — the field just coerces to null.
    const client = fakeClient(['sparcd-ABC'], {
      'sparcd-ABC/Collections/abc/collection.json': {
        nameProperty: 'Gamma',
        organizationProperty: 42,
        contactInfoProperty: { email: 'x@y.z' },
        descriptionProperty: ['weird'],
      },
    });
    const result = await listCollections(client);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'Gamma',
      organization: null,
      contact: null,
      description: null,
    });
  });

  // A store can expose a hundred-plus collection buckets. Firing every marker
  // GET at once just queues them behind the browser's per-origin connection
  // limit and starves the rest of the page mid-connect.
  it('keeps at most 16 marker reads in flight', async () => {
    const buckets = Array.from({ length: 129 }, (_, i) => `sparcd-${String(i).padStart(4, '0')}`);
    let inFlight = 0;
    let peak = 0;
    const client = {
      async listBuckets() {
        return buckets;
      },
      async getObject() {
        peak = Math.max(peak, ++inFlight);
        await Promise.resolve();
        inFlight--;
        return new TextEncoder().encode('{"nameProperty":"C"}');
      },
    } as unknown as SafeS3Client;

    const result = await listCollections(client);
    expect(result).toHaveLength(129);
    expect(peak).toBeLessThanOrEqual(16);
  });

  it('finds every collection in a data bucket whatever its name', async () => {
    const client = fakeClient(['field-store'], {
      'field-store/Collections/u1/collection.json': { nameProperty: 'One' },
      'field-store/Collections/u2/collection.json': { nameProperty: 'Two' },
    });
    const result = await listCollections(client);
    expect(result.map((c) => [c.key, c.buckets, c.dataBucket])).toEqual([
      ['field-store::u1', ['field-store'], 'field-store'],
      ['field-store::u2', ['field-store'], 'field-store'],
    ]);
  });

  it('merges a uuid held by a data bucket and its legacy bucket into one collection', async () => {
    const client = fakeClient(['sparcd-u1', 'field-store'], {
      'sparcd-u1/Collections/u1/collection.json': { nameProperty: 'Legacy name' },
      'field-store/Collections/u1/collection.json': { nameProperty: 'Data name' },
    });
    const [ref, ...rest] = await listCollections(client);
    expect(rest).toEqual([]);
    expect(ref).toMatchObject({
      key: 'field-store::u1',
      bucket: 'field-store',
      buckets: ['field-store', 'sparcd-u1'],
      dataBucket: 'field-store',
      name: 'Data name',
    });
  });

  it('reads collection.json from the legacy bucket when the data bucket only holds uploads', async () => {
    const client = fakeClient(['sparcd-u1', 'field-store'], {
      'sparcd-u1/Collections/u1/collection.json': { nameProperty: 'Legacy name' },
      'field-store/Collections/u1/Uploads/2026.01.01.00.00.00_ana/media.csv': {},
    });
    const [ref] = await listCollections(client);
    expect(ref).toMatchObject({
      key: 'sparcd-u1::u1',
      bucket: 'sparcd-u1',
      buckets: ['field-store', 'sparcd-u1'],
      dataBucket: 'field-store',
      name: 'Legacy name',
    });
  });

  it('skips data-bucket folders nothing describes, and buckets it cannot list', async () => {
    const client = fakeClient(
      ['field-store', 'locked'],
      { 'field-store/Collections/orphan/Uploads/x/media.csv': {} },
      ['locked'],
    );
    expect(await listCollections(client)).toEqual([]);
  });

  it('never lists the reserved legacy names as data buckets', async () => {
    const client = fakeClient(['sparcd', 'sparcd-settings-abc', 'sparcd-u1', 'field-store'], {
      'sparcd/Collections/u9/collection.json': { nameProperty: 'Not a data bucket' },
    });
    await listCollections(client);
    expect(client.listed).toEqual(['field-store']);
  });
});

describe('isLegacyBucket', () => {
  it('reserves `sparcd` and `sparcd-*`', () => {
    expect(isLegacyBucket('sparcd')).toBe(true);
    expect(isLegacyBucket('sparcd-settings-x')).toBe(true);
    expect(isLegacyBucket('sparcd-8dbd9c43')).toBe(true);
    expect(isLegacyBucket('sparcdata')).toBe(false);
    expect(isLegacyBucket('field-store')).toBe(false);
  });
});

describe('listUploadFolders', () => {
  it('unions upload folders across buckets, reading a copied folder from the first bucket', async () => {
    const up = (b: string, name: string) => `${b}/Collections/u1/Uploads/${name}/media.csv`;
    const client = fakeClient([], {
      [up('field-store', 'B_new')]: {},
      [up('field-store', 'A_copied')]: {},
      [up('sparcd-u1', 'A_copied')]: {},
      [up('sparcd-u1', 'C_old')]: {},
    });
    const folders = await listUploadFolders(client, { uuid: 'u1', buckets: ['field-store', 'sparcd-u1'] });
    expect(folders).toEqual([
      { bucket: 'field-store', prefix: 'Collections/u1/Uploads/A_copied/' },
      { bucket: 'field-store', prefix: 'Collections/u1/Uploads/B_new/' },
      { bucket: 'sparcd-u1', prefix: 'Collections/u1/Uploads/C_old/' },
    ]);
  });
});

describe('translateReadError', () => {
  const meta = (httpStatusCode?: number) => ({ $metadata: { httpStatusCode } });

  it('passes a BucketNotAllowedError through untouched', () => {
    const err = new BucketNotAllowedError('sparcd-x');
    expect(translateReadError(err, 'thing')).toBe(err);
  });

  it('maps 404 / NoSuchKey to a not-found message', () => {
    expect(translateReadError(meta(404), 'UploadMeta.json').message).toBe(
      'UploadMeta.json not found.',
    );
    expect(translateReadError({ name: 'NoSuchKey' }, 'UploadMeta.json').message).toBe(
      'UploadMeta.json not found.',
    );
  });

  it('maps 403 / AccessDenied to a permissions message', () => {
    expect(translateReadError(meta(403), 'x').message).toMatch(/Access denied reading x/);
    expect(translateReadError({ name: 'AccessDenied' }, 'x').message).toMatch(/Access denied/);
  });

  it('maps a status-less failure to the CORS / unreachable message', () => {
    // The browser-direct-to-S3 case: a CORS preflight rejection aborts before
    // any HTTP response, so there is no status code.
    expect(translateReadError(meta(undefined), 'x').message).toMatch(/CORS policy/);
  });

  it('falls back to the HTTP status for any other failure', () => {
    expect(translateReadError(meta(500), 'x').message).toBe('Failed to read x (HTTP 500).');
  });
});
