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
import { Readable, pipeline } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { verifySignature, peekAccessKeyId, escapeXml, DROP_FROM_CLIENT } from './sigv4.mjs';
import {
  bucketFromPath, keyFromPath, parseBucketNames, buildListBuckets, rewriteBucketName,
  leaksNamespace, scrubErrorDetail, safeKeySegments,
} from './namespace.mjs';
import {
  classify, decide, eventKind, listingGuard, buildListing,
  ACCESS_PREFIX, ACTIVITY_PREFIX,
} from './rules.mjs';
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
  'x-amz-date', 'x-amz-user-agent', 'x-amz-security-token',
  'x-amz-checksum-crc32', 'x-amz-checksum-sha256', 'x-amz-checksum-mode',
  'x-amz-sdk-checksum-algorithm', 'x-amz-meta-sha256',
].join(', ');

const EXPOSE_HEADERS =
  'ETag, Content-Length, x-amz-meta-sha256, x-amz-request-id, x-amz-version-id';

// Ordinary headers that may travel upstream — and only when the caller signed
// them. An unsigned `if-match` is an attacker's precondition on someone else's
// captured request; an unsigned `range` is a different read.
const FORWARD_HEADERS = new Set([
  'content-type', 'content-md5', 'cache-control', 'content-disposition',
  'content-encoding', 'content-language', 'expires',
  'range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since',
]);

// The `x-amz-*` allowlist. Everything else is refused rather than stripped, so
// a client that grows a new header fails visibly instead of having its meaning
// quietly removed. See CONTRACT.md for the reason each one is here.
const AMZ_FORWARD_PREFIXES = ['x-amz-meta-', 'x-amz-checksum-'];
const AMZ_FORWARD_EXACT = new Set(['x-amz-sdk-checksum-algorithm']);

// Accepted from the caller and consumed or discarded here. `x-amz-user-agent`
// is SDK telemetry the browser always sends; the rest belong to the caller's
// own signature and mean nothing to the upstream.
const AMZ_ACCEPT_AND_DROP = new Set([...DROP_FROM_CLIENT, 'x-amz-user-agent']);

const forwardableAmz = (name) =>
  AMZ_FORWARD_EXACT.has(name) || AMZ_FORWARD_PREFIXES.some((p) => name.startsWith(p));

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
    allowedHosts: env.ALLOWED_HOSTS,
    allowOrigins: env.ALLOW_ORIGINS ?? '*',
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 67108864),
    maxBufferedBytes: Number(env.MAX_BUFFERED_BYTES ?? 536870912),
  };
}

let processGuardsInstalled = false;

// A proxy that dies on one bad socket takes every other upload with it. These
// log and keep serving; the alternative is a restart per malformed peer.
function installProcessGuards(log) {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;
  process.on('unhandledRejection', (err) => log('unhandled rejection', err));
  process.on('uncaughtException', (err) => log('uncaught exception', err));
}

