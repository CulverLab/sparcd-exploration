import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { clockOffsetFor, sourceFor } from '../../src/lib/opening';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
});

const connection: S3Config = {
  endpoint: 'https://server.example.org',
  region: 'us-east-1',
  accessKey: 'fieldlead',
  secretKey: 'secret',
  forcePathStyle: true,
};

describe('the client for a connection', () => {
  // Another SPARC'd tab hands the session over as a new object. A new client
  // would forget the server's clock and send its first reads skewed again.
  it('stays the same when the same connection comes back as a new object', () => {
    const first = sourceFor(connection);
    expect(sourceFor({ ...connection })).toBe(first);
    expect(clockOffsetFor({ ...connection })).toBe(0);
  });

  it('is new for another server, key or password', () => {
    const first = sourceFor(connection);
    expect(sourceFor({ ...connection, secretKey: 'changed' })).not.toBe(first);
    expect(sourceFor({ ...connection, endpoint: 'https://other.example.org' })).not.toBe(first);
  });
});
