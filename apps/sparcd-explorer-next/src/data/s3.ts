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
 * Cache identity for one account on one server. Another endpoint or access
 * key gets a different identity, so it never sees this one's cached data.
 */
export function accountKey(cfg: Pick<S3Config, 'endpoint' | 'accessKey'>): string {
  const endpoint = cfg.endpoint.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `${endpoint}|${cfg.accessKey.trim()}`;
}

export function isMissingObjectError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound';
}

export const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
