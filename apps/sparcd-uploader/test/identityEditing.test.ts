import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
const shared = vi.hoisted(() => ({ session: null as ((cfg: S3Config | null) => void) | null, preference: null as ((event: { preferenceKey: string | null }) => void) | null }));
vi.mock('@sparcd/auth-ui', async original => ({
  ...await original<typeof import('@sparcd/auth-ui')>(),
  loadSessionConnection: () => null, saveSharedConnection: vi.fn(), clearSharedConnection: vi.fn(),
  subscribeSharedConnection: (fn: typeof shared.session) => { shared.session = fn; },
  subscribeLoginIdentityChanges: (fn: typeof shared.preference) => { shared.preference = fn; },
}));
const records = new Map<string, string>();
let rejectWrites = false;
vi.stubGlobal('localStorage', {
  get length() { return records.size; }, key: (i: number) => [...records.keys()][i] ?? null,
  getItem: (key: string) => records.get(key) ?? null,
  setItem: (key: string, value: string) => { if (rejectWrites) throw Error('quota'); records.set(key, value); },
  removeItem: (key: string) => { if (rejectWrites) throw Error('quota'); records.delete(key); },
});
const session = new Map<string, string>();
vi.stubGlobal('sessionStorage', { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value); }, removeItem: (key: string) => { session.delete(key); } });
const { useStore } = await import('../src/store');
const { saveLoginIdentityDefault, loginIdentityPreferenceKey } = await import('@sparcd/auth-ui');
const config = (accessKey = 'SPK_A', secretKey = 'secret'): S3Config => ({ endpoint: 'https://accounts.example', accessKey, secretKey, region: 'us-east-1', forcePathStyle: true });
const response = (status = 200) => new Response(status === 200 ? JSON.stringify({ id: 'person', name: 'Alice' }) : 'denied', { status });
const notify = () => shared.preference?.({ preferenceKey: loginIdentityPreferenceKey('SPK_A') });
async function settled() { await vi.waitFor(() => expect(useStore.getState().identityResolutionStatus).not.toBe('loading')); }
async function login() { vi.stubGlobal('fetch', vi.fn(async () => response())); useStore.getState().connect(config(), false); await settled(); }
beforeEach(() => { rejectWrites = false; useStore.getState().disconnect(); records.clear(); session.clear(); });
afterEach(() => { rejectWrites = false; });

describe('Uploader identity editing under shared updates and storage failures', () => {
  it.each([200, 403])('preserves blank editing through shared updates and a pending HTTP %s lookup', async status => {
    await login(); let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = useStore.getState().refreshUploaderIdentity(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    useStore.getState().beginUploaderIdentityEdit(); useStore.getState().setUploaderUser('   ');
    saveLoginIdentityDefault('SPK_A', 'Alice', 'whoami'); notify(); expect(useStore.getState().uploaderUser).toBe('   ');
    finish(response(status)); await pending; expect(useStore.getState().uploaderUser).toBe('   ');
    useStore.getState().ensureUploaderIdentity(); expect(useStore.getState().uploaderUser).toBe('Alice');
  });
  it('retains a failed clear instead of resurrecting the stored custom identity', async () => {
    await login(); useStore.getState().setUploaderUser('Old custom'); rejectWrites = true;
    useStore.getState().setUploaderUser(''); useStore.getState().ensureUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('Alice'); expect(useStore.getState().identityUnsavedCustom).toBe('');
    notify(); await useStore.getState().refreshUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('Alice'); expect(useStore.getState().identityPersistenceError).toBe(true);
  });
  it.each(['direct', 'sibling'])('preserves a rejected custom write through %s same-login credential replacement', async method => {
    await login(); rejectWrites = true; useStore.getState().setUploaderUser('Unsaved name');
    if (method === 'direct') useStore.getState().connect(config('SPK_A', 'replacement'), false);
    else shared.session?.(config('SPK_A', 'replacement'));
    await settled(); notify();
    expect(useStore.getState().uploaderUser).toBe('Unsaved name'); expect(useStore.getState().identityPersistenceError).toBe(true);
    rejectWrites = false; useStore.getState().connect(config('SPK_B'), false); await settled();
    expect(useStore.getState().uploaderUser).toBe('Alice'); expect(useStore.getState().identityUnsavedCustom).toBeNull();
  });
  it('retains an uncached resolved name during a retry failure and preference notification', async () => {
    rejectWrites = true; await login(); expect(useStore.getState().uploaderUser).toBe('Alice');
    vi.stubGlobal('fetch', vi.fn(async () => response(403)));
    const pending = useStore.getState().refreshUploaderIdentity(); expect(useStore.getState().uploaderUser).toBe('Alice');
    await pending; notify(); useStore.getState().ensureUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('Alice'); expect(useStore.getState().identityPersistenceError).toBe(true);
  });
  it('preserves editing across same-login replacement but resets it on another login', async () => {
    await login(); useStore.getState().beginUploaderIdentityEdit(); useStore.getState().setUploaderUser('  ');
    shared.session?.(config('SPK_A', 'replacement')); await settled(); expect(useStore.getState().uploaderUser).toBe('  ');
    useStore.getState().connect(config('SPK_B'), false); await settled(); expect(useStore.getState().uploaderUser).toBe('Alice');
  });
  it('does not reuse an Access-key fallback after authorization fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Code>NoSuchKey</Code>', { status: 404 })));
    useStore.getState().connect(config(), false); await settled(); expect(useStore.getState().uploaderUser).toBe('SPK_A');
    vi.stubGlobal('fetch', vi.fn(async () => response(403))); await useStore.getState().refreshUploaderIdentity();
    useStore.getState().ensureUploaderIdentity(); expect(useStore.getState().uploaderUser).toBe('');
  });
});
