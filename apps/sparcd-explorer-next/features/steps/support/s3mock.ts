// An in-process, read-only S3 served to the page through `page.route`, adapted
// from the Tagger's mock. The explorer reaches storage only through
// `@sparcd/s3-safe` (AWS SDK v3 against `cfg.endpoint`); the tests point the
// endpoint at the app's own origin, so every request is same-origin and this
// handler answers ListBuckets, ListObjectsV2, GetObject (with byte ranges)
// and HeadObject. Requests not addressed to a mock bucket fall through to Vite.

import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Route } from '@playwright/test';

type StoredObject = { body: Buffer; contentType: string; etag: string };

const SEP = '\0';
const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');

export class MockS3 {
  readonly buckets: string[] = [];
  private readonly objects = new Map<string, StoredObject>();
  private readonly reads = new Map<string, number>();
  /** Keys whose GET (or prefix whose listing) answers with an S3 error. */
  readonly failures = new Map<string, { status: number; code: string }>();
  /** Milliseconds a key's GET or a prefix's listing waits before answering. */
  readonly delays = new Map<string, number>();
  /** Access keys the store refuses, as a wrong username or password. */
  readonly rejectedKeys = new Set<string>();
  /** Every GET of an object, with its byte range when it asked for one. */
  readonly gets: { key: string; range: string | null }[] = [];
  /** Fail ranged GETs at the network level, as a CORS policy without `Range` does. */
  refuseRanges = false;

  addBucket(name: string): void {
    if (!this.buckets.includes(name)) this.buckets.push(name);
  }

  put(bucket: string, key: string, body: Buffer | string, contentType = 'text/csv'): void {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    this.addBucket(bucket);
    this.objects.set(`${bucket}${SEP}${key}`, { body: buf, contentType, etag: md5(buf) });
  }

  get(bucket: string, key: string): StoredObject | undefined {
    return this.objects.get(`${bucket}${SEP}${key}`);
  }

  delete(bucket: string, key: string): void {
    this.objects.delete(`${bucket}${SEP}${key}`);
  }

  keys(bucket: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const k of this.objects.keys()) {
      const [b, key] = k.split(SEP);
      if (b === bucket && key.startsWith(prefix)) out.push(key);
    }
    return out.sort();
  }

  readCount(key: string): number {
    return this.reads.get(key) ?? 0;
  }

  countRead(key: string): void {
    this.reads.set(key, this.readCount(key) + 1);
  }
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS = 'http://s3.amazonaws.com/doc/2006-03-01/';
const NOW = '2024-06-01T00:00:00.000Z';
const XML = { 'content-type': 'application/xml' } as const;

const errorXml = (code: string, message: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message><RequestId>mock</RequestId></Error>`;

function listBucketsXml(buckets: string[]): string {
  const rows = buckets.map((b) => `<Bucket><Name>${xmlEscape(b)}</Name><CreationDate>${NOW}</CreationDate></Bucket>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="${NS}"><Owner><ID>mock</ID><DisplayName>mock</DisplayName></Owner><Buckets>${rows}</Buckets></ListAllMyBucketsResult>`;
}

function listObjectsXml(
  bucket: string,
  prefix: string,
  delimiter: string | null,
  contents: { key: string; size: number; etag: string }[],
  prefixes: string[],
): string {
  const c = contents
    .map(
      (o) =>
        `<Contents><Key>${xmlEscape(o.key)}</Key><LastModified>${NOW}</LastModified><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join('');
  const cp = prefixes.map((p) => `<CommonPrefixes><Prefix>${xmlEscape(p)}</Prefix></CommonPrefixes>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="${NS}"><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix>${
    delimiter ? `<Delimiter>${xmlEscape(delimiter)}</Delimiter>` : ''
  }<KeyCount>${contents.length + prefixes.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${c}${cp}</ListBucketResult>`;
}

export const testOrigin = () => `http://localhost:${process.env.SPARCD_E2E_PORT ?? '5314'}`;

export async function installS3Mock(target: Page | BrowserContext, s3: MockS3): Promise<void> {
  await target.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== testOrigin()) return route.fallback();

    const segments = url.pathname.split('/').filter(Boolean);
    const auth = request.headers()['authorization'] ?? '';
    const isListBuckets = segments.length === 0 && auth.startsWith('AWS4-HMAC');
    const bucket = segments[0] ?? '';
    if (!isListBuckets && !s3.buckets.includes(bucket)) return route.fallback();

    const accessKey = /Credential=([^/]+)\//.exec(auth)?.[1];
    if (accessKey && s3.rejectedKeys.has(accessKey)) {
      await route.fulfill({ status: 403, headers: XML, body: errorXml('InvalidAccessKeyId', 'unknown access key') });
      return;
    }
    if (isListBuckets) {
      await route.fulfill({ status: 200, headers: XML, body: listBucketsXml(s3.buckets) });
      return;
    }

    const isList = request.method() === 'GET' && url.searchParams.get('list-type') === '2';
    const key = isList ? (url.searchParams.get('prefix') ?? '') : decodeURIComponent(segments.slice(1).join('/'));
    const wait = s3.delays.get(key);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const failure = s3.failures.get(key);
    if (failure && request.method() !== 'HEAD') {
      await route.fulfill({ status: failure.status, headers: XML, body: errorXml(failure.code, `mock failure for ${key}`) });
      return;
    }

    if (isList) {
      const delimiter = url.searchParams.get('delimiter');
      const contents: { key: string; size: number; etag: string }[] = [];
      const common = new Set<string>();
      for (const k of s3.keys(bucket, key)) {
        const rest = k.slice(key.length);
        const i = delimiter ? rest.indexOf(delimiter) : -1;
        if (i >= 0) {
          common.add(key + rest.slice(0, i + delimiter!.length));
          continue;
        }
        const o = s3.get(bucket, k)!;
        contents.push({ key: k, size: o.body.length, etag: o.etag });
      }
      await route.fulfill({ status: 200, headers: XML, body: listObjectsXml(bucket, key, delimiter, contents, [...common].sort()) });
      return;
    }

    const existing = s3.get(bucket, key);
    if (request.method() === 'HEAD') {
      await route.fulfill(
        existing
          ? { status: 200, headers: { 'content-type': existing.contentType, etag: `"${existing.etag}"` }, body: '' }
          : { status: 404, headers: XML, body: '' },
      );
      return;
    }
    if (request.method() === 'GET') {
      s3.countRead(key);
      const range = request.headers()['range'] ?? null;
      s3.gets.push({ key, range });
      if (range && s3.refuseRanges) return route.abort('failed');
      if (!existing) {
        await route.fulfill({ status: 404, headers: XML, body: errorXml('NoSuchKey', `no such key ${key}`) });
        return;
      }
      const headers = { 'content-type': existing.contentType, etag: `"${existing.etag}"`, 'cache-control': 'no-store' };
      const bytes = range && /^bytes=(\d+)-(\d*)$/.exec(range);
      if (bytes) {
        const size = existing.body.length;
        const start = Number(bytes[1]);
        const end = Math.min(size - 1, bytes[2] ? Number(bytes[2]) : size - 1);
        await route.fulfill({
          status: 206,
          headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}` },
          body: existing.body.subarray(start, end + 1),
        });
        return;
      }
      await route.fulfill({ status: 200, headers, body: existing.body });
      return;
    }
    await route.fulfill({ status: 405, headers: XML, body: errorXml('MethodNotAllowed', 'the explorer only reads') });
  });
}
