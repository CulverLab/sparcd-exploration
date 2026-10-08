import { describe, it, expect } from 'vitest';
import {
  SafeS3Client,
  BucketNotAllowedError,
  S3ReadError,
  listCollections,
  parseCollectionKey,
  readErrorDetails,
  translateReadError,
} from '../src/index';

// `listCollections` only ever calls `listBuckets()` and `getObject()`, so a
// duck-typed stub covering those two is enough to exercise its filtering,
// parsing, skip-on-error, and sort behavior without a live backend.
function fakeClient(
  buckets: string[],
  objects: Record<string, unknown | Error>,
): SafeS3Client {
  return {
    async listBuckets() {
      return buckets;
    },
    async getObject(bucket: string, key: string) {
      const hit = objects[`${bucket}/${key}`];
      if (hit === undefined || hit instanceof Error) throw hit ?? new Error('NoSuchKey');
      return new TextEncoder().encode(JSON.stringify(hit));
    },
  } as unknown as SafeS3Client;
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
    const err = translateReadError(
      Object.assign(new Error('denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403, requestId: 'req-1', extendedRequestId: 'ext-1' },
      }),
      'x',
    );
    expect(err.message).toMatch(/Access denied reading x/);
    expect(err).toBeInstanceOf(S3ReadError);
    expect(err).toMatchObject({ code: 'AccessDenied', status: 403, requestId: 'req-1', extendedRequestId: 'ext-1' });
  });

  it('preserves a non-permission 403 code instead of calling it access denied', () => {
    const err = translateReadError(
      Object.assign(new Error('signature'), {
        name: 'SignatureDoesNotMatch',
        $metadata: { httpStatusCode: 403, requestId: 'req-2' },
      }),
      'media.csv',
    );
    expect(err.message).toBe('S3 rejected reading media.csv: SignatureDoesNotMatch (HTTP 403).');
    expect(err).toMatchObject({ code: 'SignatureDoesNotMatch', status: 403, requestId: 'req-2' });
  });

  it('preserves invalid credentials and clock-skew diagnostics', () => {
    const invalidCredentials = Object.assign(new Error('invalid key'), {
      name: 'InvalidAccessKeyId',
      $metadata: { httpStatusCode: 403, requestId: 'req-credentials' },
    });
    const invalidError = translateReadError(invalidCredentials, 'media.csv');
    expect(invalidError.message).toBe('S3 rejected reading media.csv: InvalidAccessKeyId (HTTP 403).');
    expect(invalidError).toMatchObject({ code: 'InvalidAccessKeyId', status: 403, requestId: 'req-credentials' });

    const clockSkew = Object.assign(new Error('clock'), {
      name: 'RequestTimeTooSkewed',
      $metadata: { httpStatusCode: 403, requestId: 'req-clock', extendedRequestId: 'ext-clock' },
    });
    expect(translateReadError(clockSkew, 'media.csv')).toMatchObject({
      code: 'RequestTimeTooSkewed',
      status: 403,
      requestId: 'req-clock',
      extendedRequestId: 'ext-clock',
    });
  });

  it('retains the original SDK error as the translated error cause', () => {
    const original = Object.assign(new Error('temporary failure'), {
      name: 'ServiceUnavailable',
      $metadata: { httpStatusCode: 503, requestId: 'req-cause' },
    });
    const translated = translateReadError(original, 'media.csv');
    expect(translated).toMatchObject({ cause: original, code: 'ServiceUnavailable', status: 503 });
  });

  it('explains when a browser HEAD failure has no exposed S3 code', () => {
    const err = translateReadError(
      Object.assign(new Error('forbidden'), { name: 'UnknownError', $metadata: { httpStatusCode: 403 } }),
      'media.csv',
    );
    expect(err.message).toBe(
      'S3 returned HTTP 403 while reading media.csv, but the service did not expose an error code.',
    );
    expect(err).toMatchObject({ status: 403 });
  });

  it('extracts request identifiers exposed only as response headers', () => {
    expect(
      readErrorDetails({
        name: 'UnknownError',
        $metadata: { httpStatusCode: 403 },
        $response: { headers: { 'x-amz-request-id': 'req-3', 'x-amz-id-2': 'ext-3' } },
      }),
    ).toEqual({ code: undefined, status: 403, requestId: 'req-3', extendedRequestId: 'ext-3' });
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
