// Ported from apps/sparcd-explorer/tests/test_endpoint.py.

import { describe, expect, it } from 'vitest';
import { parseEndpoint } from '../../src/lib/endpoint';

describe('test_endpoint', () => {
  it('accepts usable endpoints', () => {
    const cases: [string, boolean, string, boolean][] = [
      ['server.example.org', true, 'server.example.org', true],
      ['https://server.example.org', false, 'server.example.org', true],
      ['https://server.example.org/', true, 'server.example.org', true],
      ['  server.example.org  ', true, 'server.example.org', true],
      ['localhost', false, 'localhost', false],
      ['localhost:9000', false, 'localhost:9000', false],
      ['http://localhost:9000', true, 'localhost:9000', false],
      ['HTTP://127.0.0.1:9000', true, '127.0.0.1:9000', false],
      ['[::1]:9000', false, '[::1]:9000', false],
    ];
    for (const [raw, defaultSecure, endpoint, secure] of cases) {
      expect(parseEndpoint(raw, defaultSecure), raw).toEqual({ endpoint, secure, problem: null });
    }
  });

  it('says what is wrong with an unusable endpoint', () => {
    const cases: Record<string, string> = {
      'https:///server.example.org': 'two slashes after “https:”',
      'https:/server.example.org': 'two slashes after “https:”',
      'https:server.example.org': 'two slashes after “https:”',
      'https://': 'server name is missing',
      ':9000': 'server name is missing',
      'server. example.org': 'Remove the spaces',
      'localhost:abc': 'number after the “:”',
      'localhost:99999': 'number after the “:”',
      'https://[::1': "doesn't look like a web address",
      'ftp://server.example.org': 'instead of ftp://',
      'https://user:pass@example.com': '“@” and everything before it',
      'server.example.org\tx': 'Remove the spaces',
      'https://server.example.org/minio/': 'Remove “/minio/” from the end',
      'server.example.org?': 'Remove “?” from the end',
    };
    for (const [raw, fragment] of Object.entries(cases)) {
      const { problem } = parseEndpoint(raw, true);
      expect(problem, raw).not.toBeNull();
      expect(problem, raw).toContain(fragment);
    }
  });
});
