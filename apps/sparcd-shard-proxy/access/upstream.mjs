// The one upstream (invariant 2). Every byte that leaves this process for
// storage goes through here, signed with the credential that never leaves it.
// Redirects are not followed: a 3xx is returned as-is rather than chased to
// whatever host it names.

import { AwsClient } from 'aws4fetch';

export function makeUpstream({ endpoint, region = 'us-east-1', accessKeyId, secretAccessKey }) {
  const base = new URL(endpoint);
  const credentials = { accessKeyId, secretAccessKey, service: 's3', region };
  // Client traffic is never retried here. A proxied PUT is the caller's to
  // retry, and a silent second attempt doubles the cost of a request an
  // attacker controls. The proxy's own metadata reads are small and idempotent,
  // so they keep the default.
  const passthrough = new AwsClient({ ...credentials, retries: 0 });
  const aws = new AwsClient(credentials);

  const url = (bucket, key = '', query) => {
    const u = new URL(base);
    u.pathname = `/${bucket}${key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''}`;
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  };

  // `allHeaders` signs every header on the request instead of aws4fetch's
  // default set. Ceph RGW refuses a PUT whose `content-type` is present but
  // absent from SignedHeaders with 403 AccessDenied, and `content-type` is one
  // of the headers aws4fetch skips by default. MinIO accepts either, so only
  // RGW ever showed it. Nothing below sets `content-length`, `connection` or
  // `host` by hand: those the runtime rewrites after signing, and a signed
  // header that changes in flight fails the same way.
  const signAll = (init) => ({ ...init, redirect: 'manual', aws: { ...init.aws, allHeaders: true } });
  const send = (u, init = {}) => passthrough.fetch(u, signAll(init));
  const sendMeta = (u, init = {}) => aws.fetch(u, signAll(init));

  return {
    origin: base,
    send,
    url,

    async get(bucket, key) {
      const res = await sendMeta(url(bucket, key));
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new Error(`GET ${bucket}/${key} → ${res.status}`);
      return { status: res.status, etag: res.headers.get('etag'), text: await res.text() };
    },

    async getJson(bucket, key) {
      const res = await this.get(bucket, key);
      return res.status === 404 ? { status: 404 } : { ...res, value: JSON.parse(res.text) };
    },

    /**
     * @param guard `{ ifMatch }` for a replace, `{ ifNoneMatch: '*' }` for a
     *              create. Returns false on 412/409, which is the caller's cue
     *              to reload and retry.
     */
    async put(bucket, key, body, { contentType = 'application/json', retry = true, ...guard } = {}) {
      const headers = { 'content-type': contentType };
      if (guard.ifMatch) headers['if-match'] = guard.ifMatch;
      if (guard.ifNoneMatch) headers['if-none-match'] = guard.ifNoneMatch;
      const via = retry ? sendMeta : send;
      // Bytes, not a string: for a string body Node's fetch appends its own
      // `content-type: text/plain;charset=UTF-8` after signing, which RGW then
      // rejects as an unsigned header even when the caller passed one.
      const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
      const res = await via(url(bucket, key), { method: 'PUT', body: bytes, headers });
      if (res.status === 412 || res.status === 409) return false;
      if (!res.ok) throw new Error(`PUT ${bucket}/${key} → ${res.status} ${await res.text()}`);
      return true;
    },

    async listKeys(bucket, prefix) {
      const keys = [];
      let token;
      do {
        const query = { 'list-type': '2', prefix, 'max-keys': '1000' };
        if (token) query['continuation-token'] = token;
        const res = await sendMeta(url(bucket, '', query));
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`LIST ${bucket}/${prefix} → ${res.status}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(decodeEntities(m[1]));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeEntities(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '')
          : null;
      } while (token);
      return keys;
    },

    /** One upstream listing page, with the fields a client's SDK reads back. */
    async listPage(bucket, {
      prefix = '', delimiter = '', token, startAfter, maxKeys = 1000,
    } = {}) {
      const query = { 'list-type': '2', prefix, 'max-keys': String(maxKeys) };
      if (delimiter) query.delimiter = delimiter;
      if (token) query['continuation-token'] = token;
      if (startAfter) query['start-after'] = startAfter;
      const res = await sendMeta(url(bucket, '', query));
      if (!res.ok) throw new Error(`LIST ${bucket}/${prefix} → ${res.status}`);
      const xml = await res.text();
      const keys = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => {
        const pick = (tag) => {
          const hit = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(m[1]);
          return hit ? decodeEntities(hit[1]) : undefined;
        };
        const key = pick('Key');
        // A listing entry with no key is not something to filter, skip or
        // guess at — it means the body is not the shape this code reads.
        if (key === undefined) throw new Error('listing entry has no Key');
        return {
          key,
          size: Number(pick('Size') ?? 0),
          lastModified: pick('LastModified'),
          etag: pick('ETag'),
        };
      });
      return {
        keys,
        commonPrefixes: [...xml.matchAll(/<CommonPrefixes><Prefix>([\s\S]*?)<\/Prefix><\/CommonPrefixes>/g)]
          .map((m) => decodeEntities(m[1])),
        nextToken: /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeEntities(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '')
          : null,
      };
    },

    /** The immediate child "directories" of a prefix, via the delimiter. */
    async listCommonPrefixes(bucket, prefix) {
      const res = await sendMeta(url(bucket, '', {
        'list-type': '2', prefix, delimiter: '/', 'max-keys': '1000',
      }));
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`LIST ${bucket}/${prefix} → ${res.status}`);
      const xml = await res.text();
      return [...xml.matchAll(/<CommonPrefixes><Prefix>([\s\S]*?)<\/Prefix><\/CommonPrefixes>/g)]
        .map((m) => decodeEntities(m[1]));
    },

    async listBuckets() {
      const u = new URL(base);
      u.pathname = '/';
      const res = await sendMeta(u);
      if (!res.ok) throw new Error(`ListBuckets → ${res.status}`);
      const xml = await res.text();
      return [...xml.matchAll(/<Bucket>[\s\S]*?<Name>([\s\S]*?)<\/Name>[\s\S]*?<\/Bucket>/g)]
        .map((m) => decodeEntities(m[1]));
    },
  };
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
