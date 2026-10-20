import { afterEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { fetchWhoAmI } from '../src/lib/whoami';
// @ts-expect-error The production access-service verifier is JavaScript without type declarations.
import { verifySignature } from '../../sparcd-shard-proxy/access/sigv4.mjs';

const config: S3Config = {
  endpoint: 'https://accounts.example.org',
  region: 'us-east-1',
  accessKey: 'SPKPERSON123',
  secretKey: 'top-secret-never-send',
  forcePathStyle: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('signed account-name lookup', () => {
  it('uses a signed same-origin request and validates the returned person and name', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(_input)).pathname).toBe('/-/whoami');
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=SPKPERSON123\//);
      expect(headers.get('authorization')).not.toContain(config.secretKey);
      const verified = await verifySignature({
        method: 'GET', url: new URL(String(_input)), headers, body: new Uint8Array(),
        lookupSecret: (accessKey: string) => accessKey === config.accessKey ? config.secretKey : null,
        requireSignedBody: true,
      });
      expect(verified.error).toBeUndefined();
      expect(verified.accessKeyId).toBe(config.accessKey);
      return new Response(JSON.stringify({ id: 'person-123', name: 'Account Name' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWhoAmI(config)).resolves.toEqual({
      kind: 'resolved', id: 'person-123', name: 'Account Name',
    });
  });

  it('uses only protocol-specific absence evidence for unsupported routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })));
    await expect(fetchWhoAmI(config)).resolves.toEqual({ kind: 'unsupported' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    await expect(fetchWhoAmI(config)).rejects.toThrow(/HTTP 404/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'not_found', message: 'person record absent' } }),
      { status: 404 },
    )));
    await expect(fetchWhoAmI(config)).rejects.toThrow(/not_found/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'not_found', message: 'no such endpoint' } }),
      { status: 404 },
    )));
    await expect(fetchWhoAmI(config)).resolves.toEqual({ kind: 'unsupported' });
  });

  it.each([
    [401, '<Error><Code>NoSuchKey</Code></Error>'],
    [403, '<Error><Code>NoSuchKey</Code></Error>'],
    [403, '<Error><Code>InvalidAccessKeyId</Code></Error>'],
    [429, 'rate limited'],
    [500, 'server error'],
  ])('does not use Access-key fallback for HTTP %s', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
    await expect(fetchWhoAmI(config)).rejects.toThrow();
  });

  it('does not accept malformed successful responses', async () => {
    for (const body of ['not json', JSON.stringify({ id: 'person-123' }), JSON.stringify({ name: 'Name' })]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
      await expect(fetchWhoAmI(config)).rejects.toThrow(/response/i);
    }
  });

  it('reports network failures and timeouts without treating them as unsupported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(fetchWhoAmI(config)).rejects.toThrow(/could not be reached/i);

    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    await expect(fetchWhoAmI(config, 5)).rejects.toThrow(/timed out/i);
  });
});
