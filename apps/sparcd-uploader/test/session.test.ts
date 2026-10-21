import { beforeEach, describe, expect, it, vi } from 'vitest';
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

let api: typeof import('../../../packages/auth-ui/src/session');
let saveSharedConnection: typeof api.saveSharedConnection;
let clearSharedConnection: typeof api.clearSharedConnection;
let loadSessionConnection: typeof api.loadSessionConnection;
let getLiveConnection: typeof api.getLiveConnection;
let subscribeSharedConnection: typeof api.subscribeSharedConnection;

const head = () => JSON.parse(local.getItem('sparcd-connection-revision') ?? 'null');
function sibling(config: S3Config | null, counter = (head()?.revision.counter ?? 0) + 1, id = 'sibling') {
  return { protocol: 1, revision: { counter, id }, connected: !!config,
    ...(config ? { type: 'connect', config } : { type: 'disconnect' }) };
}

const CONFIG: S3Config = {
  endpoint: 'http://localhost:5311',
  accessKey: 'AKIATESTKEY0001',
  secretKey: 'test-secret-key',
  region: 'us-east-1',
  forcePathStyle: true,
  secure: false,
};

beforeEach(async () => {
  local.map.clear();
  session.map.clear();
  vi.resetModules();
  api = await import('../../../packages/auth-ui/src/session');
  ({ saveSharedConnection, clearSharedConnection, loadSessionConnection,
    getLiveConnection, subscribeSharedConnection } = api);
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

    channel.fromSibling(sibling(CONFIG));

    expect(seen).toEqual([CONFIG]);
    expect(loadSessionConnection()).toEqual(CONFIG);

    channel.fromSibling(sibling(null));

    expect(seen).toEqual([CONFIG, null]);
    expect(session.getItem('sparcd-connection-tab')).toBeNull();
    expect(channel.posted).toEqual([]);
    unsubscribe();
  });
});


describe('stale connection regressions (#479)', () => {
  it('keeps live state synchronized when a sibling connects and disconnects', () => {
    const unsubscribe = subscribeSharedConnection(() => {}, () => null);
    FakeChannel.current!.fromSibling(sibling(CONFIG));
    expect(getLiveConnection()).toEqual(CONFIG);
    FakeChannel.current!.fromSibling(sibling(null));
    expect(getLiveConnection()).toBeNull();
    unsubscribe();
  });

  it('does not let an old unversioned reply replace the corrected endpoint', () => {
    const corrected = { ...CONFIG, endpoint: 'https://corrected.example' };
    saveSharedConnection(corrected, true);
    const unsubscribe = subscribeSharedConnection(() => {}, () => corrected);
    FakeChannel.current!.fromSibling({ type: 'connect', config: CONFIG });
    expect(loadSessionConnection()).toEqual(corrected);
    unsubscribe();
  });

  it('does not resurrect a disconnected session from a stale sibling reply', () => {
    saveSharedConnection(CONFIG, true);
    clearSharedConnection();
    const unsubscribe = subscribeSharedConnection(() => {}, () => null);
    FakeChannel.current!.fromSibling({ type: 'connect', config: CONFIG });
    expect(loadSessionConnection()).toBeNull();
    unsubscribe();
  });
});

