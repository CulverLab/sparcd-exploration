// Shared scaffolding for the integration run: a loopback MinIO, a seeded
// namespace, the proxy on an ephemeral port, and signing helpers.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest, createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { S3Client } from '@aws-sdk/client-s3';

import { sha256hex, hmac, toHex, canonicalQueryString } from '../sigv4.mjs';
import { createAccessProxy } from '../server.mjs';
import { init } from '../cli.mjs';
import { makeUpstream } from '../upstream.mjs';

const run = promisify(execFile);
const COMPOSE = fileURLToPath(new URL('./compose.test.yaml', import.meta.url));
const PROJECT = 'sparcd-access-test';

export const ROOT = { accessKeyId: 'accesstestkey', secretAccessKey: 'accesstestsecret' };
export const NAMESPACE = 't-';
export const MASTER_KEY = Buffer.alloc(32, 42).toString('base64');

export const UUID_A = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
export const UUID_B = '1c0ffee0-dead-4bee-8fee-0123456789ab';
export const BUCKET_A = `sparcd-${UUID_A}`;
export const BUCKET_B = `sparcd-${UUID_B}`;
export const SETTINGS = 'sparcd-settings-test';
export const CANARY = 'canary-outside';
export const CANARY_KEY = 'secret.txt';
export const CANARY_BODY = 'the-canary-must-never-be-read';

const compose = (...args) =>
  run('docker', ['compose', '-f', COMPOSE, '-p', PROJECT, ...args], { timeout: 180000 });

export async function startMinio() {
  await compose('down', '-v').catch(() => {});
  await compose('up', '-d');
  const { stdout } = await compose('port', 'minio', '9000');
  const endpoint = `http://${stdout.trim().replace(/^0\.0\.0\.0/, '127.0.0.1')}`;
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const res = await fetch(`${endpoint}/minio/health/ready`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('MinIO did not become ready');
    await new Promise((r) => setTimeout(r, 500));
  }
  return endpoint;
}

export const stopMinio = () => compose('down', '-v');

/** Seed the upstream: three buckets inside the namespace, one canary outside. */
export async function seed(endpoint) {
  const root = makeUpstream({ endpoint, ...ROOT });
  const makeBucket = async (name) => {
    const u = new URL(endpoint);
    u.pathname = `/${name}`;
    const res = await root.send(u, { method: 'PUT' });
    if (!res.ok && res.status !== 409) throw new Error(`mb ${name} → ${res.status}`);
  };
  for (const name of [
    `${NAMESPACE}${SETTINGS}`, `${NAMESPACE}${BUCKET_A}`, `${NAMESPACE}${BUCKET_B}`, CANARY,
  ]) await makeBucket(name);

  await root.put(CANARY, CANARY_KEY, CANARY_BODY, { contentType: 'text/plain' });
  await root.put(`${NAMESPACE}${SETTINGS}`, 'Settings/locations.json', '{"locations":[]}');
  for (const [bucket, uuid, name] of [
    [BUCKET_A, UUID_A, 'Educational Test'], [BUCKET_B, UUID_B, 'Second Collection'],
  ]) {
    const b = `${NAMESPACE}${bucket}`;
    await root.put(b, `Collections/${uuid}/collection.json`,
      JSON.stringify({ name, organization: 'CulverLab' }));
    await root.put(b, `Collections/${uuid}/Uploads/2026.01.01.00.00.00_seed/media.csv`,
      'mediaID,filePath\n', { contentType: 'text/csv' });
    await root.put(b, `Collections/${uuid}/Uploads/2026.01.01.00.00.00_seed/a.jpg`,
      `image-bytes-${uuid}`, { contentType: 'image/jpeg' });
  }
  return root;
}

/** A port nobody is on, reserved before ALLOWED_HOSTS has to name it. */
export function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function startProxy(endpoint, overrides = {}, { bootstrap = true } = {}) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const config = {
    upstream: endpoint,
    region: 'us-east-1',
    accessKeyId: ROOT.accessKeyId,
    secretAccessKey: ROOT.secretAccessKey,
    namespace: NAMESPACE,
    allow: 'sparcd,sparcd-*',
    masterKey: MASTER_KEY,
    publicEndpoint: origin,
    allowedHosts: `127.0.0.1:${port}`,
    allowOrigins: '*',
    maxBodyBytes: 67108864,
    // Long enough that a deliberately stale cache stays stale for the
    // If-Match test; the 5 s default is exercised by its own case.
    pollMs: 60000,
    flushMs: 50,
    ...overrides,
  };
  const admin = bootstrap
    ? await init({ name: 'Root Admin', email: 'admin@example.org', config })
    : null;
  const proxy = await createAccessProxy(config);
  await proxy.listen(port);
  return { proxy, origin, config, admin: admin && { ...admin, endpoint: origin } };
}

