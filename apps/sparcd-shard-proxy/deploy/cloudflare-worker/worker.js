// A shard proxy with no server: one Worker, N custom-domain hostnames, one S3
// upstream. Browsers key connections on host+port, so shard1..shardN each get
// their own connection and their own congestion window — the same trick the
// Caddy recipe plays with ports.
//
// The important difference from Caddy: a Worker cannot preserve the client's
// Host header on a cross-zone subrequest. Cloudflare rewrites it to the
// upstream's hostname. SigV4 signs Host, so the browser's signature is invalid
// by the time the request lands — passthrough is not available here.
//
// So this Worker verifies, then re-signs. It holds two credential pairs:
//
//   CLIENT_ACCESS_KEY_ID / CLIENT_SECRET_ACCESS_KEY   what browsers sign with
//   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY           what reaches the upstream
//
// Every request must arrive carrying a valid SigV4 signature over the client
// pair, or it is rejected with 403 before the upstream credential is touched.
// Without that check the Worker is an open proxy for its own S3 credential:
// CORS restrains browsers, and nothing else. Callers are unchanged from the
// Caddy recipe — a browser S3 client signs the way it always does, just with
// the proxy-issued key pair and the shard hostname.
//
// Vars (wrangler.toml):              UPSTREAM, S3_REGION
// Secrets (wrangler secret put ...): all four key/secret values above

import { AwsClient } from 'aws4fetch';
import { DROP_FROM_CLIENT, escapeXml, verifySignature } from '../../access/sigv4.mjs';

const ALLOW_METHODS = 'GET, HEAD, PUT, POST, DELETE';

// Mirrors the Caddyfile's list. Anything a browser S3 client may set must be
// named here or the preflight fails before a byte moves.
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

// Only these reach the upstream, plus whatever `x-amz-*` the client set (user
// metadata, ACLs, storage class — all of it carries meaning and all of it has
// to be signed). Everything else the browser and the platform attach —
// `origin`, `accept-*`, `sec-fetch-*`, `cf-connecting-ip`, `user-agent` — is
// dropped rather than forwarded. Forwarding them means signing them, and any
// one the platform rewrites between signing and sending invalidates the
// signature at the far end.
const FORWARD_HEADERS = new Set([
  'content-type', 'content-md5', 'cache-control', 'content-disposition',
  'content-encoding', 'content-language', 'expires',
  'range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since',
]);

function upstreamHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (DROP_FROM_CLIENT.has(name)) continue;
    if (FORWARD_HEADERS.has(name) || name.startsWith('x-amz-')) headers.set(name, value);
  }
  return headers;
}

/**
 * The shared verifier, narrowed to this Worker's single client key. Presigned
 * query-string requests are not part of this recipe, so they are not opted in.
 */
function verifyClientSignature(request, url, body, env) {
  return verifySignature({
    method: request.method,
    url,
    headers: request.headers,
    body,
    lookupSecret: (id) =>
      (id === env.CLIENT_ACCESS_KEY_ID ? env.CLIENT_SECRET_ACCESS_KEY : null),
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Expose-Headers': EXPOSE_HEADERS,
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    // Preflights carry no Authorization by definition — the browser sends them
    // to find out whether it may send one — so they are answered before the
    // signature check.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin ?? '*',
          'Access-Control-Allow-Methods': ALLOW_METHODS,
          'Access-Control-Allow-Headers': ALLOW_HEADERS,
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        },
      });
    }

    // Buffered before verification, because verification hashes it: the
    // declared x-amz-content-sha256 is only worth anything if the bytes are
    // checked against it. The same buffer then goes upstream, which is also
    // what the Caddy recipe's `request_buffers` achieves — a length-less body
    // never reaches the upstream as Transfer-Encoding: chunked, which RGW
    // rejects. Camera-trap objects are a few MB, and a Worker's body limit
    // (100 MB free, 500 MB paid) is the real ceiling either way.
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();

    const inbound = new URL(request.url);
    const { error: rejection } = await verifyClientSignature(request, inbound, body, env);
    if (rejection) {
      // S3-shaped so a browser S3 client surfaces it as an S3 error rather than
      // an opaque network failure. CORS headers included, or the browser shows
      // the caller nothing at all.
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code>` +
          `<Message>${escapeXml(rejection)}</Message></Error>`,
        { status: 403, headers: { ...corsHeaders(origin), 'Content-Type': 'application/xml' } },
      );
    }

    const upstream = new URL(env.UPSTREAM);
    const url = new URL(request.url);
    url.protocol = upstream.protocol;
    url.hostname = upstream.hostname;
    url.port = upstream.port;

    // Ceph RGW answers 501 NotImplemented for query params it does not
    // recognise, and the AWS SDK appends `?x-id=<Operation>` to everything.
    // Strip it after verification and before re-signing, so neither signature
    // disagrees with the query it covers.
    url.searchParams.delete('x-id');

    const aws = new AwsClient({
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      service: 's3',
      region: env.S3_REGION ?? 'us-east-1',
    });

    const upstreamResponse = await aws.fetch(url, {
      method: request.method,
      headers: upstreamHeaders(request),
      body,
    });

    // The Worker owns CORS the way Caddy does, so any CORS headers the
    // upstream set per bucket are dropped rather than doubled up.
    const out = new Headers(upstreamResponse.headers);
    for (const name of [...out.keys()]) {
      if (name.toLowerCase().startsWith('access-control-')) out.delete(name);
    }
    for (const [name, value] of Object.entries(corsHeaders(origin))) {
      if (name === 'Vary') out.append(name, value);
      else out.set(name, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: out,
    });
  },
};
