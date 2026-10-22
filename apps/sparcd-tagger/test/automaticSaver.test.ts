import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { db } from '../src/lib/db';
import { AutomaticSaver, SaveConflict, type SaveServices } from '../src/lib/automaticSaver';
import { accountScope, type AutomaticRecord, type EditAction } from '../src/lib/automaticModel';

const record = (): AutomaticRecord => ({ id: 'auto', scope: 'account', bucket: 'bucket', uploadPrefix: 'upload/', collectionKey: 'bucket::collection', actions: [], undo: null });
const image = { key: 'image.jpg', fileName: 'image.jpg', deploymentId: 'd', baseTimestamp: '2024-01-01T00:00:00', baseObservations: [], baseQuestionable: true };
const remote = { images: [image], location: null };
const action = (id: string): EditAction => ({ id, user: 'Alice', at: new Date().toISOString(), changes: [{ path: image.key, field: 'expert', before: false, after: true }] });
function services(): SaveServices {
  return { save: vi.fn(async () => remote), current: vi.fn(async () => remote), changed: vi.fn(), resolve: vi.fn(async () => {}),
    reverse: vi.fn(async original => ({ action: { ...action('undo'), undoOf: original.id } })) };
}
let savers: AutomaticSaver[];
async function start(s = services()) { const saver = new AutomaticSaver(record(), s); savers.push(saver); await saver.open(); return saver; }
async function settle() { await new Promise<void>(resolve => setTimeout(resolve, 15)); }

beforeEach(async () => {
  await db.open(); await db.automatic.clear(); await db.syncJournals.clear(); savers = [];
  const locks = new Map<string, Promise<unknown>>();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (name: string, task: () => Promise<unknown>) => {
    const result = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(task);
    locks.set(name, result); return result;
  } } } });
});
afterEach(() => { savers.forEach(s => s.dispose()); vi.useRealTimers(); });

