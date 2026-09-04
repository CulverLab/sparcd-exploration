import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';

// How each origin answers a probe, keyed by endpoint. Unset never settles.
const behavior = new Map<string, 'ok' | 'http' | 'network'>();

vi.mock('@sparcd/s3-safe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sparcd/s3-safe')>();
  return {
    ...actual,
    SafeS3Client: class {
      endpoint: string;
      constructor(cfg: S3Config) {
        this.endpoint = cfg.endpoint;
      }
      listBuckets(): Promise<string[]> {
        switch (behavior.get(this.endpoint)) {
          case 'ok':
            return Promise.resolve(['bucket']);
          // An origin the storage itself refuses is still an origin: the
          // primary would have been refused the same way.
          case 'http':
            return Promise.reject(
              Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } }),
            );
          case 'network':
            return Promise.reject(new Error('Failed to fetch'));
          default:
            return new Promise<string[]>(() => {});
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

const endpoints = (clients: unknown[]) => clients.map((c) => (c as { endpoint: string }).endpoint);

beforeEach(() => {
  clearClientCache();
  behavior.clear();
});

describe('deriveShardOrigins', () => {
  it('names the proxy ports for an https endpoint on the default port', () => {
    const expected = [
      'https://proxy.example.org:8443',
      'https://proxy.example.org:8444',
      'https://proxy.example.org:8445',
    ];
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
  it('keeps the origins that list buckets and drops a refusal or a dead port', async () => {
    behavior.set('https://proxy.example.org:8443', 'ok');
    behavior.set('https://proxy.example.org:8444', 'http');
    behavior.set('https://proxy.example.org:8445', 'network');

    const clients = await probeShardClients(config('https://proxy.example.org'));

    expect(endpoints(clients)).toEqual([
      'https://proxy.example.org',
      'https://proxy.example.org:8443',
    ]);
  });

  it('drops an origin that never answers', async () => {
    vi.useFakeTimers();
    try {
      behavior.set('https://proxy.example.org:8443', 'ok');
      const pending = probeShardClients(config('https://proxy.example.org'));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(endpoints(await pending)).toEqual([
        'https://proxy.example.org',
        'https://proxy.example.org:8443',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an endpoint with no derived shards on the primary alone', async () => {
    expect(endpoints(await probeShardClients(config('http://localhost:5311')))).toEqual([
      'http://localhost:5311',
    ]);
  });

  it('probes once per connection', async () => {
    behavior.set('https://proxy.example.org:8443', 'ok');
    behavior.set('https://proxy.example.org:8444', 'network');
    behavior.set('https://proxy.example.org:8445', 'network');

    const first = await probeShardClients(config('https://proxy.example.org'));
    behavior.set('https://proxy.example.org:8444', 'ok');

    expect(await probeShardClients(config('https://proxy.example.org'))).toBe(first);
  });
});
