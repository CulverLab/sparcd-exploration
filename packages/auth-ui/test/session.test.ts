import { beforeEach, describe, expect, it } from 'vitest';
import { loadPersistedConnection } from '../src/session';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

describe('loadPersistedConnection', () => {
  beforeEach(() => store.clear());

  it('returns the remembered server and username', () => {
    store.set('sparcd-connection', JSON.stringify({ endpoint: 'server.example.org', accessKey: 'fieldlead' }));
    expect(loadPersistedConnection()).toEqual({ endpoint: 'server.example.org', accessKey: 'fieldlead' });
  });

  it('never returns a secret saved by an older build, and removes it from storage', () => {
    store.set(
      'sparcd-connection',
      JSON.stringify({ endpoint: 'server.example.org', accessKey: 'fieldlead', secretKey: 'old-secret' }),
    );
    const loaded = loadPersistedConnection();
    expect(loaded).toEqual({ endpoint: 'server.example.org', accessKey: 'fieldlead' });
    expect(loaded).not.toHaveProperty('secretKey');
    expect(store.get('sparcd-connection')).not.toContain('old-secret');
  });
});