describe('durable automatic saving', () => {
  it('persists action and Undo boundaries before the debounce, and announces Saving immediately', async () => {
    const s = services(), saver = await start(s);
    saver.accept(action('first')); saver.accept(action('second'));
    expect(saver.view.phase).toBe('saving');
    await settle();
    const saved = await db.automatic.get('auto');
    expect(saved?.actions.map(a => a.id)).toEqual(['first', 'second']);
    expect(saved?.undo?.id).toBe('second');
    expect(s.save).not.toHaveBeenCalled();
  });
  it('starts after 500ms idle and bounds a continuous queue at one second', async () => {
    const s = services(), saver = await start(s);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const flush = vi.spyOn(saver, 'flush');
    saver.accept(action('a'));
    await vi.advanceTimersByTimeAsync(499); expect(flush).not.toHaveBeenCalled(); expect(s.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    await saver.flush(); expect(s.save).toHaveBeenCalledTimes(1);
    flush.mockClear();
    for (let i = 0; i < 5; i++) { saver.accept(action(`b${i}`)); await vi.advanceTimersByTimeAsync(200); }
    expect(flush).toHaveBeenCalledTimes(1);
    await saver.flush(); expect(s.save).toHaveBeenCalledTimes(2);
  });
  it('retains newer edits and serializes a second save behind an in-flight save', async () => {
    const s = services(); let finish!: () => void;
    s.save = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(remote); })).mockResolvedValue(remote);
    const saver = await start(s); saver.accept(action('a')); const first = saver.flush();
    await settle(); saver.accept(action('b')); expect(saver.flush()).toBe(first);
    expect(s.save).toHaveBeenCalledTimes(1); finish();
    expect(await first).toBe(true); expect(s.save).toHaveBeenCalledTimes(2);
    expect(saver.record.actions).toEqual([]); expect(saver.record.undo?.id).toBe('b');
  });
  it('retains failed flights across reload and retries without consuming Undo early', async () => {
    const s = services(); s.save = vi.fn().mockRejectedValue(new Error('Denied'));
    const saver = await start(s); saver.accept(action('a')); expect(await saver.flush()).toBe(false);
    expect(saver.view.phase).toBe('failed'); expect(saver.record.undo?.id).toBe('a');
    saver.dispose(); const resumed = await start();
    expect(resumed.record.flight?.ids).toEqual(['a']); expect(await resumed.flush()).toBe(true);
    expect(resumed.record.undo?.id).toBe('a');
  });
  it('does not retry conflicts automatically or through the ordinary Retry control', async () => {
    const s = services(); s.save = vi.fn().mockRejectedValue(new SaveConflict('remote changed'));
    const saver = await start(s); saver.accept(action('a')); await saver.flush();
    expect(await saver.retry()).toBe(false); expect(s.save).toHaveBeenCalledTimes(1);
    expect(saver.record.actions).toHaveLength(1);
  });
  it('pauses offline editing and saving, then flushes on reconnection', async () => {
    const s = services(), saver = await start(s); saver.accept(action('a')); saver.setOnline(false);
    expect(saver.view.canEdit).toBe(false); expect(await saver.flush()).toBe(false); expect(s.save).not.toHaveBeenCalled();
    saver.setOnline(true); await saver.flush(); expect(s.save).toHaveBeenCalledTimes(1);
  });
  it('consumes Undo only after the reversal commits, without creating Redo', async () => {
    const saver = await start(); saver.accept(action('a')); await saver.flush();
    expect(saver.view.undoReason).toBe(''); expect(await saver.undo()).toBe(true);
    expect(saver.record.undo).toBeNull(); expect((await db.automatic.get('auto'))?.undo).toBeNull();
    expect(await saver.undo()).toBe(false);
  });
  it('disables Undo when affected remote data changed', async () => {
    const s = services(), saver = await start(s); saver.accept(action('a')); await saver.flush();
    s.current = vi.fn(async () => ({ ...remote, images: [{ ...image, baseQuestionable: false }] }));
    expect(await saver.undo()).toBe(false); expect(s.reverse).not.toHaveBeenCalled();
    expect(saver.view.undoReason).toContain('affected data changed'); expect(saver.record.undo).not.toBeNull();
    expect(saver.view.canEdit).toBe(true);
    expect(s.changed).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'saved', canEdit: true }));
    saver.accept(action('next')); expect(await saver.flush()).toBe(true);
    expect(saver.record.undo?.id).toBe('next');
  });
  it('disables Undo with an explanation when an affected image was removed remotely', async () => {
    const s = services(), saver = await start(s); saver.accept(action('a')); await saver.flush();
    s.current = vi.fn(async () => ({ images: [], location: null }));
    expect(await saver.undo()).toBe(false); expect(s.reverse).not.toHaveBeenCalled();
    expect(saver.view.undoReason).toContain('affected data changed'); expect(saver.view.phase).toBe('saved');
    expect(saver.view.canEdit).toBe(true);
    expect(s.changed).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'saved', canEdit: true }));
  });
  it('refuses a stale cross-tab Undo and preserves the newer durable record', async () => {
    const saver = await start(); saver.accept(action('a')); await saver.flush();
    const other = await start(); other.accept(action('b')); await other.flush();
    expect(await saver.undo()).toBe(false); expect((await db.automatic.get('auto'))?.undo?.id).toBe('b');
  });
  it('retains a stale tab’s newly accepted action durably without overwriting recovery', async () => {
    const first = await start(), stale = await start();
    first.accept(action('a')); await first.flush();
    stale.accept(action('b')); await settle();
    const stored = await db.automatic.get('auto');
    expect(stored?.undo?.id).toBe('a');
    expect(stored?.recoveryBranches?.flatMap(branch => branch.actions.map(a => a.id))).toContain('b');
    expect(stale.view.phase).toBe('conflict');
    const reopened = await start(); expect(reopened.view.phase).toBe('conflict');
    expect(await reopened.flush()).toBe(false);
  });
  it('cannot consume the same Undo concurrently in two tabs', async () => {
    const first = await start(); first.accept(action('a')); await first.flush();
    const second = await start();
    const results = await Promise.all([first.undo(), second.undo()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.automatic.get('auto'))?.undo).toBeNull();
  });
  it('retains a failed Undo claim and consumes it only after reload recovery commits', async () => {
    const s = services(), first = await start(s); first.accept(action('a')); await first.flush();
    s.save = vi.fn(async () => { throw new Error('Denied'); });
    expect(await first.undo()).toBe(false);
    expect(first.record.undo?.id).toBe('a'); expect(first.record.flight?.undoOf).toBe('a');
    first.dispose(); const resumed = await start();
    expect(await resumed.flush()).toBe(true); expect(resumed.record.undo).toBeNull();
  });
  it('isolates account/destination scopes while permitting secret-key repair', () => {
    const cfg = { endpoint: 'https://example.com', accessKey: 'alice', secretKey: 'old', region: 'x', forcePathStyle: true };
    expect(accountScope(cfg)).toBe(accountScope({ ...cfg, secretKey: 'new' }));
    expect(accountScope(cfg)).not.toBe(accountScope({ ...cfg, accessKey: 'bob' }));
    expect(accountScope(cfg)).not.toBe(accountScope({ ...cfg, endpoint: 'https://other.example.com' }));
  });
});


