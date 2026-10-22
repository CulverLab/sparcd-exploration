// Ported from apps/sparcd-explorer/tests/test_connection_defaults.py. The old
// form could take a whole connection, secret included, from .env; the new
// app follows the Tagger: .env may only prefill an endpoint, and a secret is
// never prefilled. The intents carry over: never mix a remembered connection
// with another endpoint's settings, and keep the HTTPS default unless a
// remembered connection to the same endpoint says otherwise.

import { describe, expect, it } from 'vitest';
import type { PersistedConnection } from '@sparcd/auth-ui';
import { connectionPrefill } from '../../src/lib/connection';

const remembered = (secure: boolean): PersistedConnection => ({
  endpoint: 'remembered.example',
  accessKey: 'remembered-access',
  region: 'us-east-1',
  forcePathStyle: true,
  secure,
});

describe('test_connection_defaults: initial connection', () => {
  it('an environment endpoint takes precedence over the remembered one', () => {
    expect(connectionPrefill('environment.example', remembered(true)).endpoint).toBe('environment.example');
  });

  it('never prefills a secret, from either source', () => {
    expect(connectionPrefill('environment.example', remembered(true))).not.toHaveProperty('secretKey');
    expect(connectionPrefill(undefined, remembered(true))).not.toHaveProperty('secretKey');
  });

  it('keeps the remembered access key beside an environment endpoint', () => {
    expect(connectionPrefill('environment.example', remembered(true))).toEqual({
      endpoint: 'environment.example',
      accessKey: 'remembered-access',
    });
  });

  it('uses the remembered connection when there is no environment endpoint', () => {
    expect(connectionPrefill(undefined, remembered(true))).toEqual(remembered(true));
  });
});

describe('test_connection_defaults: the HTTPS default', () => {
  it('nothing remembered keeps the secure default', () => {
    // No `secure` in the prefill: the form infers HTTPS from the endpoint.
    expect(connectionPrefill(undefined, null)).toEqual({});
    expect(connectionPrefill('environment.example', null)).toEqual({ endpoint: 'environment.example' });
  });

  it('a remembered insecure connection wins', () => {
    expect(connectionPrefill(undefined, remembered(false)).secure).toBe(false);
  });

  it('a remembered secure connection wins', () => {
    expect(connectionPrefill(undefined, remembered(true)).secure).toBe(true);
  });

  it('an environment endpoint keeps the secure default', () => {
    expect(connectionPrefill('environment.example', remembered(false))).not.toHaveProperty('secure');
  });
});
