import type { PersistedConnection } from '@sparcd/auth-ui';
import type { S3Config } from '@sparcd/types';

/**
 * What the sign-in form starts with: the remembered connection, or a dev-only
 * endpoint from `.env` when one is set. A dev endpoint is another server, so
 * only the remembered access key carries over, never its HTTPS, region or
 * path-style settings. The secret is never prefilled from either source.
 */
export function connectionPrefill(
  devEndpoint: string | undefined,
  remembered: PersistedConnection | null,
): Partial<S3Config> {
  if (!devEndpoint) return remembered ? { ...remembered } : {};
  return remembered?.accessKey ? { endpoint: devEndpoint, accessKey: remembered.accessKey } : { endpoint: devEndpoint };
}
