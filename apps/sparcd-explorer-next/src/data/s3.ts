// The explorer's one contact point with `@sparcd/s3-safe`. Every read goes
// through a client with a read scope and no write grant: the explorer never
// writes to storage.

import { SafeS3Client } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';

/** The read calls the data layer makes. `SafeS3Client` has them; tests pass an in-memory fake. */
export type ReadClient = Pick<SafeS3Client, 'listBuckets' | 'statObject' | 'getObject' | 'listFolder'>;

// Not a security boundary in a static app: the connected key's IAM policy and
// the bucket CORS gate access. The wrapper only requires an explicit scope.
export function readClient(cfg: S3Config): SafeS3Client {
  return new SafeS3Client(cfg, ['*']);
}

/**
 * Cache identity for one account on one server: scheme, host, port and access
 * key. Another server, scheme, port or key gets a different identity, so it
 * never sees this one's cached data. An endpoint without a scheme uses
 * `secure` (HTTPS unless it is false), as the client does.
 */
export function accountKey(cfg: Pick<S3Config, 'endpoint' | 'accessKey' | 'secure'>): string {
  const text = cfg.endpoint.trim().toLowerCase();
  const scheme = /^(https?):\/\//.exec(text)?.[1] ?? (cfg.secure === false ? 'http' : 'https');
  const authority = text.replace(/^https?:\/\//, '').split('/')[0];
  const [, host, port] = /^(.*?)(?::(\d+))?$/.exec(authority)!;
  return `${scheme}://${host}:${port ?? (scheme === 'https' ? '443' : '80')}|${cfg.accessKey.trim()}`;
}

export function isMissingObjectError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound';
}

export const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
