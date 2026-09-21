// Where this run is allowed to write, decided before anything starts.
//
// Locally the run owns its storage: it brings up its own MinIO on loopback and
// may create and drop buckets freely. Pointed at storage it does not own, it
// has to be provably unable to touch anything that was already there — so the
// namespace must be non-empty, must not be the one real SPARC'd buckets carry,
// bucket creation must be off, and cleanup may only remove objects this run
// wrote. Anything less and the run refuses to start.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export const DEFAULT_NAMESPACE = 'e2e-';

export function isLoopback(endpoint) {
  let host;
  try {
    host = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `http://${endpoint}`).hostname;
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTS.has(host)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

const flag = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
};

export class TargetRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'TargetRefused';
  }
}

/**
 * @param env  process.env, or a plain object in a test.
 * @returns `{ mode, upstream, startMinio, namespace, createBuckets, deleteOwnObjectsOnly, accessKeyId, secretAccessKey }`
 * @throws  {TargetRefused} when a non-loopback upstream is not provably contained.
 */
export function planTarget(env = {}) {
  const upstream = (env.E2E_UPSTREAM ?? '').trim();
  const namespace = env.E2E_NAMESPACE === undefined ? DEFAULT_NAMESPACE : env.E2E_NAMESPACE;
  const accessKeyId = env.E2E_S3_ACCESS_KEY_ID ?? 'admine2ekey';
  const secretAccessKey = env.E2E_S3_SECRET_ACCESS_KEY ?? 'admine2esecret';
  const keep = flag(env.E2E_KEEP, false);

  if (upstream === '' || isLoopback(upstream)) {
    return {
      mode: 'local',
      upstream: upstream || null,
      startMinio: upstream === '',
      namespace,
      createBuckets: flag(env.E2E_CREATE_BUCKETS, true),
      deleteOwnObjectsOnly: false,
      accessKeyId,
      secretAccessKey,
      keep,
    };
  }

  if (!namespace) {
    throw new TargetRefused(
      `E2E_UPSTREAM ${upstream} is not loopback, so E2E_NAMESPACE must be set to a prefix this run owns.`,
    );
  }
  if (namespace.startsWith('sparcd')) {
    throw new TargetRefused(
      `E2E_NAMESPACE "${namespace}" is the prefix real SPARC'd buckets carry. Pick one that is not.`,
    );
  }
  if (flag(env.E2E_CREATE_BUCKETS, false)) {
    throw new TargetRefused(
      `E2E_CREATE_BUCKETS must be off against ${upstream}: this run does not own its buckets.`,
    );
  }

  return {
    mode: 'remote',
    upstream,
    startMinio: false,
    namespace,
    createBuckets: false,
    deleteOwnObjectsOnly: true,
    accessKeyId,
    secretAccessKey,
    keep,
  };
}
