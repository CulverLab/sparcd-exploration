// The access proxy. One upstream S3 credential, one key pair per person.
//
// Every request arrives signed with the key the proxy issued to that person.
// The proxy verifies it, decides what the person may do, then re-signs with
// the upstream credential — so the browser never holds the real secret, and a
// person's access can be changed or revoked without touching storage.
//
// It sits behind the existing Caddy shard front: Caddy keeps TLS and the shard
// ports and reverse-proxies here with the client's Host preserved, because the
// Host is what the caller signed and what this process verifies against.

import { createServer as createHttpServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { verifySignature, escapeXml, DROP_FROM_CLIENT } from './sigv4.mjs';
import {
  bucketFromPath, keyFromPath, filterListBuckets, rewriteBucketName,
} from './namespace.mjs';
import { classify, decide, eventKind, filterListing } from './rules.mjs';
import { makeStore, isSettingsBucket } from './store.mjs';
import { makeActivity } from './activity.mjs';
import { makeApi, ApiError } from './api.mjs';
import { makeUpstream } from './upstream.mjs';
import { loadMasterKey, unwrapSecret } from './keys.mjs';

const ALLOW_METHODS = 'GET, HEAD, PUT, POST, DELETE, PATCH';

// Mirrors the Caddyfile and the Worker. Anything a browser S3 client may set
// must be named here or the preflight fails before a byte moves.
const ALLOW_HEADERS = [
  'authorization', 'content-type', 'if-match', 'if-none-match', 'range',
  'amz-sdk-invocation-id', 'amz-sdk-request', 'x-amz-content-sha256',
  'x-amz-date', 'x-amz-meta-sha256', 'x-amz-user-agent',
  'x-amz-checksum-crc32', 'x-amz-checksum-sha256', 'x-amz-checksum-mode',
  'x-amz-sdk-checksum-algorithm', 'x-amz-security-token',
  'x-amz-decoded-content-length', 'x-amz-trailer',
].join(', ');

const EXPOSE_HEADERS =
  'ETag, Content-Length, x-amz-meta-sha256, x-amz-request-id, x-amz-version-id';

const FORWARD_HEADERS = new Set([
  'content-type', 'content-md5', 'cache-control', 'content-disposition',
  'content-encoding', 'content-language', 'expires',
  'range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since',
]);

export function configFromEnv(env = process.env) {
  return {
    upstream: env.UPSTREAM,
    region: env.S3_REGION ?? 'us-east-1',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    namespace: env.BUCKET_NAMESPACE ?? '',
    allow: env.BUCKET_ALLOW ?? 'sparcd,sparcd-*',
    masterKey: env.ACCESS_MASTER_KEY,
    port: Number(env.PORT ?? 8787),
    publicEndpoint: env.PUBLIC_ENDPOINT,
    allowOrigins: env.ALLOW_ORIGINS ?? '*',
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 67108864),
  };
}

