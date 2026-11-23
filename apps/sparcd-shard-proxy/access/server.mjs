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
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Readable, pipeline } from 'node:stream';

import { verifySignature, peekAccessKeyId, escapeXml, DROP_FROM_CLIENT } from './sigv4.mjs';
import {
  bucketFromPath, keyFromPath, parseBucketNames, buildListBuckets, rewriteBucketName,
  leaksNamespace, scrubErrorDetail, safeKeySegments, safeRequestTarget,
} from './namespace.mjs';
import {
  classify, decide, eventKind, listingGuard, buildListing, afterTree, decodeListingToken,
  ACCESS_PREFIX, ACTIVITY_PREFIX,
} from './rules.mjs';
import { makeStore, isSettingsBucket } from './store.mjs';
import { makeActivity } from './activity.mjs';
import { makeApi, ApiError } from './api.mjs';
import { makeUpstream, normalizeIfMatch } from './upstream.mjs';
import { loadMasterKey, unwrapSecret } from './keys.mjs';
import {
  coordinateObjectKind,
  completeDeploymentsCoordinates,
  isCoordinateFreeDeployments,
  redactCoordinateBody,
  sameUploadCompletePublicFields,
  shouldRedactCoordinates,
} from './redact.mjs';

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
// captured request. `range` on a GET is the one exception, in proxyFetch.
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

// What may come back. An allowlist because the upstream decides what it sends:
// `Server`, `x-amz-id-2` and a per-bucket CORS block all name or hint at the
// storage behind this. `content-encoding` is absent on purpose — the response
// body is decoded here, so echoing it would describe bytes the caller is not
// getting.
const RESPONSE_HEADERS = new Set([
  'content-type', 'etag', 'last-modified', 'content-range', 'accept-ranges',
  'cache-control', 'content-disposition',
  // Both are opaque identifiers minted per request or per version; neither is
  // derived from the bucket name on any upstream this fronts.
  'x-amz-request-id', 'x-amz-version-id',
]);
const RESPONSE_PREFIXES = ['x-amz-meta-', 'x-amz-checksum-'];

const forwardableAmz = (name) =>
  AMZ_FORWARD_EXACT.has(name) || AMZ_FORWARD_PREFIXES.some((p) => name.startsWith(p));

function decodeXmlText(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, token) => {
    if (token[0] === '#') {
      const hex = token[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[token.toLowerCase()] ?? entity;
  });
}

function encodeXmlText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// With `encoding-type=url` the upstream percent-encodes each key, slashes
// included, so the key is decoded before the check. One that will not decode
// is redacted.
function listedKey(text, urlEncoded) {
  if (!urlEncoded) return text;
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return null;
  }
}

export function redactListingEntries(xml, shouldRedact, opaqueEtag) {
  const urlEncoded = /<EncodingType>url<\/EncodingType>/.test(xml);
  return xml.replace(/<Contents>([\s\S]*?)<\/Contents>/g, (block) => {
    const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(block);
    if (!keyMatch) return block;
    const key = listedKey(decodeXmlText(keyMatch[1]), urlEncoded);
    if (key !== null && !shouldRedact(key)) return block;
    const etagMatch = /<ETag>([\s\S]*?)<\/ETag>/.exec(block);
    const etag = etagMatch ? decodeXmlText(etagMatch[1]) : '';
    const safeEtag = '<ETag>' + encodeXmlText(opaqueEtag(etag)) + '</ETag>';
    const safeSize = '<Size>0</Size>';
    let out = etagMatch
      ? block.replace(etagMatch[0], safeEtag)
      : block.replace('</Contents>', safeEtag + '</Contents>');
    const sizeMatch = /<Size>[\s\S]*?<\/Size>/.exec(out);
    out = sizeMatch
      ? out.replace(sizeMatch[0], safeSize)
      : out.replace('</Contents>', safeSize + '</Contents>');
    return out;
  });
}

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
    bodyIdleMs: Number(env.BODY_IDLE_MS ?? 10000),
  };
}

