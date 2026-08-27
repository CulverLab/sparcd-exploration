import { beforeEach, describe, expect, it } from 'vitest';
import type { S3Config } from '@sparcd/types';

const storage = () => {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const local = storage();
const session = storage();

type Listener = (e: { data: unknown }) => void;

/** A BroadcastChannel that, like the real one, never delivers what it posts
 *  back to itself — so `fromSibling` is the only way a message arrives. */
class FakeChannel {
  static current: FakeChannel | null = null;
  readonly posted: unknown[] = [];
  private readonly listeners = new Set<Listener>();

  constructor() {
    FakeChannel.current = this;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(_type: string, fn: Listener): void {
    this.listeners.add(fn);
  }

  removeEventListener(_type: string, fn: Listener): void {
    this.listeners.delete(fn);
  }

  fromSibling(data: unknown): void {
    for (const fn of this.listeners) fn({ data });
  }
}

Object.assign(globalThis, {
  localStorage: local,
  sessionStorage: session,
  BroadcastChannel: FakeChannel,
});

const {
  saveSharedConnection,
  clearSharedConnection,
  loadSessionConnection,
  getLiveConnection,
  subscribeSharedConnection,
} = await import('../../../packages/auth-ui/src/session');

const CONFIG: S3Config = {
  endpoint: 'http://localhost:5311',
  accessKey: 'AKIATESTKEY0001',
  secretKey: 'test-secret-key',
  region: 'us-east-1',
  forcePathStyle: true,
  secure: false,
};

beforeEach(() => {
  local.map.clear();
  session.map.clear();
  clearSharedConnection();
});

describe('shared connection storage', () => {
  it('stashes the full config in sessionStorage and restores it', () => {
    saveSharedConnection(CONFIG, true);

    expect(loadSessionConnection()).toEqual(CONFIG);
    expect(getLiveConnection()).toEqual(CONFIG);
  });

  it('keeps the secret out of localStorage', () => {
    saveSharedConnection(CONFIG, true);

    const persisted = JSON.parse(local.getItem('sparcd-connection') ?? '{}');
    expect(persisted).toEqual({
      endpoint: CONFIG.endpoint,
      accessKey: CONFIG.accessKey,
      region: CONFIG.region,
      forcePathStyle: CONFIG.forcePathStyle,
      secure: CONFIG.secure,
    });
    expect(JSON.stringify(persisted)).not.toContain(CONFIG.secretKey);
  });

  it('clear ends the tab session but keeps the remembered fields', () => {
    saveSharedConnection(CONFIG, true);

    clearSharedConnection();

    expect(session.getItem('sparcd-connection-tab')).toBeNull();
    expect(local.getItem('sparcd-connection')).not.toBeNull();
    expect(loadSessionConnection()).toBeNull();
    expect(getLiveConnection()).toBeNull();
  });

  it('connecting with remember off forgets a previously remembered connection', () => {
    saveSharedConnection(CONFIG, true);
    saveSharedConnection(CONFIG, false);

    expect(local.getItem('sparcd-connection')).toBeNull();
  });

  it('reports no session when the tab has none', () => {
    expect(loadSessionConnection()).toBeNull();
  });

  it('stashes a session adopted from another tab, and rebroadcasts nothing', () => {
    const seen: (S3Config | null)[] = [];
    const unsubscribe = subscribeSharedConnection(
      (cfg) => void seen.push(cfg),
      () => null,
    );
    const channel = FakeChannel.current!;
    channel.posted.length = 0; // the `request` fired on subscribe

    channel.fromSibling({ type: 'connect', config: CONFIG });

    expect(seen).toEqual([CONFIG]);
    expect(loadSessionConnection()).toEqual(CONFIG);

    channel.fromSibling({ type: 'disconnect' });

    expect(seen).toEqual([CONFIG, null]);
    expect(session.getItem('sparcd-connection-tab')).toBeNull();
    expect(channel.posted).toEqual([]);
    unsubscribe();
  });
});
