// Minimal TS types that span more than one package. No runtime deps.

/**
 * Connection config consumed by `@sparcd/s3-safe` and produced by
 * `@sparcd/auth-ui`. Same shape across MinIO / AWS S3 / Cloudflare R2.
 */
export type S3Config = {
  endpoint: string; // host[:port] or https://host
  region: string; // "us-east-1" | "auto" | etc.
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean; // true for MinIO; false for AWS/R2
  secure?: boolean; // used when `endpoint` carries no scheme
};

/**
 * Outcome of a read-only connectivity/credential check against a submitted
 * `S3Config`, before it's accepted. Lives here (not `@sparcd/s3-safe`) so
 * `@sparcd/auth-ui` can type its `onTestConnection` prop without depending on
 * the AWS SDK — the actual probe is implemented in `@sparcd/s3-safe`.
 *
 * `category` is deliberately not "invalid credentials" vs. "valid" alone:
 * S3 rejects a bad access key or signature at the authentication layer
 * (`credentials-rejected`) before any permission check runs, but an
 * `AccessDenied` on this read-only probe (`probe-denied`) only means the
 * check itself was refused — it cannot prove the credentials are wrong, only
 * that the account lacks permission for this operation specifically.
 */
export type ConnectionProbeResult =
  | { ok: true }
  | {
      ok: false;
      category:
        | 'unreachable' // no HTTP response at all — DNS/CORS/mixed-content/connection-refused
        | 'credentials-rejected' // InvalidAccessKeyId / SignatureDoesNotMatch
        | 'probe-denied' // AccessDenied or another authorization rejection
        | 'clock-skew' // RequestTimeTooSkewed
        | 'interrupted' // aborted / timed out
        | 'unexpected'; // anything else
      // A safe-to-display status/code for the 'unexpected' category. Never
      // the secret key or raw SDK error details.
      detail?: string;
    };

export type Collection = {
  bucket: string;
  uuid: string;
  name: string;
  organization: string;
};

export type Species = {
  genus: string;
  species: string;
  commonName: string;
  scientificName: string;
};

/** Identity used to stamp immutable writes. */
export type UserSession = {
  userId: string;
  displayName: string;
};

export type BackendDefaults = {
  region: string;
  forcePathStyle: boolean;
  secure: boolean;
};

/**
 * Infer `region`, `forcePathStyle`, and `secure` from an endpoint that is
 * either a bare host[:port] or a full URL. Pure string logic — lives here
 * so both `@sparcd/auth-ui` (no SDK) and `@sparcd/s3-safe` can use it.
 *
 * - `*.r2.cloudflarestorage.com` → region "auto", path-style off
 * - `*.amazonaws.com`           → region from URL (fallback us-east-1), path-style off
 * - anything else (MinIO)       → region "us-east-1", path-style on
 */
export function detectBackendDefaults(endpoint: string): BackendDefaults {
  const hasScheme = /^https?:\/\//i.test(endpoint);
  const secure = hasScheme ? endpoint.toLowerCase().startsWith('https://') : true;
  const host = endpoint
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();

  if (host.endsWith('.r2.cloudflarestorage.com')) {
    return { region: 'auto', forcePathStyle: false, secure };
  }
  if (host.endsWith('.amazonaws.com')) {
    const m = host.match(/s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    return { region: m?.[1] ?? 'us-east-1', forcePathStyle: false, secure };
  }
  return { region: 'us-east-1', forcePathStyle: true, secure };
}