/** A signing client for one person, for raw S3 and `/-/` calls alike. */
export function caller(origin, { accessKey, secretKey }) {
  const aws = new AwsClient({
    accessKeyId: accessKey, secretAccessKey: secretKey, service: 's3', region: 'us-east-1',
  });
  return {
    accessKey,
    secretKey,
    /** The contract wants API bodies bound to the signature, so hash them. */
    async api(method, path, body, headers = {}) {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const res = await aws.fetch(`${origin}${path}`, {
        method,
        body: method === 'GET' ? undefined : payload,
        headers: {
          'content-type': 'application/json',
          'x-amz-content-sha256': await sha256hex(payload),
          ...headers,
        },
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    /**
     * @param unsigned        declare UNSIGNED-PAYLOAD, the shape a browser
     *                        Blob body produces.
     * @param unsignedHeaders set after signing, so they are on the wire but
     *                        not in SignedHeaders.
     */
    async raw(method, path, { body, headers = {}, unsignedHeaders, unsigned = false } = {}) {
      const extra = { ...headers };
      const streaming = body && typeof body.getReader === 'function';
      // A stream cannot be hashed up front, which is exactly why a browser
      // declares UNSIGNED-PAYLOAD for one.
      if (!unsigned && !streaming && body !== undefined && !('x-amz-content-sha256' in extra)) {
        extra['x-amz-content-sha256'] = await sha256hex(body);
      }
      const init = { method, body, headers: extra };
      // A stream body needs the half-duplex opt-in before it can be a Request.
      if (streaming) init.duplex = 'half';
      const req = await aws.sign(`${origin}${path}`, init);
      for (const [k, v] of Object.entries(unsignedHeaders ?? {})) req.headers.set(k, v);
      const res = await fetch(req);
      return { status: res.status, text: await res.text(), headers: res.headers };
    },
    s3() {
      return new S3Client({
        endpoint: origin,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        // The flexible-checksum default wraps bodies in aws-chunked framing
        // with a streaming payload hash, which this proxy rejects by design.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    },
    presign: (path, expires) => presignUrl(aws, origin, path, expires),
  };
}

async function presignUrl(aws, origin, path, expires) {
  const u = new URL(`${origin}${path}`);
  u.searchParams.set('X-Amz-Expires', String(expires));
  const req = await aws.sign(u.toString(), { method: 'GET', aws: { signQuery: true } });
  return req.url;
}

/**
 * Sign and send a path exactly as written — no URL parsing, so `../` and
 * `%2F` reach the socket intact. The whole point of the crafted-name cases.
 */
export async function rawSignedRequest({ origin, key, secret, method = 'GET', path }) {
  // Bodies are always empty here: these cases are about the request line, and
  // an empty payload keeps the signature to one hash.
  const { port } = new URL(origin);
  const host = `127.0.0.1:${port}`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = await sha256hex('');
  const [pathname, search = ''] = path.split('?');
  const canonicalRequest = [
    method,
    pathname,
    canonicalQueryString(new URL(`http://${host}?${search}`)),
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const scope = [date, 'us-east-1', 's3', 'aws4_request'];
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope.join('/'), await sha256hex(canonicalRequest)].join('\n');
  let signingKey = new TextEncoder().encode(`AWS4${secret}`);
  for (const part of scope) signingKey = await hmac(signingKey, part);
  const signature = toHex(await hmac(signingKey, stringToSign));

  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, method, path,
      headers: {
        host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope.join('/')}, `
          + 'SignedHeaders=host;x-amz-content-sha256;x-amz-date, '
          + `Signature=${signature}`,
      },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * A request whose target line and Host are written literally — absolute-form,
 * a foreign Host, whatever. `fetch` rewrites both, so it cannot ask these
 * questions.
 */
export function rawTarget(port, path, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, method: 'GET', path, headers: { host },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * A PUT that announces a body and then sends nothing. The point of the
 * exercise: a declared Content-Length is a claim, and a proxy that reserves
 * budget against claims can be starved by sockets that never deliver.
 */
export function stalledPut(port, path, declared, accessKey) {
  return new Promise((resolve) => {
    const req = httpRequest({
      host: '127.0.0.1', port, method: 'PUT', path,
      headers: {
        host: `127.0.0.1:${port}`,
        'content-length': String(declared),
        'x-amz-date': '20260101T000000Z',
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        // A real key id, so the request gets past the cheap lookup and into
        // the body-reading path this is about. The signature is nonsense, but
        // it is not checked until the body has arrived — which it never does.
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/20260101/`
          + 'us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, '
          + 'Signature=00',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', () => resolve({ status: 0 }));
    // Deliberately never written and never ended.
    req.flushHeaders();
    setTimeout(() => { req.destroy(); resolve({ status: 0 }); }, 5000).unref?.();
  });
}

/** A body with no Content-Length, so the proxy is told nothing up front. */
export function chunked(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** Start `access/server.mjs` as its own process and wait for it to give up. */
export function spawnServer(env) {
  const entry = fileURLToPath(new URL('../server.mjs', import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => { stdout += c; });
    const kill = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('exit', (code, signal) => {
      clearTimeout(kill);
      resolve({ code: code ?? `signal:${signal}`, stderr, stdout });
    });
  });
}

export const newUuid = () => randomUUID();
