import type { S3Config } from '@sparcd/types';

const OWNER_SCOPE_PREFIX = 'flip-owner-v1:';
const OWNER_SCOPE_RE = /^flip-owner-v1:[0-9a-f]{64}$/;

export type FlipOwnerConnection = Pick<S3Config, 'endpoint' | 'region' | 'accessKey' | 'secure'> & { providerId?: string };

/**
 * Canonical endpoint identity for the Flip owner hash. Configured endpoints
 * use URL parsing so spelling differences such as host case and default ports
 * resolve to the same scope. The implicit branch is exposed for S3 providers
 * that use the SDK's default endpoint rather than a configured URL.
 */
export function canonicalFlipEndpoint(input: {
  endpoint?: string | null;
  secure?: boolean;
  providerId?: string;
  region: string;
}): string {
  const endpoint = input.endpoint?.trim() ?? '';
  if (!endpoint) {
    const providerId = input.providerId?.trim();
    if (!providerId) throw new Error('An implicit S3 endpoint requires a provider ID.');
    return JSON.stringify(['implicit-s3-v1', providerId.toLowerCase(), input.region.toLowerCase()]);
  }

  const scheme = input.secure === false ? 'http' : 'https';
  const url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `${scheme}://${endpoint}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Flip owner scope requires an HTTP or HTTPS endpoint.');
  }
  const pathPrefix = url.pathname.replace(/\/+$/, '');
  return JSON.stringify([
    'url-v1',
    url.protocol.slice(0, -1).toLowerCase(),
    url.hostname.toLowerCase(),
    url.port,
    pathPrefix === '/' ? '' : pathPrefix,
  ]);
}

/** Derive the non-secret, versioned owner key shared by Uploader and Tagger. */
export async function deriveFlipOwnerScope(connection: FlipOwnerConnection): Promise<string> {
  if (!connection.accessKey) throw new Error('A connected Access key is required for Flip ownership.');
  const canonicalEndpoint = canonicalFlipEndpoint(connection);
  const bytes = new TextEncoder().encode(`${canonicalEndpoint}\0${connection.accessKey}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${OWNER_SCOPE_PREFIX}${hex}`;
}

export function isValidFlipOwnerScope(value: unknown): value is string {
  return typeof value === 'string' && OWNER_SCOPE_RE.test(value);
}