/**
 * Process-wide policy, installed by the entry point rather than by
 * `createAccessProxy` — a library that adopts the process's exception handling
 * takes that decision away from whatever embeds it, tests included.
 *
 * A rejection in one request is logged and the process keeps serving; an
 * uncaught exception means the process no longer knows what state it is in, so
 * it logs and exits for a supervisor to restart. A failed `listen` cannot hide
 * behind either, because the entry point awaits it and exits itself.
 */
export function installProcessGuards(log) {
  process.on('unhandledRejection', (err) => log('unhandled rejection', err));
  process.on('uncaughtException', (err) => {
    log('uncaught exception', err);
    process.exit(1);
  });
}

export async function createAccessProxy(input) {
  // Defaults live here rather than only in configFromEnv, so a config built by
  // hand gets the same ones. `bodyIdleMs` undefined reaches setTimeout as 1 ms,
  // which times out every upload that takes longer than a tick.
  const config = {
    region: 'us-east-1',
    namespace: '',
    allow: 'sparcd,sparcd-*',
    port: 8787,
    allowOrigins: '*',
    maxBodyBytes: 67108864,
    maxBufferedBytes: 536870912,
    bodyIdleMs: 10000,
    pollMs: 5000,
    fullReloadMs: 60000,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
  };
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
    pollMs: config.pollMs,
    fullReloadMs: config.fullReloadMs,
  });
  await store.reload();

  const activity = makeActivity({
    upstream: () => upstream,
    settingsBucket: () => store.settingsBucketUpstream(),
    flushMs: config.flushMs,
  });
  const masterKey = await loadMasterKey(config.masterKey);
  // Raw upstream ETags and metadata digests can be guessed offline from a
  // redacted body. Give restricted callers a stable, keyed validator instead.
  const coordinateMacKey = Buffer.from(config.masterKey, 'base64');
  const opaqueValue = (purpose, value) => createHmac('sha256', coordinateMacKey)
    .update(`sparcd-coordinate-v1:${purpose}\0`)
    .update(String(value ?? ''))
    .digest('hex');
  const opaqueEtag = (etag) => `"spcd-${opaqueValue('etag', etag)}"`;

  function parseLocationRegistry(text) {
    const value = JSON.parse(text);
    const entries = Array.isArray(value) ? value : value && Array.isArray(value.locations) ? value.locations : null;
    if (!entries) throw new Error('location registry is not an array');
    return entries;
  }

  async function exactLocationRegistry(collectionBucket, uuid) {
    const assigned = await upstream.get(collectionBucket, `Collections/${uuid}/locations.json`);
    if (assigned.status !== 404) {
      if (assigned.text.trim() !== '') {
        const entries = parseLocationRegistry(assigned.text);
        if (entries.length > 0) return entries;
      }
    }
    const settingsBucket = store.settingsBucketUpstream();
    const fallback = await upstream.get(settingsBucket, 'Settings/locations.json');
    if (fallback.status === 404) throw new Error('location registry is missing');
    return parseLocationRegistry(fallback.text);
  }

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
  // in-flight request. Charged as bytes arrive rather than reserved against a
  // declared Content-Length: a declaration costs the sender nothing, so
  // reserving against one lets a handful of silent sockets hold the whole
  // budget. Each key gets at most a quarter, so one caller cannot take it all
  // even by delivering.
  const budget = makeBudget(config.maxBufferedBytes);
  const perKeyCap = Math.max(1, Math.floor(config.maxBufferedBytes / 4));

  // Settings listings walk the upstream several pages deep, so a handful of
  // them at once is several times the work of an ordinary request.
  let settingsListings = 0;

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

    // origin-form only, judged on the raw bytes. An absolute-form target
    // carries its own authority; `//host/path` and `/\\host/path` are both read
    // as one by the WHATWG parser. Any of the three and the Host this process
    // verifies the signature against stops being the Host the caller signed.
    if (!safeRequestTarget(req.url)) {
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
    // Belt to the braces above: whatever the parser made of the target, the
    // authority it landed on has to be the one already validated.
    if (url.host !== host) {
      respondXml(res, 400, 'InvalidURI', 'request target must be origin-form', origin);
      return;
    }
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
    // Resolve the key and the person before reading a byte. An unknown or
    // suspended key costs a map lookup, not a buffered upload — which is what
    // keeps a caller who merely knows a key id from spending this process's
    // memory.
    let claimed = null;
    if (!open) {
      // Fail closed while a change to who may do what is known and unloaded.
      if (store.behind()) {
        req.resume();
        respondXml(res, 403, 'AccessDenied', 'access data could not be refreshed', origin);
        return;
      }
      claimed = peekAccessKeyId({ headers, url });
      const hit = claimed ? store.byAccessKey(claimed) : null;
      if (!hit) {
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
      if (hit.person?.status !== 'active') {
        req.resume();
        respondXml(res, 403, 'AccessDenied', `person is ${hit.person?.status}`, origin);
        return;
      }
    }

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > config.maxBodyBytes) {
        req.resume();
        respondXml(res, 413, 'EntityTooLarge', 'request body exceeds MAX_BODY_BYTES', origin);
        return;
      }
      // Held until the response is finished, not until the body is read: the
      // Buffer is alive through hashing and the upstream write.
      const account = budget.open(claimed ?? 'anonymous', perKeyCap);
      res.on('close', () => account.release());

      const read = await readBody(req, config.maxBodyBytes, account, config.bodyIdleMs);
      // The refusal has to reach the caller, so the connection is closed after
      // the response rather than the request socket being torn down under it.
      // The rest of the body is discarded unread, never buffered.
      if (read.error === 'too-large') {
        return refuseBody(req, res, 413, 'EntityTooLarge',
          'request body exceeds MAX_BODY_BYTES', origin);
      }
      if (read.error === 'busy') {
        return refuseBody(req, res, 503, 'SlowDown', 'too much request body in flight', origin);
      }
      if (read.error === 'idle') {
        return refuseBody(req, res, 408, 'RequestTimeout', 'the request body stalled', origin);
      }
      if (read.error) return undefined;
      body = read.body;
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
      // Checked again: the body can take long enough to arrive that access
      // data fell behind after the check above.
      if (store.behind()) {
        respondXml(res, 403, 'AccessDenied', 'access data could not be refreshed', origin);
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
    const redactCoordinates = shouldRedactCoordinates({ person, isSettings, membership, key });
    const coordinateKind = coordinateObjectKind(key);

    const op = classify({
      method: req.method, bucket: clientBucket, key, query: url.searchParams, headers,
    });
    // A repeated `prefix` is one the upstream may read differently from here,
    // so it counts as no prefix at all.
    const prefixes = url.searchParams.getAll('prefix');
    const verdict = decide(person, {
      op, key, isSettings, uuid: collection?.uuid, access: membership?.access ?? null,
      prefix: prefixes.length === 1 ? prefixes[0] : '',
    });
    if (!verdict.allow) return denied(verdict.reason);

    // A byte range cannot be safely redacted without reconstructing the full
    // object first. Refuse it rather than forwarding a coordinate fragment.
    if (redactCoordinates && headers.has('range')) {
      return denied('coordinate-protected objects do not support byte ranges', 416, 'InvalidRange');
    }
    let forwardedHeaders = headers;
    let forwardedSignedHeaders = signedHeaders;
    let forwardedBody = body;
    const canonicalDeploymentWrite = /^Collections\/([^/]+)\/Uploads\/[^/]+\/deployments\.csv$/.exec(key);
    const coordinateFreeDeploymentWrite = req.method === 'PUT'
      && coordinateKind === 'deployments'
      && canonicalDeploymentWrite?.[1] === collection?.uuid
      && body
      && isCoordinateFreeDeployments(body.toString('utf8'));
    if ((redactCoordinates && coordinateKind) || coordinateFreeDeploymentWrite) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        // These compare against upstream validators, which encode the private
        // bytes. Always fetch and return the proxy's redacted representation.
        forwardedHeaders = new Headers(headers);
        for (const name of ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']) {
          forwardedHeaders.delete(name);
        }
      } else if (req.method === 'PUT' && coordinateKind === 'deployments') {
        const uploadDeployment = /^Collections\/([^/]+)\/Uploads\/[^/]+\/deployments\.csv$/.exec(key);
        const snapshotDeployment = /^Collections\/([^/]+)\/Uploads\/[^/]+\/\.sparcd-(?:tagger|uploader)-snapshots\/[^/]+\/[^/]+\/deployments\.csv$/.exec(key);
        const guardIsCreate = headers.get('if-none-match') === '*'
          && signedHeaders.has('if-none-match') && !headers.has('if-match');
        const guardIsReplace = !!headers.get('if-match')
          && signedHeaders.has('if-match') && !headers.has('if-none-match');
        const isCanonicalDeployment = uploadDeployment?.[1] === collection?.uuid;
        const isSnapshotDeployment = snapshotDeployment?.[1] === collection?.uuid;
        if ((!isCanonicalDeployment && !isSnapshotDeployment)
          || !body || !isCoordinateFreeDeployments(body.toString('utf8'))
          || (!guardIsCreate && !guardIsReplace)) {
          return denied('exact coordinate permission is required for this deployment write');
        }

        if (isCanonicalDeployment) {
          try {
            const registry = await exactLocationRegistry(upstreamBucket, collection.uuid);
            forwardedBody = Buffer.from(
              completeDeploymentsCoordinates(body.toString('utf8'), registry), 'utf8',
            );
          } catch (err) {
            log('could not resolve a restricted deployment write against the location registry', err);
            return denied('deployment location must match exactly one current registry entry');
          }
        }

        forwardedHeaders = new Headers(headers);
        forwardedSignedHeaders = new Set(signedHeaders);
        if (guardIsReplace) {
          let current;
          try {
            current = await upstream.head(upstreamBucket, key);
          } catch (err) {
            log('could not check the current deployment version', err);
            return denied('the current deployment version could not be checked', 502, 'InternalError');
          }
          const currentEtag = current.etag;
          if (current.status !== 200 || !currentEtag) {
            return denied('the current deployment version could not be checked', 502, 'InternalError');
          }
          if (normalizeIfMatch(headers.get('if-match')) !== normalizeIfMatch(opaqueEtag(currentEtag))) {
            return denied('the deployment changed since it was read', 412, 'PreconditionFailed');
          }
          // The client only knows the opaque ETag. Compare it locally, then
          // let S3 enforce the corresponding raw validator against races.
          forwardedHeaders.set('if-match', currentEtag);
        }
        // The proxy changed the body, so stale client checksums must not be
        // written as if they described the exact stored bytes.
        for (const name of ['x-amz-checksum-crc32', 'x-amz-checksum-sha256', 'x-amz-sdk-checksum-algorithm']) {
          forwardedHeaders.delete(name);
          forwardedSignedHeaders.delete(name);
        }
        if (forwardedHeaders.has('x-amz-meta-sha256')
          && forwardedSignedHeaders.has('x-amz-meta-sha256')) {
          forwardedHeaders.set(
            'x-amz-meta-sha256',
            createHash('sha256').update(forwardedBody).digest('hex'),
          );
        }
      } else if (req.method === 'PUT' && coordinateKind === 'upload-complete') {
        // UploadComplete carries a digest of the exact metadata bytes but no
        // coordinate fields itself. Keep normal create/replace semantics while
        // its response validator is still opaque to this caller.
        forwardedHeaders = new Headers(headers);
        forwardedSignedHeaders = new Set(signedHeaders);
        const rawMatch = headers.get('if-match');
        const rawNoneMatch = headers.get('if-none-match');
        if (rawNoneMatch && (rawNoneMatch !== '*' || !signedHeaders.has('if-none-match') || rawMatch)) {
          return denied('the upload completion precondition is invalid');
        }
        if (!rawMatch && !rawNoneMatch) {
          return denied('the upload completion precondition is required');
        }
        if (rawMatch) {
          if (!signedHeaders.has('if-match') || headers.has('if-none-match')) {
            return denied('the upload completion precondition is invalid');
          }
          let current;
          try {
            current = await upstream.head(upstreamBucket, key);
          } catch (err) {
            log('could not check the current upload completion version', err);
            return denied('the upload completion version could not be checked', 502, 'InternalError');
          }
          const currentEtag = current.etag;
          if (current.status !== 200 || !currentEtag) {
            return denied('the upload completion version could not be checked', 502, 'InternalError');
          }
          if (normalizeIfMatch(rawMatch) !== normalizeIfMatch(opaqueEtag(currentEtag))) {
            return denied('the upload completion changed since it was read', 412, 'PreconditionFailed');
          }
          forwardedHeaders.set('if-match', currentEtag);
        }
      } else {
        return denied('exact coordinate permission is required to change this object');
      }
    }

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
    let upstreamRes = await proxyFetch(
      req, url, forwardedHeaders, forwardedSignedHeaders, forwardedBody, upstreamPath,
    );
    if (upstreamRes === null) return denied('request path is not canonical');

    // An immutable publication can succeed upstream while its response is
    // lost. On retry, the create-only PUT receives 412; treat it as success
    // when the public completion fields match. Do not use the hidden metadata
    // digest in this decision: otherwise 200 versus 412 becomes a digest oracle.
    if (redactCoordinates && coordinateKind === 'upload-complete'
      && req.method === 'PUT' && headers.get('if-none-match') === '*'
      && signedHeaders.has('if-none-match') && upstreamRes.status === 412 && forwardedBody) {
      try {
        const existing = await upstream.get(upstreamBucket, key);
        if (existing.status === 200 && existing.etag
          && sameUploadCompletePublicFields(
            existing.text,
            Buffer.from(forwardedBody).toString('utf8'),
          )) {
          await upstreamRes.body?.cancel().catch(() => {});
          upstreamRes = new Response(null, { status: 200, headers: { etag: existing.etag } });
        }
      } catch (err) {
        log('could not verify an existing upload completion retry', err);
      }
    }

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

    if (op === 'ListObjectsV2' && !isSettings && upstreamRes.ok) {
      const xml = await upstreamRes.text();
      const rewritten = rewriteBucketName(xml, upstreamBucket, clientBucket);
      const safe = redactListingEntries(
        rewritten,
        (entryKey) => shouldRedactCoordinates({
          person, isSettings, membership, key: entryKey,
        }),
        opaqueEtag,
      );
      return sendText(res, upstreamRes, safe, origin);
    }

    // Coordinate protection is selected by object key, before content type.
    // A mislabeled protected object must not escape through the generic XML
    // response path below.
    if (redactCoordinates && req.method === 'GET' && upstreamRes.ok) {
      try {
        const redacted = redactCoordinateBody(
          key,
          await upstreamRes.text(),
          (value) => opaqueValue('metadata-bundle', value),
        );
        return sendText(res, upstreamRes, redacted, origin, {
          opaqueEtag: true, opaqueMetadataHash: true, dropContentRange: true,
          dropChecksums: true,
        });
      } catch (err) {
        log('coordinate redaction failed', err);
        return respondXml(res, 502, 'InternalError', 'the upstream answer was unusable', origin);
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
      return sendText(res, upstreamRes, xml, origin, {
        opaqueEtag: redactCoordinates && !!coordinateKind,
        opaqueMetadataHash: redactCoordinates && !!coordinateKind,
        dropContentLength: req.method === 'HEAD' && redactCoordinates && !!coordinateKind,
        dropChecksums: redactCoordinates && !!coordinateKind,
      });
    }
    return streamBack(res, upstreamRes, origin, {
      opaqueEtag: redactCoordinates && !!coordinateKind,
      opaqueMetadataHash: redactCoordinates && !!coordinateKind,
      dropContentLength: req.method === 'HEAD' && redactCoordinates && !!coordinateKind,
      dropContentRange: req.method === 'GET' && redactCoordinates && !!coordinateKind,
      dropChecksums: redactCoordinates && !!coordinateKind,
    });
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
      'cache-control': 'no-store',
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

    if (settingsListings >= 4) {
      return respondXml(res, 503, 'SlowDown', 'too many listings in flight', origin);
    }
    settingsListings += 1;
    try {
      // `encoding-type`, `marker` and `start-after` describe a pagination this
      // proxy is not doing, so they are dropped rather than honoured against a
      // page the caller will not receive. `continuation-token` is honoured, but
      // it is the proxy's own token, not the upstream's.
      const delimiter = url.searchParams.get('delimiter') ?? '';
      const requested = Number(url.searchParams.get('max-keys') ?? 1000);
      const maxKeys = Math.min(Math.max(Number.isFinite(requested) ? requested : 1000, 1), 1000);
      const after = decodeListingToken(url.searchParams.get('continuation-token'));

      const hidden = (k) =>
        k.startsWith(ACCESS_PREFIX) || (!person.admin && k.startsWith(ACTIVITY_PREFIX));
      const hiddenTrees = [ACCESS_PREFIX, ...(person.admin ? [] : [ACTIVITY_PREFIX])];

      const page = await listAroundProtectedTrees({
        upstream,
        bucket: upstreamBucket, prefix, delimiter, maxKeys, after, hidden, hiddenTrees,
      });

      const safeKeys = page.keys.map((entry) =>
        shouldRedactCoordinates({ person, isSettings: true, membership: null, key: entry.key })
          ? { ...entry, etag: opaqueEtag(entry.etag), size: 0 }
          : entry);
      const xml = buildListing({
        bucket: clientBucket,
        prefix,
        delimiter,
        keys: safeKeys,
        commonPrefixes: page.commonPrefixes,
        truncated: page.truncated,
        nextToken: page.nextToken,
      });
      res.writeHead(200, {
        'content-type': 'application/xml',
        'content-length': Buffer.byteLength(xml),
        'cache-control': 'no-store',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': EXPOSE_HEADERS,
        Vary: 'Origin',
      });
      return res.end(xml);
    } catch (err) {
      log('settings listing failed', err);
      return respondXml(res, 502, 'InternalError', 'the upstream answer was unusable', origin);
    } finally {
      settingsListings -= 1;
    }
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
      // `range` on a GET only narrows a read the signature already allows, and
      // a presigned URL signs nothing but `host`, so a video seeking through
      // one always sends it unsigned.
      if (!signedHeaders.has(name) && !(name === 'range' && req.method === 'GET')) continue;
      if (!(FORWARD_HEADERS.has(name) || forwardableAmz(name))) continue;
      // The caller's signature was verified against the value they sent; the
      // quotes come off only here, after that check and before re-signing.
      out.set(name, name === 'if-match' ? normalizeIfMatch(value) : value);
    }
    return upstream.send(target, { method: req.method, headers: out, body });
  }

  function baseHeaders(upstreamRes, origin) {
    const out = {};
    for (const [name, value] of upstreamRes.headers) {
      const allowed = RESPONSE_HEADERS.has(name)
        || RESPONSE_PREFIXES.some((prefix) => name.startsWith(prefix));
      if (!allowed) continue;
      out[name] = value;
    }
    // Every answer here is one person's, decided from their key. Nothing may
    // keep a copy: a shared cache would hand it to the next caller, and a
    // browser left to guess a freshness lifetime from `Last-Modified` serves
    // its own user a version of a list someone else has since changed — which
    // is exactly the case the conditional writes downstream exist to catch.
    // It overrides any `cache-control` the upstream sent, which is why it is
    // set after the forward loop rather than inside it.
    out['cache-control'] = 'no-store';
    out['Access-Control-Allow-Origin'] = origin;
    out['Access-Control-Expose-Headers'] = EXPOSE_HEADERS;
    out.Vary = 'Origin';
    return out;
  }

  function sendText(res, upstreamRes, text, origin, {
    opaqueEtag: hideEtag = false,
    opaqueMetadataHash: hideMetadataHash = false,
    dropContentLength = false,
    dropContentRange = false,
    dropChecksums = false,
  } = {}) {
    const headers = baseHeaders(upstreamRes, origin);
    if (dropContentLength) delete headers['content-length'];
    else headers['content-length'] = Buffer.byteLength(text);
    if (hideEtag && upstreamRes.headers.get('etag')) {
      headers.etag = opaqueEtag(upstreamRes.headers.get('etag'));
    }
    if (hideMetadataHash && headers['x-amz-meta-sha256']) {
      headers['x-amz-meta-sha256'] = opaqueValue('object-sha256', headers['x-amz-meta-sha256']);
    }
    if (dropContentRange) delete headers['content-range'];
    if (dropChecksums) {
      for (const name of Object.keys(headers)) {
        if (name.startsWith('x-amz-checksum-')) delete headers[name];
      }
    }
    res.writeHead(upstreamRes.status, headers);
    res.end(text);
  }

  function streamBack(res, upstreamRes, origin, {
    opaqueEtag: hideEtag = false,
    opaqueMetadataHash: hideMetadataHash = false,
    dropContentLength = false,
    dropContentRange = false,
    dropChecksums = false,
  } = {}) {
    const headers = baseHeaders(upstreamRes, origin);
    if (hideEtag && upstreamRes.headers.get('etag')) {
      headers.etag = opaqueEtag(upstreamRes.headers.get('etag'));
    }
    if (hideMetadataHash && headers['x-amz-meta-sha256']) {
      headers['x-amz-meta-sha256'] = opaqueValue('object-sha256', headers['x-amz-meta-sha256']);
    }
    if (dropContentLength) delete headers['content-length'];
    if (dropContentRange) delete headers['content-range'];
    if (dropChecksums) {
      for (const name of Object.keys(headers)) {
        if (name.startsWith('x-amz-checksum-')) delete headers[name];
      }
    }
    const length = upstreamRes.headers.get('content-length');
    if (length && !dropContentLength) headers['content-length'] = length;
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

  function refuseBody(req, res, status, code, message, origin) {
    res.setHeader('Connection', 'close');
    respondXml(res, status, code, message, origin);
    res.on('finish', () => req.destroy());
    return undefined;
  }

  function respondXml(res, status, code, message, origin) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code>`
      + `<Message>${escapeXml(message)}</Message></Error>`;
    res.writeHead(status, {
      'content-type': 'application/xml',
      'content-length': Buffer.byteLength(xml),
      'cache-control': 'no-store',
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
      'cache-control': 'no-store',
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
      return new Promise((resolve, reject) => {
        // A port already taken has to be an error the caller sees. Without
        // this the promise never settles and the process sits there, listening
        // to nothing and looking healthy.
        const onError = (err) => { store.stop(); reject(err); };
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve(server.address().port);
        });
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
function readBody(req, limit, account, idleMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let timer = null;

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // A socket that announces a body and then goes quiet costs nothing to
    // open and, without this, holds a slot until Node's 300 s request timeout.
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => done({ error: 'idle' }), idleMs);
    };
    arm();

    req.on('data', (chunk) => {
      arm();
      size += chunk.length;
      if (size > limit) { done({ error: 'too-large' }); return; }
      // Charged per chunk, so a body with no declared length is accounted for
      // exactly like one that announced itself.
      if (!account.charge(chunk.length)) { done({ error: 'busy' }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => done({ body: Buffer.concat(chunks) }));
    req.on('aborted', () => done({ error: 'aborted' }));
    req.on('error', () => done({ error: 'aborted' }));
  });
}

/**
 * Bytes actually held, globally and per access key. `release` is idempotent
 * because it is wired to the response's `close`, which fires once but can
 * race with the read finishing.
 */
function makeBudget(total) {
  let used = 0;
  const perKey = new Map();
  return {
    open(keyId, cap) {
      let charged = 0;
      return {
        charge(n) {
          const mine = perKey.get(keyId) ?? 0;
          if (used + n > total || mine + n > cap) return false;
          used += n;
          perKey.set(keyId, mine + n);
          charged += n;
          return true;
        },
        release() {
          if (charged === 0) return;
          used -= charged;
          const mine = (perKey.get(keyId) ?? 0) - charged;
          if (mine > 0) perKey.set(keyId, mine); else perKey.delete(keyId);
          charged = 0;
        },
      };
    },
  };
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = configFromEnv();
  const fail = (message, err) => {
    process.stderr.write(`[access-proxy] ${message}: ${err?.message ?? err}\n`);
  };
  installProcessGuards(fail);
  try {
    const proxy = await createAccessProxy(config);
    const port = await proxy.listen();
    process.stdout.write(`access proxy on 127.0.0.1:${port} → ${config.upstream}\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => { proxy.close().then(() => process.exit(0)); });
    }
  } catch (err) {
    fail('could not start', err);
    process.exit(1);
  }
}

