import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { testConnection } from '../src/index';

// Swaps only the transport, same technique as replace-if-unchanged.test.ts's
// stubClient — but testConnection builds its own internal SafeS3Client with
// no way to reach in afterward, so the swap has to happen one level up, on
// the S3Client the AWS SDK module exports.
const sendMock = vi.fn();
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: class {
      middlewareStack = { add: () => {} };
      send = sendMock;
    },
  };
});

const CFG: S3Config = {
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  accessKey: 'AK',
  secretKey: 'SK',
  forcePathStyle: true,
};

function sdkError(name: string, status?: number): Error {
  return Object.assign(new Error(name), {
    name,
    $metadata: status ? { httpStatusCode: status } : undefined,
  });
}

beforeEach(() => {
  sendMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('testConnection (#589)', () => {
  it('resolves ok on a successful ListBuckets', async () => {
    sendMock.mockResolvedValue({ Buckets: [] });
    await expect(testConnection(CFG)).resolves.toEqual({ ok: true });
  });

  it('reports credentials-rejected for a bad access key', async () => {
    sendMock.mockRejectedValue(sdkError('InvalidAccessKeyId', 403));
    await expect(testConnection(CFG)).resolves.toEqual({ ok: false, category: 'credentials-rejected' });
  });

  it('reports credentials-rejected for a bad secret key', async () => {
    sendMock.mockRejectedValue(sdkError('SignatureDoesNotMatch', 403));
    await expect(testConnection(CFG)).resolves.toEqual({ ok: false, category: 'credentials-rejected' });
  });

  it('reports clock-skew distinctly from a bare AccessDenied', async () => {
    sendMock.mockRejectedValue(sdkError('RequestTimeTooSkewed', 403));
    await expect(testConnection(CFG)).resolves.toEqual({ ok: false, category: 'clock-skew' });
  });

  it('reports probe-denied for AccessDenied — never credentials-rejected', async () => {
    sendMock.mockRejectedValue(sdkError('AccessDenied', 403));
    await expect(testConnection(CFG)).resolves.toEqual({ ok: false, category: 'probe-denied' });
  });

  it('reports unreachable when the error carries no HTTP status (DNS/CORS/mixed-content)', async () => {
    sendMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(testConnection(CFG)).resolves.toEqual({ ok: false, category: 'unreachable' });
  });

  it('reports unexpected with a safe code for anything else', async () => {
    sendMock.mockRejectedValue(sdkError('InternalError', 500));
    await expect(testConnection(CFG)).resolves.toEqual({
      ok: false,
      category: 'unexpected',
      detail: 'InternalError',
    });
  });

  it('reports interrupted once the probe times out', async () => {
    vi.useFakeTimers();
    sendMock.mockImplementation(
      (_cmd: unknown, opts: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.abortSignal.addEventListener('abort', () =>
            reject(Object.assign(new Error('AbortError'), { name: 'AbortError' })),
          );
        }),
    );
    const result = testConnection(CFG);
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(result).resolves.toEqual({ ok: false, category: 'interrupted' });
  });

  it('does not start a request when the caller has already cancelled the probe', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(testConnection(CFG, { signal: controller.signal })).resolves.toEqual({
      ok: false,
      category: 'interrupted',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
