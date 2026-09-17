// An in-process S3-compatible store served to the page through `page.route`.
//
// The tagger talks to storage only through `@sparcd/s3-safe`, i.e. the AWS SDK
// v3 against `cfg.endpoint`. The tests point the endpoint at the app's OWN
// origin (`http://localhost:5312`) so every request is same-origin — no CORS,
// no preflight — and this handler answers the five verbs the app can reach:
// ListBuckets, ListObjectsV2, GetObject, HeadObject and PutObject (both the
// `IfNoneMatch: "*"` immutable write and the `IfMatch` conditional replace).
//
// Requests that are not addressed to a mock bucket fall through to Vite.

import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Route } from '@playwright/test';

export type StoredObject = { body: Buffer; contentType: string; etag: string };

export type PutRecord = {
  bucket: string;
  key: string;
  ifMatch?: string;
  ifNoneMatch?: string;
  body: string;
};

const OBJECT_KEY_SEPARATOR = '\\0';
const objKey = (bucket: string, key: string): string => `${bucket}${OBJECT_KEY_SEPARATOR}${key}`;

export const md5 = (b: Buffer | string): string =>
  createHash('md5').update(b).digest('hex');

export const sha256 = (b: Buffer | string): string =>
  createHash('sha256').update(b).digest('hex');

export class MockS3 {
  readonly buckets: string[] = [];
  private readonly objects = new Map<string, StoredObject>();

  /** Every PUT the page issued, in order — the write-side assertions read this. */
  readonly puts: PutRecord[] = [];

  /** When set, the next canonical replace answers with this failure mode. */
  replaceMode: 'ok' | 'unsupported' = 'ok';

  /** Artificial latency per object key — lets a test observe loading states. */
  readonly delays = new Map<string, number>();
  /** Object reads to make refresh assertions independent of timing. */
  private readonly reads = new Map<string, number>();
  /** Persistent GET failures for error-state coverage. */
  private readonly failedReads = new Set<string>();

  /** Fail GETs after a fixed number of successful reads of an object. */
  readonly getFailures = new Map<string, { successfulReadsRemaining: number }>();

  delay(key: string, ms: number): void {
    this.delays.set(key, ms);
  }

  failRead(key: string): void {
    this.failedReads.add(key);
  }

  readCount(key: string): number {
    return this.reads.get(key) ?? 0;
  }

  failGetsAfter(key: string, successfulReads: number): void {
    this.getFailures.set(key, { successfulReadsRemaining: successfulReads });
  }

  shouldFailGet(key: string): boolean {
    const failure = this.getFailures.get(key);
    if (!failure) return false;
    if (failure.successfulReadsRemaining > 0) {
      failure.successfulReadsRemaining -= 1;
      return false;
    }
    return true;
  }

  addBucket(name: string): void {
    if (!this.buckets.includes(name)) this.buckets.push(name);
  }

  put(bucket: string, key: string, body: Buffer | string, contentType: string): void {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    this.addBucket(bucket);
    this.objects.set(objKey(bucket, key), { body: buf, contentType, etag: md5(buf) });
  }

  get(bucket: string, key: string): StoredObject | undefined {
    return this.objects.get(objKey(bucket, key));
  }

  text(bucket: string, key: string): string {
    const o = this.get(bucket, key);
    if (!o) throw new Error(`mock S3: no object ${bucket}/${key}`);
    return o.body.toString('utf8');
  }

  has(bucket: string, key: string): boolean {
    return this.objects.has(objKey(bucket, key));
  }

  delete(bucket: string, key: string): void {
    this.objects.delete(objKey(bucket, key));
  }

  keys(bucket: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const k of this.objects.keys()) {
      const [b, key] = k.split(OBJECT_KEY_SEPARATOR);
      if (b === bucket && key.startsWith(prefix)) out.push(key);
    }
    return out.sort();
  }

  etag(bucket: string, key: string): string {
    const o = this.get(bucket, key);
    if (!o) throw new Error(`mock S3: no object ${bucket}/${key}`);
    return o.etag;
  }

  /** sha256 of an object's bytes — what the sync journal grounds on. */
  hash(bucket: string, key: string): string {
    const o = this.get(bucket, key);
    if (!o) throw new Error(`mock S3: no object ${bucket}/${key}`);
    return sha256(o.body);
  }

  putsFor(prefix: string): PutRecord[] {
    return this.puts.filter((p) => p.key.startsWith(prefix));
  }
}

// --- XML wire format --------------------------------------------------------

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS = 'http://s3.amazonaws.com/doc/2006-03-01/';
const NOW = '2024-06-01T00:00:00.000Z';