export async function createAccessProxy(config) {
  const upstream = makeUpstream({
    endpoint: config.upstream,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  const store = makeStore({
    upstream,
    namespace: config.namespace,
    allow: config.allow,
    pollMs: config.pollMs ?? 5000,
  });
  await store.reload();

  const activity = makeActivity({
    upstream: () => upstream,
    settingsBucket: () => store.settingsBucketUpstream(),
    flushMs: config.flushMs,
  });
  const masterKey = await loadMasterKey(config.masterKey);
  const lastActive = new Map();
  const api = makeApi({
    store, activity, masterKey, lastActive,
    publicEndpoint: config.publicEndpoint ?? config.upstream,
  });

  const unwrapped = new Map();
  async function lookupSecret(accessKeyId) {
    const hit = store.byAccessKey(accessKeyId);
    if (!hit) return null;
    const cached = unwrapped.get(hit.key.wrappedSecret);
    if (cached) return cached;
    const secret = await unwrapSecret(masterKey, hit.key.wrappedSecret);
    unwrapped.set(hit.key.wrappedSecret, secret);
    return secret;
  }

  const allowedOrigin = (origin) => {
    if (config.allowOrigins === '*') return origin ?? '*';
    const list = config.allowOrigins.split(',').map((s) => s.trim());
    return origin && list.includes(origin) ? origin : list[0];
  };

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) {
        respondXml(res, 500, 'InternalError', err.message, allowedOrigin(req.headers.origin));
      } else {
        res.end();
      }
    });
  });

  async function handle(req, res) {
    const origin = allowedOrigin(req.headers.origin);
    const requestId = randomUUID();

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOW_METHODS,
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
      res.end();
      return;
    }

    // The Host the caller signed. Caddy passes it through unchanged, and the
    // whole signature check rests on this value being the client's.
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(','));
      else if (value !== undefined) headers.set(name, value);
    }

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await readBody(req, config.maxBodyBytes);
      if (body === null) {
        respondXml(res, 413, 'EntityTooLarge', 'request body exceeds MAX_BODY_BYTES', origin);
        return;
      }
    }

    const isApi = url.pathname.startsWith('/-/');
    const open = isApi && (url.pathname === '/-/health' || url.pathname === '/-/join');

    let person = null;
    if (!open) {
      const verified = await verifySignature({
        method: req.method, url, headers, body, lookupSecret,
        // Presigned URLs are for object reads; an API call that changes
        // access is signed with headers and its body is bound to the
        // signature.
        allowPresigned: !isApi,
        requireSignedBody: isApi,
      });
      if (verified.error) {
        activity.record({
          requestId, personId: null, personName: null, kind: 'bad-signature',
          bucket: bucketFromPath(url.pathname), status: 403,
          ip: clientIp(req), detail: verified.error,
        });
        respondXml(res, 403, 'SignatureDoesNotMatch', verified.error, origin);
        return;
      }
      person = store.byAccessKey(verified.accessKeyId)?.person ?? null;
      if (!person) {
        respondXml(res, 403, 'AccessDenied', 'unknown access key', origin);
        return;
      }
      lastActive.set(person.id, new Date().toISOString());
      activity.signIn(verified.accessKeyId, {
        requestId, personId: person.id, personName: person.name, status: 200, ip: clientIp(req),
      });
    }

    if (isApi) {
      await handleApi({ req, res, url, body, person, requestId, origin });
      return;
    }
    await handleS3({ req, res, url, headers, body, person, requestId, origin });
  }

  async function handleApi({ req, res, url, body, person, requestId, origin }) {
    try {
      const out = await api.handle({
        method: req.method, path: url.pathname, query: url.searchParams,
        body, person, requestId,
      });
      respondJson(res, out.status, out.body, origin);
    } catch (err) {
      if (err instanceof ApiError) {
        respondJson(res, err.status, { error: { code: err.code, message: err.message } }, origin);
        return;
      }
      throw err;
    }
  }

  async function handleS3({ req, res, url, headers, body, person, requestId, origin }) {
    const clientBucket = bucketFromPath(url.pathname);
    const key = keyFromPath(url.pathname);
    const rawSegment = url.pathname.split('/')[1] ?? '';

    const denied = (reason, status = 403, code = 'AccessDenied') => {
      activity.record({
        requestId, personId: person.id, personName: person.name, kind: 'denied',
        bucket: clientBucket, key: key || undefined, status, ip: clientIp(req), detail: reason,
      });
      respondXml(res, status, code, reason, origin);
    };

    if (person.status !== 'active') return denied(`person is ${person.status}`);
    if (key === null) return denied('unreadable object key');

    // ListBuckets. Filtered to what this person may see, with the namespace
    // stripped; nothing outside the namespace is ever named.
    if (!clientBucket) {
      if (req.method !== 'GET' || url.pathname !== '/') return denied('unknown operation');
      const visible = (client) =>
        person.admin || isSettingsBucket(client) || !!store.membership(person.id, client);
      const upstreamRes = await proxyFetch(req, url, headers, body, '/');
      const xml = await upstreamRes.text();
      sendText(res, upstreamRes, filterListBuckets(xml, store.ns, visible), origin);
      return;
    }

    const upstreamBucket = store.ns.toUpstream(clientBucket);
    if (!upstreamBucket) return denied(`bucket ${clientBucket} is outside the namespace`);

    const isSettings = store.isSettings(clientBucket);
    const collection = store.collection(clientBucket);
    const membership = store.membership(person.id, clientBucket);

    const op = classify({
      method: req.method, bucket: clientBucket, key, query: url.searchParams, headers,
    });
    const verdict = decide(person, {
      op, key, isSettings, uuid: collection?.uuid, level: membership?.access ?? null,
    });
    if (!verdict.allow) return denied(verdict.reason);

    // Rebuild the path with only the bucket segment swapped, so the key bytes
    // reach the upstream exactly as the caller signed them. The equality check
    // is the traversal guard: if the URL parser normalised anything away, the
    // path we are about to sign is not the path we just authorised.
    const rest = url.pathname.slice(1 + rawSegment.length);
    const upstreamPath = `/${upstreamBucket}${rest}`;
    const upstreamRes = await proxyFetch(req, url, headers, body, upstreamPath);
    if (upstreamRes === null) return denied('request path is not canonical');

    if (upstreamRes.ok || upstreamRes.status === 206) {
      const kind = eventKind(op, { isSettings, key });
      if (kind) {
        activity.record({
          requestId, personId: person.id, personName: person.name, kind,
          bucket: clientBucket, key: key || undefined, status: upstreamRes.status,
          bytes: Number(upstreamRes.headers.get('content-length') ?? 0) || undefined,
          ip: clientIp(req),
        });
      }
    }

    // XML is the only body that can name a bucket, and it is always small.
    // Everything else — object bytes above all — streams straight through.
    const type = upstreamRes.headers.get('content-type') ?? '';
    if (type.includes('xml')) {
      let xml = rewriteBucketName(await upstreamRes.text(), upstreamBucket, clientBucket);
      if (op === 'ListObjectsV2') xml = filterListing(xml, person, { isSettings });
      sendText(res, upstreamRes, xml, origin);
      return;
    }
    streamBack(res, upstreamRes, origin);
  }

  async function proxyFetch(req, url, headers, body, upstreamPath) {
    const target = new URL(upstream.origin);
    target.pathname = upstreamPath;
    if (target.pathname !== upstreamPath) return null;
    for (const [k, v] of url.searchParams) {
      // Ceph RGW answers 501 for query params it does not recognise, and the
      // AWS SDK appends `?x-id=<Operation>` to everything. Dropped after
      // verification and before re-signing, so neither signature disagrees
      // with the query it covers.
      if (k === 'x-id' || k.startsWith('X-Amz-')) continue;
      target.searchParams.append(k, v);
    }
    const out = new Headers();
    for (const [name, value] of headers) {
      if (DROP_FROM_CLIENT.has(name)) continue;
      if (FORWARD_HEADERS.has(name) || name.startsWith('x-amz-')) out.set(name, value);
    }
    return upstream.send(target, { method: req.method, headers: out, body });
  }

  function baseHeaders(upstreamRes, origin) {
    const out = {};
    for (const [name, value] of upstreamRes.headers) {
      if (name.startsWith('access-control-')) continue;
      if (name === 'content-length' || name === 'content-encoding') continue;
      out[name] = value;
    }
    out['Access-Control-Allow-Origin'] = origin;
    out['Access-Control-Expose-Headers'] = EXPOSE_HEADERS;
    out.Vary = 'Origin';
    return out;
  }

  function sendText(res, upstreamRes, text, origin) {
    const headers = baseHeaders(upstreamRes, origin);
    headers['content-length'] = Buffer.byteLength(text);
    res.writeHead(upstreamRes.status, headers);
    res.end(text);
  }

  function streamBack(res, upstreamRes, origin) {
    const headers = baseHeaders(upstreamRes, origin);
    const length = upstreamRes.headers.get('content-length');
    if (length) headers['content-length'] = length;
    res.writeHead(upstreamRes.status, headers);
    if (!upstreamRes.body) { res.end(); return; }
    Readable.fromWeb(upstreamRes.body).pipe(res);
  }

  function respondXml(res, status, code, message, origin) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code>`
      + `<Message>${escapeXml(message)}</Message></Error>`;
    res.writeHead(status, {
      'content-type': 'application/xml',
      'content-length': Buffer.byteLength(xml),
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Expose-Headers': EXPOSE_HEADERS,
      Vary: 'Origin',
    });
    res.end(xml);
  }

  function respondJson(res, status, value, origin) {
    const json = JSON.stringify(value);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(json),
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    });
    res.end(json);
  }

  return {
    server,
    store,
    activity,
    listen(port = config.port) {
      store.start();
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      });
    },
    async close() {
      store.stop();
      await activity.drain();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Buffered before verification, because verification hashes it: the declared
// x-amz-content-sha256 is only worth anything if the bytes are checked against
// it. The same buffer then goes upstream, which is what the Caddy recipe's
// `request_buffers` achieves — a length-less body never reaches the upstream
// as Transfer-Encoding: chunked, which RGW rejects.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = configFromEnv();
  const proxy = await createAccessProxy(config);
  const port = await proxy.listen();
  process.stdout.write(`access proxy on 127.0.0.1:${port} → ${config.upstream}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { proxy.close().then(() => process.exit(0)); });
  }
}
