// Everything the browser run talks to, started and stopped as one thing:
// storage, the seeded buckets, the first administrator, and the access proxy —
// unless `E2E_PROXY_URL` names a proxy someone else deployed, in which case the
// run seeds storage and signs in with the administrator it was handed.
// The built admin app is served separately by Playwright's `webServer`, so the
// pages under test are the ones a deploy would actually ship.
//
// Nothing here reads a `.env`. Configuration is environment variables with
// local defaults, and `planTarget` decides before a byte moves whether the
// upstream is one this run may write to at all.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';

import { createAccessProxy } from '../../sparcd-shard-proxy/access/server.mjs';
import { init } from '../../sparcd-shard-proxy/access/cli.mjs';
import { makeUpstream } from '../../sparcd-shard-proxy/access/upstream.mjs';

import { planTarget } from './target.mjs';
import { startLatencyForwarder } from './latency.mjs';
import {
  CANARY_BUCKET, CANARY_BODY, CANARY_KEY, COLLECTIONS, SETTINGS_BUCKET,
  namespacedBuckets, seedPlan,
} from './seed.mjs';

const run = promisify(execFile);
const COMPOSE = fileURLToPath(new URL('./compose.e2e.yaml', import.meta.url));
const PROJECT = 'sparcd-admin-e2e';

export const DESCRIPTOR = fileURLToPath(new URL('./.stack.json', import.meta.url));

// 32 bytes, fixed so a run is reproducible. It wraps nothing that outlives the
// run: every key it protects is issued and discarded inside one suite.
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

const ADMIN = { name: 'Jorge Delgado', email: 'jorge@example.org' };

// The proxy keeps every person and key it knows under here. An external proxy
// owns those records, so cleanup leaves the prefix alone — emptying the buckets
// is the operator's way to reset them.
const ACCESS_PREFIX = 'Settings/access/';

const compose = (...args) =>
  run('docker', ['compose', '-f', COMPOSE, '-p', PROJECT, ...args], { timeout: 180000 });

async function startMinio() {
  await compose('down', '-v').catch(() => {});
  await compose('up', '-d');
  const { stdout } = await compose('port', 'minio', '9000');
  const endpoint = `http://${stdout.trim().replace(/^0\.0\.0\.0/, '127.0.0.1')}`;
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      if ((await fetch(`${endpoint}/minio/health/ready`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('MinIO did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return endpoint;
}

async function makeBucket(root, name) {
  const url = new URL(root.origin);
  url.pathname = `/${name}`;
  const res = await root.send(url, { method: 'PUT' });
  if (!res.ok && res.status !== 409) throw new Error(`create bucket ${name} → ${res.status}`);
}

async function deleteObject(root, bucket, key) {
  const res = await root.send(root.url(bucket, key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`delete ${bucket}/${key} → ${res.status}`);
}

export async function startStack(env = process.env) {
  const plan = planTarget(env);
  const port = Number(env.E2E_PROXY_PORT ?? 8797);

  const upstream = plan.startMinio ? await startMinio() : plan.upstream;
  const root = makeUpstream({
    endpoint: upstream,
    accessKeyId: plan.accessKeyId,
    secretAccessKey: plan.secretAccessKey,
  });

  if (plan.createBuckets) {
    for (const bucket of namespacedBuckets(plan.namespace)) await makeBucket(root, bucket);
    await makeBucket(root, CANARY_BUCKET);
    await root.put(CANARY_BUCKET, CANARY_KEY, CANARY_BODY, { contentType: 'text/plain' });
  }

  const written = seedPlan(plan.namespace);
  for (const object of written) {
    await root.put(object.bucket, object.key, object.body, { contentType: object.contentType });
  }

  // Seeding keeps the direct endpoint; only what the app does through the
  // proxy is slowed down, which is the traffic a person waits on.
  const latencyMs = Number(env.E2E_LATENCY_MS ?? 0);
  const slow = latencyMs > 0 && plan.startProxy ? await startLatencyForwarder(upstream, latencyMs) : null;

  const origin = plan.startProxy ? `http://127.0.0.1:${port}` : plan.proxyUrl;
  const config = {
    upstream: slow ? slow.origin : upstream,
    region: env.S3_REGION ?? 'us-east-1',
    accessKeyId: plan.accessKeyId,
    secretAccessKey: plan.secretAccessKey,
    namespace: plan.namespace,
    allow: 'sparcd,sparcd-*',
    masterKey: MASTER_KEY,
    publicEndpoint: origin,
    // Both required since contract 1.1. A signature is bound to the Host the
    // caller dialled, so the proxy will only answer on the ones named here.
    allowedHosts: `127.0.0.1:${port},localhost:${port}`,
    allowOrigins: '*',
    maxBodyBytes: 67108864,
    // The pause/resume scenario waits on this: a change made through the API
    // takes effect at once here, and the contract promises 5 s elsewhere.
    pollMs: 5000,
    flushMs: 250,
  };

  // An external proxy is already running with its own configuration and its own
  // first administrator; the harness only hands the suite the login it was given.
  let admin;
  let proxy = null;
  if (plan.startProxy) {
    admin = await init({ ...ADMIN, config });
    proxy = await createAccessProxy(config);
    await proxy.listen(port);
  } else {
    admin = { ...ADMIN, ...plan.admin };
  }

  const descriptor = {
    mode: plan.mode,
    proxyMode: plan.proxy,
    upstream,
    namespace: plan.namespace,
    proxy: origin,
    admin: { ...admin, endpoint: origin },
    settingsBucket: SETTINGS_BUCKET,
    collections: COLLECTIONS.map(({ bucket, uuid, stamp, document }) => ({
      bucket, uuid, stamp, name: document.nameProperty,
    })),
    canary: { bucket: CANARY_BUCKET, key: CANARY_KEY, seeded: plan.createBuckets },
  };
  await writeFile(DESCRIPTOR, `${JSON.stringify(descriptor, null, 2)}\n`);

  return {
    ...descriptor,
    async stop() {
      if (proxy) await proxy.close();
      if (slow) await slow.stop();
      await rm(DESCRIPTOR, { force: true });
      if (plan.keep) return;
      if (plan.startMinio) {
        await compose('down', '-v');
        return;
      }
      // Storage this run does not own: undo what it wrote, and nothing else.
      // Buckets stay, and so does every key outside the prefixes below — the
      // only places the seed, the proxy and the suite ever put anything.
      const settings = `${plan.namespace}${SETTINGS_BUCKET}`;
      const sweep = [
        ...['Settings/', 'Collections/'].map((prefix) => [settings, prefix]),
        ...COLLECTIONS.map((c) => [`${plan.namespace}${c.bucket}`, `Collections/${c.uuid}/`]),
      ];
      for (const [bucket, prefix] of sweep) {
        for (const key of await root.listKeys(bucket, prefix)) {
          // Records an external proxy owns, including the administrator this
          // run signed in as. Only the run that created them may remove them.
          if (!plan.startProxy && key.startsWith(ACCESS_PREFIX)) continue;
          await deleteObject(root, bucket, key);
        }
      }
      for (const object of written) await deleteObject(root, object.bucket, object.key);
    },
  };
}