function listBucketsXml(buckets: string[]): string {
  const rows = buckets
    .map((b) => `<Bucket><Name>${xmlEscape(b)}</Name><CreationDate>${NOW}</CreationDate></Bucket>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="${NS}"><Owner><ID>mock</ID><DisplayName>mock</DisplayName></Owner><Buckets>${rows}</Buckets></ListAllMyBucketsResult>`;
}

function listObjectsXml(
  bucket: string,
  prefix: string,
  delimiter: string | null,
  contents: { key: string; size: number; etag: string }[],
  commonPrefixes: string[],
): string {
  const c = contents
    .map(
      (o) =>
        `<Contents><Key>${xmlEscape(o.key)}</Key><LastModified>${NOW}</LastModified><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join('');
  const cp = commonPrefixes
    .map((p) => `<CommonPrefixes><Prefix>${xmlEscape(p)}</Prefix></CommonPrefixes>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="${NS}"><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix>${
    delimiter ? `<Delimiter>${xmlEscape(delimiter)}</Delimiter>` : ''
  }<KeyCount>${contents.length + commonPrefixes.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${c}${cp}</ListBucketResult>`;
}

function errorXml(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message><RequestId>mock</RequestId></Error>`;
}

const XML = { 'content-type': 'application/xml' } as const;

// --- The route handler ------------------------------------------------------

/**
 * Install the mock on a page. Only requests whose first path segment names a
 * bucket the mock knows — plus the credentialed `GET /` that is ListBuckets —
 * are answered here; anything else (the app bundle, HMR) falls through.
 */
export async function installS3Mock(page: Page | BrowserContext, s3: MockS3): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const testOrigin = `http://localhost:${process.env.SPARCD_E2E_PORT ?? '5312'}`;
    const sameOrigin = url.origin === testOrigin;

    // Species reference images point at example.org; serve a placeholder so the
    // loupe has something to enlarge instead of an unresolvable host.
    if (url.host === 'example.org') {
      const { makePng } = await import('./png');
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: makePng(64, 64, 5),
      });
      return;
    }

    if (!sameOrigin) return route.fallback();

    const segments = url.pathname.split('/').filter(Boolean);
    const auth = request.headers()['authorization'] ?? '';
    const isListBuckets = segments.length === 0 && auth.startsWith('AWS4-HMAC');
    const bucket = segments[0] ?? '';

    if (!isListBuckets && !s3.buckets.includes(bucket)) return route.fallback();

    if (isListBuckets) {
      await route.fulfill({ status: 200, headers: XML, body: listBucketsXml(s3.buckets) });
      return;
    }

    const key = decodeURIComponent(segments.slice(1).join('/'));
    const wait = s3.delays.get(key);
    if (wait) await new Promise((r) => setTimeout(r, wait));

    // ListObjectsV2 — a GET on the bucket root carrying `list-type=2`.
    if (request.method() === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const delimiter = url.searchParams.get('delimiter');
      const all = s3.keys(bucket, prefix);
      const contents: { key: string; size: number; etag: string }[] = [];
      const common = new Set<string>();
      for (const k of all) {
        if (delimiter) {
          const rest = k.slice(prefix.length);
          const i = rest.indexOf(delimiter);
          if (i >= 0) {
            common.add(prefix + rest.slice(0, i + delimiter.length));
            continue;
          }
        }
        const o = s3.get(bucket, k)!;
        contents.push({ key: k, size: o.body.length, etag: o.etag });
      }
      await route.fulfill({
        status: 200,
        headers: XML,
        body: listObjectsXml(bucket, prefix, delimiter, contents, [...common].sort()),
      });
      return;
    }

    const existing = s3.get(bucket, key);

    if (request.method() === 'HEAD') {
      if (!existing) {
        await route.fulfill({ status: 404, headers: XML, body: '' });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'content-type': existing.contentType, etag: `"${existing.etag}"` },
        body: '',
      });
      return;
    }

    if (request.method() === 'GET') {
      s3.reads.set(key, s3.readCount(key) + 1);
      if (s3.failedReads.has(key)) {
        await route.fulfill({
          status: 500,
          headers: XML,
          body: errorXml('InternalError', `temporary read failure for ${key}`),
        });
        return;
      }
      if (s3.shouldFailGet(key)) {
        await route.fulfill({
          status: 503,
          headers: XML,
          body: errorXml('ServiceUnavailable', `temporary read failure for ${key}`),
        });
        return;
      }
      if (!existing) {
        await route.fulfill({
          status: 404,
          headers: XML,
          body: errorXml('NoSuchKey', `no such key ${key}`),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': existing.contentType,
          etag: `"${existing.etag}"`,
          'cache-control': 'no-store',
        },
        body: existing.body,
      });
      return;
    }

    if (request.method() === 'PUT') {
      const headers = request.headers();
      const ifMatch = headers['if-match'];
      const ifNoneMatch = headers['if-none-match'];
      const body = request.postData() ?? '';
      s3.puts.push({ bucket, key, ifMatch, ifNoneMatch, body });

      if (ifNoneMatch === '*' && existing) {
        await route.fulfill({
          status: 412,
          headers: XML,
          body: errorXml('PreconditionFailed', 'object already exists'),
        });
        return;
      }
      if (ifMatch !== undefined) {
        if (s3.replaceMode === 'unsupported') {
          await route.fulfill({
            status: 501,
            headers: XML,
            body: errorXml('NotImplemented', 'IfMatch is not supported by this store'),
          });
          return;
        }
        const want = ifMatch.replace(/"/g, '');
        if (!existing || existing.etag !== want) {
          await route.fulfill({
            status: 412,
            headers: XML,
            body: errorXml('PreconditionFailed', 'etag mismatch'),
          });
          return;
        }
      }
      const contentType = headers['content-type'] ?? 'application/octet-stream';
      s3.put(bucket, key, body, contentType);
      await route.fulfill({
        status: 200,
        headers: { etag: `"${s3.etag(bucket, key)}"` },
        body: '',
      });
      return;
    }

    await route.fulfill({ status: 405, headers: XML, body: errorXml('MethodNotAllowed', '') });
  });
}
