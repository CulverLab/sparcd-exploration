import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';

const shared = vi.hoisted(() => ({ session: null as ((cfg: S3Config | null) => void) | null, preference: null as ((event: { preferenceKey: string | null }) => void) | null }));
vi.mock('@sparcd/auth-ui', async (original) => ({
  ...await original<typeof import('@sparcd/auth-ui')>(),
  loadSessionConnection: () => null,
  saveSharedConnection: vi.fn(), clearSharedConnection: vi.fn(),
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
const { useStore } = await import('../src/store');
const { useDraftStore } = await import('../src/lib/drafts');
const { saveLoginIdentity, saveLoginIdentityDefault, loginIdentityPreferenceKey } = await import('@sparcd/auth-ui');
const config = (accessKey = 'SPKLOGIN_A'): S3Config => ({ endpoint: 'https://accounts.example', accessKey, secretKey: 'secret', region: 'us-east-1', forcePathStyle: true });
const resolved = (name: string) => new Response(JSON.stringify({ id: 'person', name }), { status: 200 });
const denied = () => new Response('denied', { status: 403 });
function defer<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function settled() { await vi.waitFor(() => expect(useStore.getState().identityResolutionStatus).not.toBe('loading')); }
async function login(name = 'Alice', key = 'SPKLOGIN_A') {
  vi.stubGlobal('fetch', vi.fn(async () => resolved(name)));
  useStore.getState().connect(config(key), false);
  await settled();
}
beforeEach(() => { rejectWrites = false; records.clear(); useStore.getState().disconnect(); useDraftStore.setState({ drafts: {} }); });
afterEach(async () => { await useDraftStore.getState().flushSaves(); });

describe('Tagger connected attribution', () => {
  it('uses whoami names, keeps opaque shared preferences, and restores each login’s custom identity', async () => {
    await login(); expect(useStore.getState().taggerUser).toBe('Alice');
    useStore.getState().setTaggerUser('Custom A');
    await login('Bob', 'SPKLOGIN_B'); expect(useStore.getState().taggerUser).toBe('Bob');
    await login('Alice renamed'); expect(useStore.getState().taggerUser).toBe('Custom A');
    for (const [key, value] of records) { expect(key).not.toContain('SPKLOGIN'); expect(value).not.toContain('SPKLOGIN'); }
  });
  it('allows blank editing and removes custom identity on clear and blur', async () => {
    await login(); useStore.getState().setTaggerUser('Custom');
    useStore.getState().beginTaggerIdentityEdit(); useStore.getState().setTaggerUser('  ');
    await useStore.getState().refreshTaggerIdentity(); expect(useStore.getState().taggerUser).toBe('  ');
    useStore.getState().ensureTaggerIdentity(); expect(useStore.getState().taggerUser).toBe('Alice');
  });
  it.each([401, 403, 404, 429, 500])('never substitutes an Access key for an unrecognized HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status })));
    useStore.getState().connect(config(), false); await settled();
    expect(useStore.getState().taggerUser).toBe(''); expect(useStore.getState().identityResolutionStatus).toBe('error');
  });
  it.each([408, 429, 500, 503])('keeps attribution unresolved for HTTP %s even with a route-absence body', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status })));
    useStore.getState().connect(config(), false); await settled();
    expect(useStore.getState().taggerUser).toBe('');
    expect(useStore.getState().identityResolutionStatus).toBe('error');
  });
  it('uses an Access-key marker only for protocol-specific route absence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })));
    useStore.getState().connect(config(), false); await settled();
    expect(useStore.getState().taggerUser).toBe('SPKLOGIN_A');
    expect([...records.values()].join('')).not.toContain('SPKLOGIN_A');
  });
  it('does not reuse an Access-key default marker after an authorization failure or blur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Code>NoSuchKey</Code>', { status: 404 })));
    useStore.getState().connect(config(), false); await settled();
    vi.stubGlobal('fetch', vi.fn(async () => denied())); await useStore.getState().refreshTaggerIdentity();
    expect(useStore.getState().taggerUser).toBe('');
    useStore.getState().ensureTaggerIdentity(); expect(useStore.getState().taggerUser).toBe('');
  });
  it('retains a resolved name during lookup failures, and permits custom identity during outages', async () => {
    await login(); vi.stubGlobal('fetch', vi.fn(async () => denied())); await useStore.getState().refreshTaggerIdentity();
    expect(useStore.getState().taggerUser).toBe('Alice');
    useStore.getState().setTaggerUser('Offline custom'); await useStore.getState().refreshTaggerIdentity();
    expect(useStore.getState().taggerUser).toBe('Offline custom');
  });
  it('ignores late requests after switching logins or disconnecting', async () => {
    const late = defer<Response>(); vi.stubGlobal('fetch', vi.fn(() => late.promise));
    useStore.getState().connect(config(), false);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await login('Bob', 'SPKLOGIN_B'); late.resolve(resolved('Wrong Alice')); await Promise.resolve();
    expect(useStore.getState().taggerUser).toBe('Bob');
    const another = defer<Response>(); vi.stubGlobal('fetch', vi.fn(() => another.promise));
    const pending = useStore.getState().refreshTaggerIdentity();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    useStore.getState().disconnect(); another.resolve(resolved('Wrong Bob')); await pending;
    expect(useStore.getState().taggerUser).toBe('');
  });
  it('accepts only the latest overlapping retry', async () => {
    await login(); const first = defer<Response>(); const second = defer<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const older = useStore.getState().refreshTaggerIdentity();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const newer = useStore.getState().refreshTaggerIdentity();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    second.resolve(resolved('Newest')); await newer; first.resolve(resolved('Older')); await older;
    expect(useStore.getState().taggerUser).toBe('Newest');
  });
  it('preserves unsaved custom names across lookup outcomes, notifications, and same-login relays', async () => {
    await login(); rejectWrites = true; useStore.getState().setTaggerUser('Unsaved custom');
    await useStore.getState().refreshTaggerIdentity();
    vi.stubGlobal('fetch', vi.fn(async () => denied())); await useStore.getState().refreshTaggerIdentity();
    shared.preference?.({ preferenceKey: loginIdentityPreferenceKey('SPKLOGIN_A') });
    shared.session?.(config()); expect(useStore.getState().taggerUser).toBe('Unsaved custom');
    expect(useStore.getState().identityPersistenceError).toBe(true);
    rejectWrites = false; await login('Bob', 'SPKLOGIN_B'); expect(useStore.getState().taggerUser).toBe('Bob');
  });
  it('does not resurrect a removed custom override when storage rejects clearing', async () => {
    await login(); useStore.getState().setTaggerUser('Old custom'); rejectWrites = true;
    useStore.getState().beginTaggerIdentityEdit(); useStore.getState().setTaggerUser(''); useStore.getState().ensureTaggerIdentity();
    expect(useStore.getState().taggerUser).toBe('Alice'); expect(useStore.getState().identityPersistenceError).toBe(true);
  });
  it('adopts shared preference changes without replacing the active field during editing', async () => {
    await login(); saveLoginIdentity('SPKLOGIN_A', 'Uploader custom');
    shared.preference?.({ preferenceKey: loginIdentityPreferenceKey('SPKLOGIN_A') });
    expect(useStore.getState().taggerUser).toBe('Uploader custom');
    useStore.getState().beginTaggerIdentityEdit(); useStore.getState().setTaggerUser('  ');
    shared.preference?.({ preferenceKey: loginIdentityPreferenceKey('SPKLOGIN_A') }); expect(useStore.getState().taggerUser).toBe('  ');
  });
  it('preserves unfinished input through same-login credential replacement and lookup', async () => {
    await login(); useStore.getState().beginTaggerIdentityEdit(); useStore.getState().setTaggerUser('  ');
    shared.session?.({ ...config(), secretKey: 'replacement' }); await settled();
    expect(useStore.getState().taggerUser).toBe('  ');
    useStore.getState().ensureTaggerIdentity(); expect(useStore.getState().taggerUser).toBe('Alice');
  });
  it('adopts a newly resolved default from Uploader when there is no custom override', async () => {
    await login();
    saveLoginIdentityDefault('SPKLOGIN_A', 'Renamed Alice', 'whoami');
    shared.preference?.({ preferenceKey: loginIdentityPreferenceKey('SPKLOGIN_A') });
    expect(useStore.getState().taggerUser).toBe('Renamed Alice');
  });
  it('blocks all draft mutations without connected identity but preserves optional disconnected editing', async () => {
    const request = defer<Response>(); vi.stubGlobal('fetch', vi.fn(() => request.promise)); useStore.getState().connect(config(), false);
    const ctx = { bucket: 'test', uploadPrefix: 'upload' }, target = { mediaPath: 'image', deploymentId: 'camera' };
    const draft = useDraftStore.getState();
    draft.addSpecies(ctx, [target], { scientificName: 'Canis latrans', commonName: 'Coyote' });
    draft.incrementSpecies(ctx, [target], { scientificName: 'Canis latrans', commonName: 'Coyote' });
    draft.setSpeciesCount(ctx, 'image', 'camera', undefined, 'Canis latrans', 3);
    draft.removeSpecies(ctx, 'image', 'camera', undefined, 'Canis latrans'); draft.detag(ctx, [target]);
    draft.setQuestionableMany(ctx, [target], true); draft.setTimeOverride(ctx, 'image', 'camera', undefined, '2024-01-01');
    expect(useDraftStore.getState().drafts).toEqual({});
    useStore.getState().disconnect(); request.resolve(denied());
    draft.addSpecies(ctx, [target], { scientificName: 'Canis latrans', commonName: 'Coyote' });
    expect(useDraftStore.getState().drafts.image.observations).toHaveLength(1);
  });
  it('captures each action identity and keeps original identification and review attribution', async () => {
    await login(); const ctx = { bucket: 'test', uploadPrefix: 'upload' }, target = { mediaPath: 'first', deploymentId: 'camera' };
    useStore.getState().setTaggerUser('Actor A'); useDraftStore.getState().addSpecies(ctx, [target], { scientificName: 'Canis latrans', commonName: 'Coyote' });
    useStore.getState().setTaggerUser('Actor B'); useDraftStore.getState().addSpecies(ctx, [{ ...target, mediaPath: 'second' }], { scientificName: 'Puma concolor', commonName: 'Puma' });
    expect(useDraftStore.getState().drafts.first.observations[0].classifiedBy).toBe('Actor A');
    expect(useDraftStore.getState().drafts.second.observations[0].classifiedBy).toBe('Actor B');
    const base = { observations: useDraftStore.getState().drafts.first.observations };
    useDraftStore.getState().addSpecies(ctx, [{ ...target, base }], { scientificName: 'Canis latrans', commonName: 'Coyote' });
    expect(useDraftStore.getState().drafts.first.observations[0].classifiedBy).toBe('Actor A');
    expect(useDraftStore.getState().drafts.first.observations[0].reviewEvents?.at(-1)?.reviewedBy).toBe('Actor B');
  });
});
