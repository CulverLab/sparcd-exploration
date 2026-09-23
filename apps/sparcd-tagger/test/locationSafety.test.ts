import { describe, expect, it } from 'vitest';
import { isNotFound } from '../src/lib/s3';
import { shouldGroundUpload } from '../src/lib/queries';

describe('optional deployments.csv errors', () => {
  it('accepts only a raw S3 not-found response as absence', () => {
    expect(isNotFound({ name: 'NoSuchKey' })).toBe(true);
    expect(isNotFound({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isNotFound({ $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isNotFound(new TypeError('network failed'))).toBe(false);
  });
});

describe('pending-location conflict grounding', () => {
  it('does not re-ground a session with only a pending location correction', () => {
    expect(shouldGroundUpload({ mediaETag: 'etag', pendingLocation: { deploymentId: 'uuid:SAN22' } }, false, false)).toBe(false);
  });

  it('grounds a clean session and an ungrounded session', () => {
    expect(shouldGroundUpload({ mediaETag: 'etag', pendingLocation: null }, false, false)).toBe(true);
    expect(shouldGroundUpload(undefined, true, true)).toBe(true);
  });
});
