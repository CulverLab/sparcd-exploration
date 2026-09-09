import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';

// How each origin answers a probe, keyed by endpoint. Unset is a dead port,
// which is what all but a handful of the derived range always are.
const behavior = new Map<string, 'ok' | 'http' | 'hang'>();

vi.mock('@sparcd/s3-safe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sparcd/s3-safe')>();
  return {
    ...actual,
    SafeS3Client: class {
      endpoint: string;
      constructor(cfg: S3Config) {
        this.endpoint = cfg.endpoint;
      }
      listBuckets(opts: { signal?: AbortSignal } = {}): Promise<string[]> {
        switch (behavior.get(this.endpoint)) {
          case 'ok':
            return Promise.resolve(['bucket']);
          case 'http':
            return Promise.reject(
              Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } }),
            );
          case 'hang':
            return new Promise<string[]>((_, reject) => {
              opts.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
            });
          default:
            return Promise.reject(new Error('Failed to fetch'));
        }
      }
    },
  };
});

const { deriveShardOrigins, probeShardClients, clearClientCache } = await import('../src/lib/s3');

const config = (endpoint: string): S3Config => ({
  endpoint,
  region: 'us-east-1',
  accessKey: 'AKIA1',
  secretKey: 'shh',
  forcePathStyle: true,
});

// Shards join as they answer, so compare as a set: only membership is promised.
const endpoints = (clients: readonly unknown[]) =>
  clients.map((c) => (c as { endpoint: string }).endpoint).sort();

const shard = (port: number) => `https://proxy.example.org:${port}`;

beforeEach(() => {
  clearClientCache();
  behavior.clear();
});

describe('deriveShardOrigins', () => {
  it('names every port a proxy could publish, for an https endpoint on :443', () => {
    const expected = Array.from({ length: 20 }, (_, i) => shard(8443 + i));
    expect(expected.at(-1)).toBe('https://proxy.example.org:8462');
    expect(deriveShardOrigins('https://proxy.example.org')).toEqual(expected);
    expect(deriveShardOrigins('https://proxy.example.org:443')).toEqual(expected);
    expect(deriveShardOrigins('proxy.example.org')).toEqual(expected);
  });

  it('derives nothing from an endpoint that already names a service', () => {
    expect(deriveShardOrigins('https://proxy.example.org:8443')).toEqual([]);
    expect(deriveShardOrigins('https://store.example:9000')).toEqual([]);
    expect(deriveShardOrigins('http://localhost:5311')).toEqual([]);
  });
});

describe('shard probing', () => {
  // Three published ports out of the twenty asked about — the operator sets the
  // shard count, and the client takes whatever answers.
  it('keeps the origins that list buckets and drops a refusal or a dead port', async () => {
    behavior.set(shard(8443), 'ok');
    behavior.set(shard(8444), 'ok');
    behavior.set(shard(8445), 'ok');
    behavior.set(shard(8446), 'http');

    const shards = probeShardClients(config('https://proxy.example.org'));

    expect(endpoints(await shards.settled)).toEqual([
      'https://proxy.example.org',
      shard(8443),
      shard(8444),
      shard(8445),
    ]);
  });

  // The point of the live list: one blackholed port must not hold the run for
  // the whole timeout when the shards that are up have already answered.
  it('lists a shard the moment it answers, without waiting for a dead one', async () => {
    vi.useFakeTimers();
    try {
      behavior.set(shard(8443), 'ok');
      behavior.set(shard(8444), 'hang');
      const shards = probeShardClients(config('https://proxy.example.org'));

      await vi.advanceTimersByTimeAsync(0);
      expect(endpoints(shards.live)).toEqual(['https://proxy.example.org', shard(8443)]);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(endpoints(await shards.settled)).toEqual([
        'https://proxy.example.org',
        shard(8443),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an endpoint with no derived shards on the primary alone', async () => {
    const shards = probeShardClients(config('http://localhost:5311'));
    expect(endpoints(shards.live)).toEqual(['http://localhost:5311']);
    expect(endpoints(await shards.settled)).toEqual(['http://localhost:5311']);
  });

  it('probes once per connection', async () => {
    behavior.set(shard(8443), 'ok');

    const first = probeShardClients(config('https://proxy.example.org'));
    await first.settled;
    behavior.set(shard(8444), 'ok');

    expect(probeShardClients(config('https://proxy.example.org'))).toBe(first);
  });
});