export async function createAccessProxy(config) {
  if (!config.publicEndpoint) {
    throw new Error('PUBLIC_ENDPOINT is required: it is what /-/join hands a new person');
  }
  const allowedHosts = new Set(
    String(config.allowedHosts ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  if (allowedHosts.size === 0) {
    throw new Error('ALLOWED_HOSTS is required: SigV4 binds a signature to the Host dialled');
  }

  const log = config.log ?? ((message, err) => {
    process.stderr.write(`[access-proxy] ${message}: ${err?.message ?? err}\n`);
  });
  installProcessGuards(log);

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
    fullReloadMs: config.fullReloadMs ?? 60000,
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
    store, activity, masterKey, lastActive, publicEndpoint: config.publicEndpoint,
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

  // The ceiling on request bodies held in memory at once, across every
  // in-flight request. Without it, N concurrent uploads of MAX_BODY_BYTES are
  // N times MAX_BODY_BYTES of heap for anyone holding one valid key.
  let bufferedBytes = 0;

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      // The detail goes to the operator, never to the caller: it can name the
      // upstream, a bucket or a key the caller was refused.
      log('request failed', err);
      if (!res.headersSent) {
        respondXml(res, 500, 'InternalError', 'the request could not be completed',
          allowedOrigin(req.headers.origin));
      } else {
        res.destroy();
      }
    });
  });
  server.on('clientError', (err, socket) => {
    log('client error', err);
    socket.destroy();
  });

  async function handle(req, res) {
    const origin = allowedOrigin(req.headers.origin);
    const requestId = randomUUID();

    // origin-form only. An absolute-form target carries its own authority, and
    // a `//host/path` target is read as one by some parsers — either way the
    // Host this process verifies against would stop being the Host the caller
    // signed.
    if (!req.url.startsWith('/') || req.url.startsWith('//')) {
      respondXml(res, 400, 'InvalidURI', 'request target must be origin-form', origin);
      return;
    }
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) {
      respondXml(res, 403, 'AccessDenied', 'unknown host', origin);
      return;
    }

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

    const url = new URL(req.url, `http://${host}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(','));
      else if (value !== undefined) headers.set(name, value);
    }

    const isApi = url.pathname.startsWith('/-/');
    const open = isApi && (url.pathname === '/-/health' || url.pathname === '/-/join');

    // Resolve the key before reading a byte of body. An unknown key costs a
    // map lookup, not a buffered upload, which is what keeps an anonymous
    // caller from spending this process's memory.
    if (!open) {
      const claimed = peekAccessKeyId({ headers, url });
      if (!claimed || !store.byAccessKey(claimed)) {
        activity.badSignature(clientIp(req), {
          requestId, bucket: bucketFromPath(url.pathname), detail: 'unknown access key',
        });
        // Discarded rather than buffered: the bytes still arrive, but they are
        // never held in memory and never hashed, which is the cost this check
        // exists to avoid. Destroying the socket instead would take the
        // response with it.
        req.resume();
        respondXml(res, 403, 'InvalidAccessKeyId', 'unknown access key', origin);
        return;
      }
    }

    let body;
    let claimedBytes = 0;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > config.maxBodyBytes) {
        respondXml(res, 413, 'EntityTooLarge', 'request body exceeds MAX_BODY_BYTES', origin);
        return;
      }
      claimedBytes = Math.max(declared, 0);
      if (bufferedBytes + claimedBytes > config.maxBufferedBytes) {
        respondXml(res, 503, 'SlowDown', 'too much request body in flight', origin);
        return;
      }
      bufferedBytes += claimedBytes;
      try {
        body = await readBody(req, Math.min(
          config.maxBodyBytes, config.maxBufferedBytes - (bufferedBytes - claimedBytes),
        ));
      } finally {
        bufferedBytes -= claimedBytes;
      }
      if (body === null) {
        respondXml(res, 413, 'EntityTooLarge', 'request body exceeds MAX_BODY_BYTES', origin);
        return;
      }
    }

    let person = null;
    let signedHeaders = new Set();
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
        activity.badSignature(clientIp(req), {
          requestId, bucket: bucketFromPath(url.pathname), detail: verified.error,
        });
        respondXml(res, 403, 'SignatureDoesNotMatch', verified.error, origin);
        return;
      }
      signedHeaders = verified.signedHeaders;
      person = store.byAccessKey(verified.accessKeyId)?.person ?? null;
      if (!person) {
        respondXml(res, 403, 'AccessDenied', 'unknown access key', origin);
        return;
      }
      if (verified.presigned && url.pathname === '/') {
        respondXml(res, 403, 'AccessDenied', 'the service root is not presignable', origin);
        return;
      }
      lastActive.set(person.id, new Date().toISOString());
      activity.signIn(verified.accessKeyId, {
        requestId, personId: person.id, personName: person.name, status: 200, ip: clientIp(req),
      });
    }

    if (isApi) {
      await handleApi({ req, res, url, headers, body, person, requestId, origin });
      return;
    }
    await handleS3({ req, res, url, headers, signedHeaders, body, person, requestId, origin });
  }

  async function handleApi({ req, res, url, headers, body, person, requestId, origin }) {
    try {
      const out = await api.handle({
        method: req.method, path: url.pathname, query: url.searchParams,
        headers, body, person, requestId,
      });
      respondJson(res, out.status, out.body, origin);
    } catch (err) {
      if (err instanceof ApiError) {
        respondJson(res, err.status, { error: { code: err.code, message: err.message } }, origin);
        return;
      }
      log('api failed', err);
      respondJson(res, 500, { error: { code: 'upstream', message: 'the request could not be completed' } }, origin);
    }
  }

  async function handleS3({
    req, res, url, headers, signedHeaders, body, person, requestId, origin,
  }) {
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
    if (key === null || !safeKeySegments(key)) return denied('unusable object key');

    // Anything the caller sent that is not on the allowlist is refused here,
    // before the request shape is even looked at: an unrecognised `x-amz-*`
    // means the proxy does not know what it would be authorising.
    for (const [name] of headers) {
      if (!name.startsWith('x-amz-')) continue;
      if (AMZ_ACCEPT_AND_DROP.has(name) || forwardableAmz(name)) continue;
      return denied(`header not accepted: ${name}`);
    }

    if (!clientBucket) return handleListBuckets({ req, res, url, person, origin, denied });

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

    if (op === 'ListObjectsV2' && isSettings) {
      return handleSettingsListing({
        res, url, upstreamBucket, clientBucket, person, origin, denied,
      });
    }

    // Rebuild the path with only the bucket segment swapped, so the key bytes
    // reach the upstream exactly as the caller signed them. The equality check
    // is the traversal guard: if the URL parser normalised anything away, the
    // path we are about to sign is not the path we just authorised.
    const rest = url.pathname.slice(1 + rawSegment.length);
    const upstreamPath = `/${upstreamBucket}${rest}`;
    const upstreamRes = await proxyFetch(req, url, headers, signedHeaders, body, upstreamPath);
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
      const xml = scrubErrorDetail(
        rewriteBucketName(await upstreamRes.text(), upstreamBucket, clientBucket),
      );
      if (leaksNamespace(xml, config.namespace)) {
        log('upstream response named a bucket outside the caller\'s namespace', new Error(clientBucket));
        return respondXml(res, 502, 'InternalError', 'the upstream answer was unusable', origin);
      }
      return sendText(res, upstreamRes, xml, origin);
    }
    return streamBack(res, upstreamRes, origin);
  }

  /**
   * The service root. Nothing of the upstream's answer is passed through: the
   * names are parsed out, mapped, filtered to what this person may see, and a
   * fresh document is built around them.
   */
  async function handleListBuckets({ req, res, url, person, origin, denied }) {
    if (req.method !== 'GET' || url.pathname !== '/') return denied('unknown operation');
    for (const name of url.searchParams.keys()) {
      // `x-id` is SDK telemetry and the presign parameters cannot be here at
      // all. Anything else at the root names an operation this proxy has no
      // rule for — `?usage`, `?format=json`, a vendor extension.
      if (name !== 'x-id') return denied(`the service root takes no parameters: ${name}`);
    }

    let names;
    try {
      const upstreamRes = await upstream.send(new URL('/', upstream.origin));
      names = upstreamRes.ok ? parseBucketNames(await upstreamRes.text()) : null;
    } catch (err) {
      log('ListBuckets failed', err);
      names = null;
    }
    if (names === null) {
      return respondXml(res, 502, 'InternalError', 'the upstream answer was unusable', origin);
    }

    const visible = names
      .map((n) => store.ns.toClient(n))
      .filter((client) => client !== null
        && (person.admin || isSettingsBucket(client) || !!store.membership(person.id, client)));
    const xml = buildListBuckets(visible);
    res.writeHead(200, {
      'content-type': 'application/xml',
      'content-length': Buffer.byteLength(xml),
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Expose-Headers': EXPOSE_HEADERS,
      Vary: 'Origin',
    });
    return res.end(xml);
  }

  /**
   * Listings of the settings bucket are paginated here rather than by the
   * caller. Handing back a filtered page with the upstream's continuation
   * token would let a caller count what was removed, and a prefix that reaches
   * only into a protected tree is refused outright rather than answered with
   * an empty page.
   */
  async function handleSettingsListing({
    res, url, upstreamBucket, clientBucket, person, origin, denied,
  }) {
    const prefix = url.searchParams.get('prefix') ?? '';
    const guardResult = listingGuard({ prefix, person, isSettings: true });
    if (!guardResult.allow) return denied(guardResult.reason);

    // `encoding-type`, `marker` and `start-after` describe a pagination this
    // proxy is not doing, so they are dropped rather than honoured against a
    // page the caller will not receive.
    const delimiter = url.searchParams.get('delimiter') ?? '';
    const keys = [];
    const commonPrefixes = [];
    let token;
    for (let page = 0; page < 50; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const got = await upstream.listPage(upstreamBucket, { prefix, delimiter, token });
      keys.push(...got.keys);
      commonPrefixes.push(...got.commonPrefixes);
      token = got.nextToken;
      if (!token) break;
    }

    const hidden = (k) =>
      k.startsWith(ACCESS_PREFIX) || (!person.admin && k.startsWith(ACTIVITY_PREFIX));
    const xml = buildListing({
      bucket: clientBucket,
      prefix,
      delimiter,
      keys: keys.filter((k) => !hidden(k.key)),
      commonPrefixes: commonPrefixes.filter((p) => !hidden(p)),
    });
    res.writeHead(200, {
      'content-type': 'application/xml',
      'content-length': Buffer.byteLength(xml),
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Expose-Headers': EXPOSE_HEADERS,
      Vary: 'Origin',
    });
    return res.end(xml);
  }

  async function proxyFetch(req, url, headers, signedHeaders, body, upstreamPath) {
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
      if (AMZ_ACCEPT_AND_DROP.has(name)) continue;
      // A header the caller did not sign is a header someone else added to a
      // captured request, so it does not travel even when it is on the list.
      if (!signedHeaders.has(name)) continue;
      if (FORWARD_HEADERS.has(name) || forwardableAmz(name)) out.set(name, value);
    }
    return upstream.send(target, { method: req.method, headers: out, body });
  }

  function baseHeaders(upstreamRes, origin) {
    const out = {};
    for (const [name, value] of upstreamRes.headers) {
      if (name.startsWith('access-control-')) continue;
      if (name === 'content-length' || name === 'content-encoding') continue;
      // A redirect the proxy did not follow must not become one the browser
      // follows to the upstream, credential-free and off the namespace.
      if (name === 'location') continue;
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
    // pipeline, not pipe: an upstream that resets mid-object has to tear down
    // the client socket too, and an unhandled 'error' on either end would
    // otherwise reach the process.
    pipeline(Readable.fromWeb(upstreamRes.body), res, (err) => {
      if (!err) return;
      log('response stream failed', err);
      res.destroy();
    });
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