describe('versioned shared session precedence', () => {
  it('rejects older versioned replies after correction and logout', () => {
    saveSharedConnection(CONFIG, true);
    const old = { ...head(), type: 'connect', config: CONFIG };
    const corrected = { ...CONFIG, endpoint: 'https://corrected.example', region: 'auto' };
    saveSharedConnection(corrected, false);
    const seen: unknown[] = [];
    const unsub = subscribeSharedConnection((cfg) => seen.push(cfg), () => CONFIG);
    FakeChannel.current!.fromSibling(old);
    expect(getLiveConnection()).toEqual(corrected);
    expect(loadSessionConnection()).toEqual(corrected);
    clearSharedConnection();
    FakeChannel.current!.fromSibling(old);
    expect(loadSessionConnection()).toBeNull();
    expect(seen).toEqual([]);
    expect(local.getItem('sparcd-connection')).toBeNull();
    unsub();
  });

  it('relays the original revision and synchronized config, never a stale app getter', () => {
    const unsub = subscribeSharedConnection(() => {}, () => CONFIG);
    const corrected = { ...CONFIG, endpoint: 'https://corrected.example' };
    const update = sibling(corrected, 5);
    const channel = FakeChannel.current!;
    channel.fromSibling(update);
    channel.posted.length = 0;
    channel.fromSibling({ type: 'request', protocol: 1 });
    expect(channel.posted).toEqual([update]);
    expect(head().revision).toEqual(update.revision);
    unsub();
  });

  it('ignores out-of-order/duplicate replies and notifies every subscriber once', () => {
    const first: unknown[] = [], second: unknown[] = [];
    const unsub1 = subscribeSharedConnection((cfg) => first.push(cfg), () => null);
    const unsub2 = subscribeSharedConnection((cfg) => second.push(cfg), () => null);
    const channel = FakeChannel.current!;
    const latest = sibling(CONFIG, 10);
    channel.fromSibling(latest);
    channel.fromSibling(sibling({ ...CONFIG, endpoint: 'https://old.example' }, 2));
    channel.fromSibling(latest);
    expect(first).toEqual([CONFIG]);
    expect(second).toEqual([CONFIG]);
    expect(getLiveConnection()).toEqual(CONFIG);
    unsub1();
    channel.fromSibling(sibling(null, 11));
    expect(first).toEqual([CONFIG]);
    expect(second).toEqual([CONFIG, null]);
    unsub2();
  });

  it('orders simultaneous decisions deterministically and repairs a lower shared mark', () => {
    subscribeSharedConnection(() => {}, () => null);
    const channel = FakeChannel.current!;
    channel.fromSibling(sibling(CONFIG, 2, 'z'));
    local.setItem('sparcd-connection-revision', JSON.stringify(sibling(null, 2, 'a')));
    channel.fromSibling(sibling(null, 2, 'a'));
    expect(getLiveConnection()).toEqual(CONFIG);
    expect(head().revision).toEqual({ counter: 2, id: 'z' });
  });

  it('rejects an old tab stash after logout, including across module reload', async () => {
    saveSharedConnection(CONFIG, true);
    const oldSession = session.getItem('sparcd-connection-tab')!;
    clearSharedConnection();
    session.setItem('sparcd-connection-tab', oldSession);
    vi.resetModules();
    const restarted = await import('../../../packages/auth-ui/src/session');
    expect(restarted.loadSessionConnection()).toBeNull();
    expect(restarted.getLiveConnection()).toBeNull();
  });

  it('migrates same-tab legacy storage only before any versioned decision', async () => {
    session.setItem('sparcd-connection-tab', JSON.stringify(CONFIG));
    expect(loadSessionConnection()).toEqual(CONFIG);
    expect(head().revision.counter).toBe(1);
    clearSharedConnection();
    session.setItem('sparcd-connection-tab', JSON.stringify(CONFIG));
    vi.resetModules();
    const restarted = await import('../../../packages/auth-ui/src/session');
    expect(restarted.loadSessionConnection()).toBeNull();
  });

  it('persists only a non-secret logout mark and relays that exact decision', () => {
    saveSharedConnection(CONFIG, true);
    clearSharedConnection();
    const marker = head();
    const unsub = subscribeSharedConnection(() => {}, () => CONFIG);
    const channel = FakeChannel.current!;
    channel.posted.length = 0;
    channel.fromSibling({ type: 'request', protocol: 1 });
    expect(channel.posted).toEqual([{ ...marker, type: 'disconnect' }]);
    expect(JSON.stringify([...local.map])).not.toContain(CONFIG.secretKey);
    expect(JSON.stringify(marker)).not.toContain(CONFIG.accessKey);
    unsub();
  });

  it('ignores identical relays but accepts a genuinely newer replacement', () => {
    saveSharedConnection(CONFIG, true);
    const seen: unknown[] = [];
    subscribeSharedConnection((cfg) => seen.push(cfg), () => CONFIG);
    const channel = FakeChannel.current!;
    channel.fromSibling({ ...head(), type: 'connect', config: CONFIG });
    channel.fromSibling(sibling(CONFIG));
    expect(seen).toEqual([]);
    const replacement = { ...CONFIG, endpoint: 'https://new.example', accessKey: 'other', secretKey: 'other-secret' };
    channel.fromSibling(sibling(replacement));
    expect(seen).toEqual([replacement]);
    expect(getLiveConnection()).toEqual(replacement);
    expect(loadSessionConnection()).toEqual(replacement);
  });

  it('ignores malformed protocol messages', () => {
    saveSharedConnection(CONFIG, true);
    subscribeSharedConnection(() => {}, () => CONFIG);
    for (const raw of [null, {}, { ...sibling(null), revision: { counter: -1, id: 'bad' } },
      { ...sibling(CONFIG), config: { endpoint: 'missing-credentials' } }]) {
      FakeChannel.current!.fromSibling(raw);
    }
    expect(getLiveConnection()).toEqual(CONFIG);
  });
});