/**
 * One page of a settings listing, stepping over the protected trees rather
 * than reading through them. Paging through `Settings/activity/` means the
 * real settings files fall off the end as soon as the log grows, so when a
 * listing walks into a tree the caller may not see, the cursor jumps past
 * the whole tree in one move.
 */
export async function listAroundProtectedTrees({
  upstream, bucket, prefix, delimiter, maxKeys, after, hidden, hiddenTrees,
}) {
  const keys = [];
  const commonPrefixes = [];
  let cursor = after ?? undefined;
  let truncated = false;
  // Where the caller got to. A folder is resumed past rather than into,
  // because its own keys sort after its name.
  let resumeAt = null;
  const entries = () => keys.length + commonPrefixes.length;

  for (let page = 0; page < 20; page += 1) {
    const got = await upstream.listPage(bucket, {
      prefix, delimiter, startAfter: cursor, maxKeys: 1000,
    });

    // With a delimiter, folders and keys are two halves of one page and both
    // are entries as far as `max-keys` goes. Counting only the keys hands
    // back a page of folders and calls it an empty listing. Both are taken in
    // the order the upstream sorts them: every folder first and then a resume
    // past the last one skips the keys that sorted between them. The upstream
    // sorts UTF-8 bytes, which JS string comparison does not: it compares
    // UTF-16 code units, and puts U+10000 and above before U+E000–U+FFFF.
    const items = [
      ...got.commonPrefixes.map((name) => ({ name })),
      ...got.keys.map((entry) => ({ name: entry.key, entry })),
    ].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));

    let jumpedTo = null;
    for (const { name, entry } of items) {
      if (!entry) {
        if (hidden(name)) { cursor = afterTree(name); continue; }
        if (entries() >= maxKeys) { truncated = true; break; }
        commonPrefixes.push(name);
        resumeAt = afterTree(name);
        cursor = resumeAt;
        continue;
      }
      const tree = hiddenTrees.find((t) => name.startsWith(t));
      if (tree) { jumpedTo = afterTree(tree); break; }
      if (entries() >= maxKeys) { truncated = true; break; }
      keys.push(entry);
      cursor = name;
      resumeAt = name;
    }
    if (truncated) break;
    if (jumpedTo) {
      cursor = jumpedTo;
      if (page === 19 && got.nextToken) {
        truncated = true;
        resumeAt = resumeAt ?? cursor ?? after ?? '';
        break;
      }
      continue;
    }
    if (!got.nextToken || items.length === 0) break;
    // `cursor` was advanced while consuming the merged key/prefix sequence.
    // Replacing it with the last key from the unmerged S3 response can move
    // backwards when a common prefix sorted after that key, repeating folders.
    if (page === 19 && got.nextToken) {
      truncated = true;
      resumeAt = resumeAt ?? cursor ?? after ?? '';
    }
  }

  return { keys, commonPrefixes, truncated, nextToken: truncated && resumeAt ? resumeAt : null };
}
