import { describe, it, expect } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { SafeS3Client } from '../src/index';

const CFG: S3Config = {
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  accessKey: 'AK',
  secretKey: 'SK',
  forcePathStyle: true,
};

const FIFTEEN_MIN = 15 * 60_000;

const xml = (s: string) => new TextEncoder().encode(s);
const LISTING = xml(
  '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><Prefix>p/</Prefix><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>',
);
const skewedError = (serverTime?: string) =>
  xml(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>RequestTimeTooSkewed</Code><Message>The difference between the request time and the server's time is too large.</Message>${
      serverTime ? `<ServerTime>${serverTime}</ServerTime>` : ''
    }<RequestId>r1</RequestId></Error>`,
  );

/** `20261021T101500Z` → epoch ms. */
const amzDate = (s: string) =>
  Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));

/**
 * A server whose clock runs `offsetMs` ahead of this machine's. Like S3 and
 * MinIO it refuses a request signed more than 15 minutes from its own time,
 * answering 403 RequestTimeTooSkewed with its time in the `Date` header
 * (and, when `serverTimeInBody`, in `<ServerTime>`; MinIO omits it).
 */
function skewedServer(
  offsetMs: number,
  opts: { dateHeader?: boolean; serverTimeInBody?: boolean; checksAgainstMs?: number } = {},
) {
  const log: { status: number }[] = [];
  return {
    log,
    handler: {
      async handle(request: { headers: Record<string, string> }) {
        // Every request in a burst is in flight before the first answer lands.
        await new Promise((r) => setTimeout(r, 5));
        const now = Date.now() + offsetMs;
        // A server can also check against a clock other than the one it reports.
        const checked = Date.now() + (opts.checksAgainstMs ?? offsetMs);
        const skewed = Math.abs(checked - amzDate(request.headers['x-amz-date'])) > FIFTEEN_MIN;
        log.push({ status: skewed ? 403 : 200 });
        const headers: Record<string, string> = { 'content-type': 'application/xml' };
        if (opts.dateHeader !== false) headers.date = new Date(now).toUTCString();
        return {
          response: skewed
            ? { statusCode: 403, headers, body: skewedError(opts.serverTimeInBody ? new Date(now).toISOString() : undefined) }
            : { statusCode: 200, headers, body: LISTING },
        };
      },
      updateHttpClientConfig() {},
      httpHandlerConfigs: () => ({}),
    },
  };
}

function clientAgainst(server: ReturnType<typeof skewedServer>): SafeS3Client {
  const client = new SafeS3Client(CFG, ['*']);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).client.config.requestHandler = server.handler;
  return client;
}

describe('a computer clock 20 minutes off', () => {
  it('recovers a single read', async () => {
    const server = skewedServer(20 * 60_000);
    await expect(clientAgainst(server).listFolder('b', 'p/')).resolves.toEqual({ prefixes: [], objects: [] });
    expect(server.log.map((l) => l.status)).toEqual([403, 200]);
  });

  // The SDK alone recovers only the first of these: the rest find the clock
  // already corrected, aren't marked for a retry, and fail.
  it('recovers every read in a burst sent before the first answer', async () => {
    const server = skewedServer(-20 * 60_000);
    const client = clientAgainst(server);
    const reads = await Promise.allSettled(Array.from({ length: 8 }, () => client.listFolder('b', 'p/')));
    expect(reads.map((r) => r.status)).toEqual(Array(8).fill('fulfilled'));
    expect(server.log.filter((l) => l.status === 403)).toHaveLength(8);
    expect(server.log.filter((l) => l.status === 200)).toHaveLength(8);
  });

  it('learns the server time from <ServerTime> when there is no Date header', async () => {
    const server = skewedServer(20 * 60_000, { dateHeader: false, serverTimeInBody: true });
    const client = clientAgainst(server);
    const reads = await Promise.allSettled(Array.from({ length: 4 }, () => client.listFolder('b', 'p/')));
    expect(reads.map((r) => r.status)).toEqual(Array(4).fill('fulfilled'));
  });

  it('says how far off the clock was', async () => {
    const server = skewedServer(-20 * 60_000);
    const client = clientAgainst(server);
    expect(client.clockOffset).toBe(0);
    await client.listFolder('b', 'p/');
    expect(Math.round(client.clockOffset / 60_000)).toBe(-20);
  });

  it('dates a presigned URL by the server clock once it is known', async () => {
    const server = skewedServer(20 * 60_000);
    const client = clientAgainst(server);
    await client.listFolder('b', 'p/');
    const url = new URL(await client.presignedGet('b', 'p/a.jpg', 60));
    const signedAt = amzDate(url.searchParams.get('X-Amz-Date')!);
    expect(Math.abs(signedAt - (Date.now() + 20 * 60_000))).toBeLessThan(60_000);
  });

  it('fails when the server still refuses after one more try', async () => {
    const server = skewedServer(20 * 60_000, { checksAgainstMs: 40 * 60_000 });
    const err = await clientAgainst(server).listFolder('b', 'p/').catch((e: unknown) => e);
    expect((err as { name: string }).name).toBe('RequestTimeTooSkewed');
    // The SDK's corrected retry, then this wrapper's one more.
    expect(server.log.map((l) => l.status)).toEqual([403, 403, 403]);
  });

  it('fails at once when the server does not say its time', async () => {
    const server = skewedServer(20 * 60_000, { dateHeader: false });
    const err = await clientAgainst(server).listFolder('b', 'p/').catch((e: unknown) => e);
    expect((err as { name: string }).name).toBe('RequestTimeTooSkewed');
    expect(server.log).toHaveLength(1);
  });
});