describe('the shared journal boundary across accounts', () => {
  it('serializes different account records for the same upload', async () => {
    let release!: () => void;
    const firstServices = services();
    firstServices.save = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return remote; });
    const first = await start(firstServices); first.accept(action('first')); const saving = first.flush(); await settle();
    const secondServices = services();
    const second = new AutomaticSaver({ ...record(), id: 'other-account', scope: 'other-account' }, secondServices); savers.push(second); await second.open();
    second.accept(action('second')); const following = second.flush(); await settle();
    expect(secondServices.save).not.toHaveBeenCalled(); release();
    expect(await saving).toBe(true); expect(await following).toBe(true);
    expect(firstServices.save).toHaveBeenCalledTimes(1); expect(secondServices.save).toHaveBeenCalledTimes(1);
  });
  it('can discard this account’s blocked intent without deleting another account’s recovery journal', async () => {
    const firstServices = services(); firstServices.save = vi.fn().mockRejectedValue(new Error('Expired credentials'));
    const first = await start(firstServices); first.accept(action('first')); await first.flush();
    const journal = { id: 'bucket::upload/', bucket: 'bucket', uploadPrefix: 'upload/', user: 'Alice', snapshotPrefix: '', startedAt: '', objects: [] };
    await db.syncJournals.put(journal);
    const secondServices = services();
    const second = new AutomaticSaver({ ...record(), id: 'other-account', scope: 'other-account' }, secondServices); savers.push(second); await second.open();
    second.accept(action('second')); expect(await second.flush()).toBe(false);
    expect(second.view.phase).toBe('conflict'); expect(secondServices.save).not.toHaveBeenCalled();
    await second.resolve(false);
    expect(second.record.actions).toEqual([]); expect(second.view.pending).toBe(false); expect(second.view.canEdit).toBe(false);
    expect(secondServices.resolve).not.toHaveBeenCalled(); expect(await db.syncJournals.get(journal.id)).toEqual(journal);
    expect((await db.automatic.get('auto'))?.flight?.ids).toEqual(['first']);
    firstServices.save = vi.fn(async () => remote); expect(await first.retry()).toBe(true);
  });
});

describe('reconnection does not bypass paused recovery', () => {
  it.each([
    ['reload', false], ['reload', true], ['reconnect', false], ['reconnect', true],
  ] as const)('retains legacy review across %s until explicit reapply=%s', async (transition, reapply) => {
    await db.automatic.put({ ...record(), actions: [action('retained')],
      flight: { ids: [], user: 'legacy' }, reviewLegacyAfterFlight: true });
    await db.syncJournals.put({ id: 'bucket::upload/', bucket: 'bucket', uploadPrefix: 'upload/',
      user: 'legacy', snapshotPrefix: '', startedAt: '', objects: [] });
    const originalServices = services();
    let saver = await start(originalServices);
    expect(await saver.flush()).toBe(false);
    expect(originalServices.save).toHaveBeenCalledTimes(1);
    expect(saver.view.phase).toBe('conflict');
    const retained = await db.automatic.get('auto');
    expect(retained?.conflictReason).toContain('interrupted legacy write is recovered');
    expect(retained?.flight).toBeUndefined();
    expect(await db.syncJournals.get('bucket::upload/')).toBeUndefined();
    if (transition === 'reload') { saver.dispose(); saver = await start(); }
    else { saver.setOnline(false); saver.setOnline(true); }
    expect(saver.view.phase).toBe('conflict'); expect(saver.view.canEdit).toBe(false);
    expect(await saver.retry()).toBe(false); expect(await saver.flush()).toBe(false);
    expect(originalServices.save).toHaveBeenCalledTimes(1);
    expect(saver.record.actions.map(a => a.id)).toEqual(['retained']);
    await saver.resolve(reapply);
    expect(saver.view.phase).toBe('saved'); expect(saver.record.actions).toEqual([]);
    expect((await db.automatic.get('auto'))?.conflictReason).toBeUndefined();
  });
  it('keeps offline Retry pending so reconnection still resumes accepted work', async () => {
    const s = services(), saver = await start(s); saver.accept(action('a')); saver.setOnline(false);
    expect(await saver.retry()).toBe(false); expect(saver.view.phase).toBe('pending');
    expect(saver.view.canEdit).toBe(false); saver.setOnline(true); expect(await saver.flush()).toBe(true);
    expect(s.save).toHaveBeenCalledTimes(1);
  });
  it('retains a conflict across reload and reconnection until explicit review', async () => {
    const failing = services(); failing.save = vi.fn().mockRejectedValue(new SaveConflict('changed remotely'));
    const first = await start(failing); first.accept(action('a')); await first.flush(); first.dispose();
    const s = services(), resumed = await start(s);
    expect(resumed.view.phase).toBe('conflict'); resumed.setOnline(false); resumed.setOnline(true);
    expect(await resumed.retry()).toBe(false); expect(await resumed.flush()).toBe(false); expect(s.save).not.toHaveBeenCalled();
    await resumed.resolve(false); expect(resumed.view.phase).toBe('saved'); expect(resumed.record.actions).toEqual([]);
  });
});
