import { describe, expect, it, vi } from 'vitest';
import { shouldRetryCanonicalRead, withCanonicalReadRetry } from '../src/lib/s3';

function failure(name: string, status: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

describe('canonical S3 read retry policy', () => {
  it('retries an unnamed 403 and returns after a later successful attempt', async () => {
    let calls = 0;
    const wait = vi.fn(async () => {});
    await expect(
      withCanonicalReadRetry(
        async () => {
          calls++;
          if (calls === 1) throw failure('UnknownError', 403);
          return 'canonical';
        },
        { wait },
      ),
    ).resolves.toBe('canonical');
    expect(calls).toBe(2);
    expect(wait).toHaveBeenCalledWith(100);
  });

  it('does not retry a confirmed permission denial or signature failure', () => {
    expect(shouldRetryCanonicalRead(failure('AccessDenied', 403))).toBe(false);
    expect(shouldRetryCanonicalRead(failure('InvalidAccessKeyId', 403))).toBe(false);
    expect(shouldRetryCanonicalRead(failure('SignatureDoesNotMatch', 403))).toBe(false);
    expect(shouldRetryCanonicalRead(failure('AbortError', 0))).toBe(false);
  });

  it('retries clock skew, server, and status-less failures', () => {
    expect(shouldRetryCanonicalRead(failure('RequestTimeTooSkewed', 403))).toBe(true);
    expect(shouldRetryCanonicalRead(failure('ServiceUnavailable', 503))).toBe(true);
    expect(shouldRetryCanonicalRead(new Error('network unavailable'))).toBe(true);
  });

  it('retains the final failure after the bounded attempts are exhausted', async () => {
    const final = failure('UnknownError', 403);
    let calls = 0;
    await expect(
      withCanonicalReadRetry(
        async () => {
          calls++;
          throw final;
        },
        { attempts: 3, wait: async () => {} },
      ),
    ).rejects.toBe(final);
    expect(calls).toBe(3);
  });
});