it('rechecks the shared revision before accepting an incoming reply', () => {
  saveSharedConnection(CONFIG, false);
  const seen: unknown[] = [];
  subscribeSharedConnection((cfg) => seen.push(cfg), () => CONFIG);
  const oldRead = local.getItem;
  let reads = 0;
  const marker = sibling(null, 20);
  const spy = vi.spyOn(local, 'getItem').mockImplementation((key) => {
    if (key === 'sparcd-connection-revision' && ++reads >= 2) return JSON.stringify(marker);
    return oldRead(key);
  });
  try {
    FakeChannel.current!.fromSibling(sibling({ ...CONFIG, endpoint: 'https://stale.example' }, 10));
    expect(getLiveConnection()).toEqual(CONFIG);
    expect(seen).toEqual([]);
    expect(JSON.parse(session.getItem('sparcd-connection-tab')!).endpoint).toBe(CONFIG.endpoint);
  } finally { spy.mockRestore(); }
});


it('never pairs old credentials with a newer revision after a failed session write', async () => {
  saveSharedConnection(CONFIG, false);
  const write = vi.spyOn(session, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  const corrected = { ...CONFIG, endpoint: 'https://corrected.example', secretKey: 'new-secret' };
  saveSharedConnection(corrected, false);
  expect(getLiveConnection()).toEqual(corrected);
  write.mockRestore();
  vi.resetModules();
  const restarted = await import('../../../packages/auth-ui/src/session');
  expect(restarted.loadSessionConnection()).toBeNull();
  expect(restarted.getLiveConnection()).toBeNull();
});

it.each(['connect', 'disconnect'])('publishes local %s if a sibling advances the mark during allocation', (operation) => {
  saveSharedConnection(CONFIG, false);
  const read = local.getItem;
  let reads = 0;
  const spy = vi.spyOn(local, 'getItem').mockImplementation((key) => {
    if (key === 'sparcd-connection-revision' && ++reads === 2) {
      local.map.set(key, JSON.stringify(sibling(CONFIG, 20)));
    }
    return read(key);
  });
  try {
    if (operation === 'connect') saveSharedConnection({ ...CONFIG, endpoint: 'https://corrected.example' }, false);
    else clearSharedConnection();
    expect(head().revision.counter).toBe(21);
    expect(head().connected).toBe(operation === 'connect');
    expect((FakeChannel.current!.posted.at(-1) as any).revision).toEqual(head().revision);
    expect(getLiveConnection()?.endpoint ?? null).toBe(operation === 'connect' ? 'https://corrected.example' : null);
  } finally { spy.mockRestore(); }
});


it('honors logout from an older app and relays it as a versioned logout', () => {
  saveSharedConnection(CONFIG, true);
  const before = head().revision.counter;
  const seen: unknown[] = [];
  subscribeSharedConnection((cfg) => seen.push(cfg), () => CONFIG);
  FakeChannel.current!.fromSibling({ type: 'disconnect' });
  expect(getLiveConnection()).toBeNull();
  expect(loadSessionConnection()).toBeNull();
  expect(seen).toEqual([null]);
  expect(head().revision.counter).toBe(before + 1);
  expect(FakeChannel.current!.posted.at(-1)).toMatchObject({
    protocol: 1, type: 'disconnect', connected: false,
  });
});
