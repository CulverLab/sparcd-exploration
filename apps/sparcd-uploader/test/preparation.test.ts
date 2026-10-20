import { beforeAll, expect, it, vi } from 'vitest';
const storage = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) }; };
Object.assign(globalThis, { window: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, localStorage: storage(), sessionStorage: storage() }) });
const memory = vi.hoisted(() => ({ rows: new Map<string, any>(), fail: false, hold: null as Promise<void> | null, entered: () => {}, puts: 0 }));
vi.mock('@sparcd/flip', async original => ({ ...(await original<typeof import('@sparcd/flip')>()),
  flipDb: { transaction: async (_mode: string, _table: unknown, work: () => Promise<void>) => work(), preparations: { toArray: async () => structuredClone([...memory.rows.values()]), get: async (id: string) => structuredClone(memory.rows.get(id)), put: async (row: any) => { memory.puts++; memory.entered(); await memory.hold; if (memory.fail) throw new Error('QuotaExceededError'); memory.rows.set(row.id, structuredClone(row)); }, delete: async (id: string) => { memory.rows.delete(id); } } },
  loadPreparedSpecies: async () => null,
}));
vi.mock('../src/lib/processPool', () => ({ processBatch: (items: any[], _started: any, result: any) => {
  for (const item of items) result({ id: item.id, sha256: item.file.name === 'edited.jpg' ? 'changed' : 'original', mediaKind: 'image' });
  return { done: Promise.resolve(), cancel() {} };
} }));
let store: typeof import('../src/store')['useStore'];
let journal: typeof import('../src/lib/preparation');
beforeAll(async () => { ({ useStore: store } = await import('../src/store')); journal = await import('../src/lib/preparation'); journal.startPreparationJournal(); });
it('persists only non-secret batch data, survives failed writes, retries, and validates originals before recovery', async () => {
  const file = new File(['original bytes'], 'original.jpg', { lastModified: 123 });
  store.getState().setFiles([{ id: 'SD/a.jpg', relPath: 'SD/a.jpg', fileName: 'a.jpg', size: file.size, mediaKind: 'image', file }]);
  store.setState({ files: [{ ...store.getState().files[0], processState: 'ready', sha256: 'original', manualNaive: { year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 }, manualSource: 'manual', thumbnail: new Blob(['thumb']) }], mountainRange: 'Santa Rita', dateCollected: '2026-07-01', uploadCommentDate: '07-02-2026', uploadDescription: 'preserved notes', uploadTimeZone: 'America/Phoenix', s3Config: { endpoint: 'https://example.test', accessKey: 'person', secretKey: 'NEVER-PERSIST', region: 'us-east-1', forcePathStyle: true } });
  await journal.flushPreparation();
  const saved = (await journal.readPreparation())!;
  expect(saved.files[0].thumbnail).toBeInstanceOf(Blob);
  expect(saved.files[0]).not.toHaveProperty('file');
  expect(JSON.stringify(saved)).not.toContain('NEVER-PERSIST');
  expect(saved.inputs.uploadDescription).toBe('preserved notes');
  expect(saved.inputs).toMatchObject({ mountainRange: 'Santa Rita', dateCollected: '2026-07-01', uploadCommentDate: '07-02-2026' });
  memory.fail = true;
  store.getState().setUploadDescription('pending notes');
  await expect(journal.flushPreparation()).rejects.toThrow('could not be saved');
  expect((await journal.readPreparation())?.inputs.uploadDescription).toBe('preserved notes');
  memory.fail = false; journal.retryPreparation(); await journal.flushPreparation();
  expect((await journal.readPreparation())?.inputs.uploadDescription).toBe('pending notes');
  const scanned = { id: 'SD/a.jpg', relPath: 'SD/a.jpg', fileName: 'a.jpg', size: file.size, mediaKind: 'image' as const, file };
  await expect(journal.recoverPreparation(saved, [])).rejects.toThrow('not in the selected folder');
  await expect(journal.recoverPreparation(saved, [{ ...scanned, file: new File(['changed bytes!'], 'edited.jpg') }])).rejects.toThrow('content hash differs');
  store.setState({ mountainRange: 'Other batch', dateCollected: '2020-01-01', uploadCommentDate: null });
  await journal.recoverPreparation(saved, [scanned]); await journal.flushPreparation();
  expect(store.getState().files[0]).toMatchObject({ sha256: 'original', manualSource: 'manual', manualNaive: saved.files[0].manualNaive });
  expect(store.getState()).toMatchObject({ mountainRange: 'Santa Rita', dateCollected: '2026-07-01', uploadCommentDate: '07-02-2026', uploadDescription: 'preserved notes' });
  store.getState().resetBatch(); await journal.flushPreparation();
  expect(await journal.readPreparation()).toBeNull();
});
it('writes batch-owned keys and never overwrites or clears a sibling journal', async () => {
  const sibling = { id: 'sibling', value: { keep: 'other window' } };
  memory.rows.set('sibling', sibling);
  const file = new File(['bytes'], 'new.jpg');
  store.getState().setFiles([{ id: 'new.jpg', relPath: 'new.jpg', fileName: 'new.jpg', size: file.size, mediaKind: 'image', file }]);
  await journal.flushPreparation();
  const owned = (await journal.readPreparation())!;
  expect(owned.id).not.toBe('active');
  expect(memory.rows.has(owned.id)).toBe(true);
  store.getState().resetBatch(); await journal.flushPreparation();
  expect(memory.rows.has(owned.id)).toBe(false);
  expect(memory.rows.get('sibling')).toEqual(sibling);
  memory.rows.delete('sibling');
});
it('recovers a legacy singleton without losing it until the batch-owned replacement is saved', async () => {
  const file = new File(['original bytes'], 'original.jpg');
  const saved = { v: 1 as const, id: 'legacy-batch', savedAt: new Date().toISOString(), files: [{ id: 'original.jpg', relPath: 'original.jpg', fileName: 'original.jpg', size: file.size, mediaKind: 'image' as const, processState: 'ready' as const, sha256: 'original', lastModified: file.lastModified }], flipId: null, species: null, inputs: { selectedBucket: null, selectedLocationId: null, uploadDescription: 'legacy notes', uploadTimeZone: 'America/Phoenix' } };
  memory.rows.set('active', { id: 'active', value: saved });
  expect((await journal.listPreparations())[0].id).toBe(saved.id);
  store.setState({ mountainRange: 'Unrelated batch', dateCollected: '2020-01-01', uploadCommentDate: '01-02-2020' });
  memory.fail = true;
  await journal.recoverPreparation(saved, [{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image', file }]);
  await expect(journal.flushPreparation()).rejects.toThrow('could not be saved');
  expect(memory.rows.has('active')).toBe(true);
  memory.fail = false; journal.retryPreparation(); await journal.flushPreparation();
  expect(memory.rows.has('active')).toBe(false);
  expect((await journal.listPreparations()).map(item => item.id)).toEqual([saved.id]);
  expect((await journal.readPreparation())?.inputs.uploadDescription).toBe('legacy notes');
  expect(store.getState()).toMatchObject({ mountainRange: '', dateCollected: '', uploadCommentDate: null });
  store.getState().resetBatch(); await journal.flushPreparation();
});
it('reports unsupported journals without deleting them or blocking healthy batch lookup', async () => {
  memory.rows.set('active', { id: 'active', value: { v: 99, files: [] } });
  const file = new File(['original bytes'], 'healthy.jpg');
  store.getState().setFiles([{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image', file }]);
  store.setState({ flipId: 'healthy-flip' });
  await journal.flushPreparation();
  const healthy = (await journal.readPreparation())!;
  const unavailable: string[] = [];
  expect(await journal.listPreparations(id => unavailable.push(id))).toEqual([healthy]);
  expect(unavailable).toEqual(['active']);
  expect(await journal.readPreparationForFlip('healthy-flip')).toEqual(healthy);
  expect(await journal.readPreparationForFlip('not-present')).toBeNull();
  expect(memory.rows.get('active').value.v).toBe(99);
});

it('keeps a damaged matching Flip journal an error rather than adopting incorrect inputs', async () => {
  memory.rows.set('broken-match', { id: 'broken-match', value: { v: 99, flipId: 'broken-flip' } });
  await expect(journal.readPreparationForFlip('broken-flip')).rejects.toThrow('unsupported version');
  expect(memory.rows.has('broken-match')).toBe(true);
});

it('coalesces slow journal writes while retaining final inputs and owned deletion', async () => {
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
  const file = new File(['original bytes'], 'slow.jpg');
  store.getState().setFiles([{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image', file }]);
  await journal.flushPreparation();
  const id = (await journal.readPreparation())!.id;
  const baseline = memory.puts;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  memory.hold = new Promise<void>(resolve => { release = resolve; }); memory.entered = entered;
  store.getState().setUploadDescription('first'); await started;
  for (let i = 0; i < 1000; i++) store.getState().setUploadDescription(`latest ${i}`);
  expect(memory.puts - baseline).toBe(1);
  release(); memory.hold = null; memory.entered = () => {};
  await journal.flushPreparation();
  expect(memory.puts - baseline).toBe(2);
  expect((await journal.readPreparation())?.inputs.uploadDescription).toBe('latest 999');
  store.getState().resetBatch(); await journal.flushPreparation();
  expect(memory.rows.has(id)).toBe(false);
});
it('counts unsupported journals and current unsaved preparation before destructive Disconnect', async () => {
  memory.rows.clear();
  memory.rows.set('unsupported', { id: 'unsupported', value: { v: 99 } });
  const file = new File(['original bytes'], 'pending.jpg');
  memory.fail = true;
  store.getState().setFiles([{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image', file }]);
  await expect(journal.flushPreparation()).rejects.toThrow();
  expect(await journal.countPreparationsForDiscard()).toBe(2);
  memory.fail = false; journal.retryPreparation(); await journal.flushPreparation();
  expect(await journal.countPreparationsForDiscard()).toBe(2);
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
});
it('retains only a verified newly selected handle, and clears an unverified old handle for file reselection', async () => {
  const file = new File(['original bytes'], 'handle.jpg');
  const saved = { v: 1 as const, id: 'handles', savedAt: new Date().toISOString(), files: [{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image' as const, processState: 'ready' as const, sha256: 'original', lastModified: file.lastModified }], flipId: null, species: null, inputs: { selectedBucket: null, selectedLocationId: null, uploadDescription: 'handle notes', uploadTimeZone: 'America/Phoenix' } };
  const handle = { kind: 'directory', name: 'verified-folder' } as FileSystemDirectoryHandle;
  const scanned = [{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image' as const, file }];
  await journal.recoverPreparation(saved, scanned, handle); await journal.flushPreparation();
  expect(store.getState().dirHandle).toBe(handle);
  const stored = (await journal.readPreparation())!;
  expect(stored.dirHandle).toEqual(handle);
  await expect(journal.recoverPreparation(stored, [], { name: 'unverified' } as FileSystemDirectoryHandle)).rejects.toThrow();
  expect(store.getState().dirHandle).toBe(handle);
  await journal.recoverPreparation(stored, scanned); await journal.flushPreparation();
  expect(store.getState().dirHandle).toBeNull();
  expect((await journal.readPreparation())?.dirHandle).toBeUndefined();
});

async function savedBatch(name = 'B.jpg') {
  store.setState({ activeSnap: null });
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
  const file = new File(['original bytes'], name);
  store.getState().setFiles([{ id: name, relPath: name, fileName: name, size: file.size, mediaKind: 'image', file }]);
  store.getState().setUploadDescription('B notes');
  await journal.flushPreparation();
  return (await journal.readPreparation())!;
}
function snapshot(preparationId: string | undefined, phase: 'done' | 'error' | 'partial' | 'idle' = 'done', dryRun = false) {
  return { sessionId: 'upload-A', preparationId, phase, dryRun } as import('../src/lib/upload').UploadSnapshot;
}
it.each([undefined, 'preparation-A'])('retains current B when History completes A with owner %s', async owner => {
  const b = await savedBatch();
  const a = { ...b, id: 'preparation-A', inputs: { ...b.inputs, uploadDescription: 'A notes' } };
  memory.rows.set(a.id, { id: a.id, value: a });
  store.setState({ activeSnap: snapshot(owner) }); await journal.flushPreparation();
  expect(await journal.readPreparation()).toEqual(b);
  expect(memory.rows.has(b.id)).toBe(true);
  expect(memory.rows.has(a.id)).toBe(owner === undefined);
});
it.each([['dry run', 'done', true], ['failure', 'error', false], ['cancelled partial', 'partial', false]] as const)('retains owned preparation after %s', async (_label, phase, dryRun) => {
  const b = await savedBatch();
  store.setState({ activeSnap: snapshot(b.id, phase, dryRun) }); await journal.flushPreparation();
  expect(await journal.readPreparation()).toEqual(b);
});
it('deletes only the published owner once and preserves later inputs and batches under a lingering done snapshot', async () => {
  const b = await savedBatch();
  expect(journal.preparationIdForUpload()).toBe(b.id);
  memory.rows.set('sibling', { id: 'sibling', value: { keep: true } });
  store.setState({ activeSnap: snapshot(b.id) }); await journal.flushPreparation();
  expect(memory.rows.has(b.id)).toBe(false);
  expect(memory.rows.has('sibling')).toBe(true);
  expect(await journal.readPreparation()).toBeNull();
  store.getState().setUploadDescription('Later notes'); await journal.flushPreparation();
  const later = (await journal.readPreparation())!;
  expect(later.id).not.toBe(b.id);
  store.setState({ activeSnap: { ...snapshot(b.id), version: 99 } }); await journal.flushPreparation();
  expect(await journal.readPreparation()).toEqual(later);
  const file = new File(['original bytes'], 'C.jpg');
  store.getState().setFiles([{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image', file }]);
  await journal.flushPreparation();
  expect((await journal.readPreparation())?.files[0].fileName).toBe('C.jpg');
});
it('queues owned completion after an in-flight save and does not resurrect it on retry', async () => {
  const b = await savedBatch();
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  memory.hold = new Promise<void>(resolve => { release = resolve; }); memory.entered = entered;
  store.getState().setUploadDescription('In-flight notes'); await started;
  store.getState().setUploadDescription('Pending notes');
  store.setState({ activeSnap: snapshot(b.id) });
  release(); memory.hold = null; memory.entered = () => {};
  await journal.flushPreparation(); journal.retryPreparation(); await journal.flushPreparation();
  expect(memory.rows.has(b.id)).toBe(false);
});
