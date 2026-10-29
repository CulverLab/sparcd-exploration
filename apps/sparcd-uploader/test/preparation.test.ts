import { beforeAll, expect, it, vi } from 'vitest';
const storage = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) }; };
Object.assign(globalThis, { window: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, localStorage: storage(), sessionStorage: storage() }) });
const memory = vi.hoisted(() => ({ rows: new Map<string, any>(), flips: new Map<string, any>(), removals: new Map<string, any>(), fail: false, failIntent: false, failAtomicStage: '' as '' | 'preparation' | 'flip', inTransaction: false, hold: null as Promise<void> | null, entered: () => {}, ownerHold: null as Promise<void> | null, ownerEntered: () => {}, ownerScope: 'flip-owner-v1:' + 'a'.repeat(64), puts: 0 }));
vi.mock('@sparcd/flip', async original => ({ ...(await original<typeof import('@sparcd/flip')>()),
  deriveFlipOwnerScope: async () => { memory.ownerEntered(); await memory.ownerHold; return memory.ownerScope; },
  flipDb: { transaction: async (_mode: string, ...args: any[]) => { const work = args.at(-1); const rows = structuredClone([...memory.rows]); const flips = structuredClone([...memory.flips]); const removals = structuredClone([...memory.removals]); memory.inTransaction = true; try { return await work(); } catch (error) { memory.rows = new Map(rows); memory.flips = new Map(flips); memory.removals = new Map(removals); throw error; } finally { memory.inTransaction = false; } }, preparations: { toArray: async () => structuredClone([...memory.rows.values()]), get: async (id: string) => structuredClone(memory.rows.get(id)), put: async (row: any) => { memory.puts++; memory.entered(); await memory.hold; if (memory.fail || memory.inTransaction && memory.failAtomicStage === 'preparation') throw new Error('QuotaExceededError'); memory.rows.set(row.id, structuredClone(row)); }, delete: async (id: string) => { memory.rows.delete(id); } }, records: { get: async (id: string) => structuredClone(memory.flips.get(id)), put: async (row: any) => { if (memory.inTransaction && memory.failAtomicStage === 'flip') throw new Error('QuotaExceededError'); memory.flips.set(row.id, structuredClone(row)); } }, removalIntents: { toArray: async () => structuredClone([...memory.removals.values()]), get: async (id: string) => structuredClone(memory.removals.get(id)), put: async (row: any) => { if (memory.failIntent) throw new Error('QuotaExceededError'); memory.removals.set(row.id, structuredClone(row)); }, delete: async (id: string) => { memory.removals.delete(id); } } },
  loadPreparedSpecies: async () => null,
  readFlipRecord: async (id: string, ownerScope?: string) => { const record = memory.flips.get(id); return record && (!ownerScope || record.ownerScope === ownerScope) ? record : null; },
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

it.each(['reselect', 'handle'])('restores verified tagged files from a mixed %s selection and retains retryable verification records', async path => {
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
  const original = new File(['original bytes'], 'original.jpg', { lastModified: 123 });
  const saved = { v: 1 as const, id: `mixed-${path}`, savedAt: new Date().toISOString(),
    files: ['good.jpg', 'missing.jpg', 'changed.jpg', 'size.jpg'].map(name => ({
      id: `SD/${name}`, relPath: `SD/${name}`, fileName: name, size: original.size,
      mediaKind: 'image' as const, processState: 'ready' as const, sha256: 'original', lastModified: 123,
      manualSource: 'manual' as const, manualNaive: { year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 },
      thumbnail: new Blob(['thumb']), preTags: [{ scientificName: 'Saved species', commonName: 'Saved', count: 2, requestedSpecies: '', freeTags: '' }], preTaggerUser: 'Original Tagger',
    })), flipId: 'mixed-flip', ownerScope: memory.ownerScope, species: null,
    inputs: { selectedBucket: null, selectedLocationId: null, uploadDescription: 'mixed notes', uploadTimeZone: 'America/Phoenix' } };
  const tags = { scientificName: 'Canis latrans', commonName: 'Coyote', count: 7, requestedSpecies: '', freeTags: '' };
  memory.flips.set('mixed-flip', { ownerScope: memory.ownerScope, tags: { 'SD/good.jpg': [tags] }, taggerUser: 'Returning Tagger' });
  memory.rows.set(saved.id, { id: saved.id, value: structuredClone(saved) });
  const selected = [
    { id: 'SD/good.jpg', relPath: 'SD/good.jpg', fileName: 'good.jpg', mediaKind: 'image' as const, size: original.size, file: original },
    { id: 'SD/changed.jpg', relPath: 'SD/changed.jpg', fileName: 'changed.jpg', mediaKind: 'image' as const, size: original.size, file: new File(['changed bytes!'], 'edited.jpg') },
    { id: 'SD/size.jpg', relPath: 'SD/size.jpg', fileName: 'size.jpg', mediaKind: 'image' as const, size: 1, file: new File(['x'], 'small.jpg') },
  ];
  const handle = Object.defineProperties({ kind: 'directory', name: 'SD' }, {
    queryPermission: { value: async () => 'granted' },
    values: { value: async function* () {
      for (const file of selected) yield { kind: 'file', name: file.fileName, getFile: async () => file.file };
    } },
  }) as unknown as FileSystemDirectoryHandle;
  if (path === 'handle') await journal.recoverPreparationFromHandle({ ...saved, dirHandle: handle });
  else await journal.recoverPreparation(saved, selected);
  await journal.flushPreparation();
  const files = store.getState().files;
  expect(files).toHaveLength(4);
  expect(files[0]).toMatchObject({ processState: 'ready', preTags: [tags], preTaggerUser: 'Returning Tagger', sha256: 'original', manualNaive: saved.files[0].manualNaive });
  expect(await files[0].file.text()).toBe('original bytes');
  for (const file of files.slice(1)) {
    expect(file).toMatchObject({ processState: 'error', needsOriginal: true, sha256: 'original', preTags: saved.files[0].preTags });
    expect(file.file.size).toBe(0); expect(store.getState().validations[file.id].severity).toBe('error');
  }
  expect(files[1].processError).toContain('not in the selected folder');
  expect(files[2].processError).toContain('content hash differs');
  expect(files[3].processError).toContain('size differs');
  const retained = (await journal.listPreparations()).find(row => row.id === saved.id)!;
  expect(retained.files.map(file => file.relPath)).toEqual(saved.files.map(file => file.relPath));
  expect(retained.files.every(file => file.sha256 === 'original' && file.lastModified === 123)).toBe(true);
  await journal.recoverPreparation(retained, saved.files.map(file => ({ ...file, file: original })));
  await journal.flushPreparation();
  expect(store.getState().files.every(file => file.processState === 'ready' && !file.needsOriginal && !file.processError)).toBe(true);
  expect(store.getState().files[0].preTags).toEqual([tags]);
  memory.flips.clear(); store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
});
it('restores the latest Tagger tags during offline preparation recovery using its saved owner scope', async () => {
  const file = new File(['original bytes'], 'offline.jpg', { lastModified: 123 });
  const tag = { scientificName: 'Canis latrans', commonName: 'Coyote', count: 4, requestedSpecies: '', freeTags: '' };
  const saved = { v: 1 as const, id: 'offline-tagged-recovery', savedAt: new Date().toISOString(),
    files: [{ id: 'SD/offline.jpg', relPath: 'SD/offline.jpg', fileName: 'offline.jpg', size: file.size, mediaKind: 'image' as const, processState: 'ready' as const, sha256: 'original', lastModified: file.lastModified, preTags: [] }],
    flipId: 'offline-tagged-flip', species: null,
    inputs: { selectedBucket: null, selectedLocationId: null, uploadDescription: 'offline tags', uploadTimeZone: 'America/Phoenix' } };
  memory.rows.set(saved.id, { id: saved.id, value: structuredClone(saved) });
  memory.flips.set(saved.flipId, { id: saved.flipId, ownerScope: memory.ownerScope, files: [], tags: { 'SD/offline.jpg': [tag] }, taggerUser: 'Latest Tagger', preparedSpecies: null });
  const token = store.getState().batchToken;
  journal.bindCurrentPreparationSpecies(null, saved.id);
  store.setState({ s3Config: null, files: [{ ...saved.files[0], file, processState: 'ready' }], flipId: saved.flipId, batchToken: token + 1 });
  await journal.flushPreparation();
  const persisted = memory.rows.get(saved.id).value;
  expect(persisted.ownerScope).toBe(memory.ownerScope);

  await journal.recoverPreparation(persisted, [{ id: 'SD/offline.jpg', relPath: 'SD/offline.jpg', fileName: file.name, size: file.size, mediaKind: 'image', file }]);
  await journal.flushPreparation();

  expect(store.getState().files[0]).toMatchObject({ preTags: [tag], preTaggerUser: 'Latest Tagger' });
  expect(memory.rows.get(saved.id).value.ownerScope).toBe(memory.ownerScope);
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear(); memory.flips.clear();
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

it('does not replace a batch-bound legacy catalog with a newly refreshed master catalog', async () => {
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
  const legacy = { v: 2 as const, endpoint: 'https://legacy.test', ownerScope: 'flip-owner-v1:' + 'a'.repeat(64), collectionKey: 'legacy::one', collectionName: 'Legacy', sourceBucket: 'legacy', sourceKey: 'Collections/one/species.json', sourceHash: 'a'.repeat(64), preparedAt: new Date().toISOString(), profileId: 'legacy', overrides: {}, species: [{ key:'Legacy species',scientificName:'Legacy species',commonName:'Legacy',iconUrl:'',keyBinding:null }] };
  await journal.acceptPreparationSpecies(legacy);
  const file = new File(['bytes'], 'legacy.jpg');
  store.getState().setFiles([{id:'SD/legacy.jpg',relPath:'SD/legacy.jpg',fileName:'legacy.jpg',size:file.size,mediaKind:'image',file}]);
  await journal.flushPreparation();
  await journal.acceptPreparationSpecies({...legacy,collectionKey:'Settings/species.json',sourceKey:'Settings/species.json',collectionName:'Master',species:[{...legacy.species[0],key:'New species',scientificName:'New species'}]});
  await journal.flushPreparation();
  expect((await journal.readPreparation())?.species).toEqual(legacy);
  store.getState().resetBatch();await journal.flushPreparation();memory.rows.clear();
});

it('retains an unreadable future batch catalog rather than overwriting it during automatic refresh', async () => {
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
  const future = {v:99,keep:'future catalog'} as any;
  journal.bindCurrentPreparationSpecies(future, 'future-catalog-batch');
  const file=new File(['bytes'],'future.jpg');
  store.getState().setFiles([{id:'SD/future.jpg',relPath:'SD/future.jpg',fileName:'future.jpg',size:file.size,mediaKind:'image',file}]);
  await journal.flushPreparation();
  await journal.acceptPreparationSpecies({v:2,endpoint:'https://master.test',ownerScope:'flip-owner-v1:'+'a'.repeat(64),collectionKey:'Settings/species.json',collectionName:'Master',sourceBucket:'settings',sourceKey:'Settings/species.json',sourceHash:'a'.repeat(64),preparedAt:new Date().toISOString(),profileId:'master',overrides:{},species:[{key:'New',scientificName:'New',commonName:'New',iconUrl:'',keyBinding:null}]});
  await journal.flushPreparation();
  expect((await journal.readPreparation())?.species).toEqual(future);
  store.getState().resetBatch();await journal.flushPreparation();memory.rows.clear();
});

it('uses a refreshed master list for an immediately selected next batch without replacing the current batch catalog', async () => {
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
  const old = { v: 2 as const, endpoint: 'https://master.test', ownerScope: 'flip-owner-v1:' + 'a'.repeat(64), collectionKey: 'Settings/species.json', collectionName: 'Master', sourceBucket: 'settings', sourceKey: 'Settings/species.json', sourceHash: 'a'.repeat(64), preparedAt: new Date().toISOString(), profileId: 'master', overrides: {}, species: [{ key: 'Old', scientificName: 'Old', commonName: 'Old', iconUrl: '', keyBinding: null }] };
  const fresh = { ...old, sourceHash: 'b'.repeat(64), species: [...old.species, { ...old.species[0], key: 'New', scientificName: 'New', commonName: 'New' }] };
  const select = (name: string) => {
    const file = new File(['bytes'], name);
    store.getState().setFiles([{ id: name, relPath: name, fileName: name, size: file.size, mediaKind: 'image', file }]);
  };
  await journal.acceptPreparationSpecies(old);
  select('A.jpg'); await journal.flushPreparation();
  const a = (await journal.readPreparation())!;
  await journal.acceptPreparationSpecies(fresh); await journal.flushPreparation();
  expect(await journal.readPreparation()).toEqual(a);
  expect(a.species).toEqual(old);
  // No intervening cache read or component effect may be required for B.
  store.getState().resetBatch(); select('B.jpg');
  await journal.flushPreparation();
  expect((await journal.readPreparation())?.species).toEqual(fresh);
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear();
});

function seedMissingRemoval(id: string, withFlip = true, onlyMissing = false) {
  const missing = { id: 'SD/MISSING.JPG', relPath: 'SD/MISSING.JPG', fileName: 'MISSING.JPG', size: 12, lastModified: 123, mediaKind: 'image' as const, processState: 'error' as const, sha256: 'hash-missing', needsOriginal: true, processError: 'not in the selected folder' };
  const good = { id: 'SD/GOOD.JPG', relPath: 'SD/GOOD.JPG', fileName: 'GOOD.JPG', size: 8, lastModified: 124, mediaKind: 'image' as const, processState: 'ready' as const, sha256: 'hash-good' };
  const files = onlyMissing ? [missing] : [missing, good];
  const saved = { v: 1 as const, id, savedAt: new Date().toISOString(), files, flipId: withFlip ? `flip-${id}` : null, ...(withFlip ? { ownerScope: memory.ownerScope } : {}), species: null, inputs: { selectedBucket: null, selectedLocationId: null, uploadDescription: 'saved note', uploadTimeZone: 'America/Phoenix' } };
  memory.rows.set(id, { id, value: structuredClone(saved) });
  if (withFlip) memory.flips.set(saved.flipId!, { id: saved.flipId!, v: 2, createdAt: new Date().toISOString(), returnUrl: '/uploader/', ownerScope: memory.ownerScope, files, tags: { 'SD/MISSING.JPG': [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 1, requestedSpecies: '', freeTags: '' }], ...(onlyMissing ? {} : { 'SD/GOOD.JPG': [] }) }, revision: 4 });
  store.setState({ files: files.map(file => ({ ...file, file: new File(file === missing ? [] : ['goodfile'], file.fileName) })), flipId: saved.flipId, batchToken: 902, s3Config: { endpoint: 'https://example.test', accessKey: 'person', secretKey: 'secret', region: 'us-east-1', forcePathStyle: true } });
  journal.bindCurrentPreparationSpecies(null, id);
  // adoptTaggedBatch advances the token after binding the local preparation.
  store.setState({ batchToken: 903 });
  return { saved, missing };
}
it('does not let a pending removal affect a replacement batch that reuses the file identity', async () => {
  const { saved } = seedMissingRemoval('remove-batch-switch-race');
  await journal.flushPreparation();
  let releaseOwner!: () => void;
  let notifyOwnerCheck!: () => void;
  memory.ownerHold = new Promise<void>(resolve => { releaseOwner = resolve; });
  const ownerCheckStarted = new Promise<void>(resolve => { notifyOwnerCheck = resolve; });
  memory.ownerEntered = notifyOwnerCheck;

  const removal = journal.removeMissingOriginal('SD/MISSING.JPG');
  await ownerCheckStarted;
  const replacement = new File(['replacement bytes'], 'MISSING.JPG', { lastModified: 999 });
  store.getState().setFiles([{ id: 'SD/MISSING.JPG', relPath: 'SD/MISSING.JPG', fileName: 'MISSING.JPG', size: replacement.size, mediaKind: 'image', file: replacement }]);
  const replacementEntry = store.getState().files[0];
  store.setState({ files: [{ ...replacementEntry, size: 12, processState: 'error', sha256: 'hash-missing', needsOriginal: true, processError: 'not in the selected folder' }] });

  releaseOwner();
  await expect(removal).rejects.toThrow('batch or connection changed');
  await journal.flushPreparation();
  expect(store.getState().files).toHaveLength(1);
  expect(store.getState().files[0]).toMatchObject({ relPath: 'SD/MISSING.JPG', needsOriginal: true, sha256: 'hash-missing' });
  expect(memory.removals.size).toBe(0);
  expect(memory.rows.get(saved.id).value.files).toHaveLength(2);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(2);
  expect(journal.isAnyMissingRemovalPending()).toBe(false);

  memory.ownerHold = null; memory.ownerEntered = () => {};
  store.getState().resetBatch(); await journal.flushPreparation(); memory.rows.clear(); memory.flips.clear();
});
it('journals a missing-file removal before atomically removing its preparation, Flip file, and tags', async () => {
  const { saved } = seedMissingRemoval('remove-success');
  await journal.flushPreparation();
  await journal.removeMissingOriginal('SD/MISSING.JPG');
  const preparation = (await journal.readPreparation())!;
  const flip = memory.flips.get(saved.flipId!)!;
  expect(preparation.files.map(file => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(flip.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(flip.tags).not.toHaveProperty('SD/MISSING.JPG');
  expect(flip.tags['SD/GOOD.JPG']).toEqual([]);
  expect(flip.ownerScope).toBe(memory.ownerScope);
  expect(flip.revision).toBe(5);
  expect(flip.returnUrl).toBe('/uploader/');
  expect([...memory.removals.values()].find(row => row.value.preparationId === saved.id)?.value.appliedAt).toBeTruthy();
  expect(store.getState().files.map(file => file.relPath)).toEqual(['SD/GOOD.JPG']);
});
it.each(['preparation', 'flip'] as const)('keeps both records unchanged and replays the durable intent after a %s update failure', async stage => {
  const { saved } = seedMissingRemoval(`remove-failure-${stage}`);
  await journal.flushPreparation();
  memory.failAtomicStage = stage;
  await expect(journal.removeMissingOriginal('SD/MISSING.JPG')).rejects.toThrow('QuotaExceededError');
  expect([...memory.removals.values()].filter(row => row.value.preparationId === saved.id && !row.value.appliedAt)).toHaveLength(1);
  expect(memory.rows.get(saved.id).value.files).toHaveLength(2);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(2);
  expect(journal.isMissingRemovalPending('SD/MISSING.JPG')).toBe(true);
  memory.failAtomicStage = '';
  await journal.retryMissingOriginalRemovals();
  expect(memory.rows.get(saved.id).value.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(memory.flips.get(saved.flipId!)!.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(memory.flips.get(saved.flipId!)!.tags).not.toHaveProperty('SD/MISSING.JPG');
  expect([...memory.removals.values()].find(row => row.value.preparationId === saved.id)?.value.appliedAt).toBeTruthy();
  expect(store.getState().files.map(file => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(journal.isMissingRemovalPending('SD/MISSING.JPG')).toBe(false);
});
it('leaves a missing original visible when the durable removal intent cannot be written', async () => {
  const { saved } = seedMissingRemoval('remove-journal-fails');
  await journal.flushPreparation();
  memory.failIntent = true;
  await expect(journal.removeMissingOriginal('SD/MISSING.JPG')).rejects.toThrow('QuotaExceededError');
  expect(store.getState().files.some(file => file.id === 'SD/MISSING.JPG')).toBe(true);
  expect(journal.isMissingRemovalPending('SD/MISSING.JPG')).toBe(false);
  expect([...memory.removals.values()].some(row => row.value.preparationId === saved.id)).toBe(false);
  expect(memory.rows.get(saved.id).value.files).toHaveLength(2);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(2);
  memory.failIntent = false;
  await journal.retryMissingOriginalRemovals();
  expect(memory.rows.get('remove-journal-fails').value.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(store.getState().files.map(file => file.relPath)).toEqual(['SD/GOOD.JPG']);
});
it('does not let a pre-intent Retry target a different batch that reuses the file id', async () => {
  const { saved } = seedMissingRemoval('remove-retry-scope', false);
  await journal.flushPreparation();
  memory.failIntent = true;
  await expect(journal.removeMissingOriginal('SD/MISSING.JPG')).rejects.toThrow('QuotaExceededError');
  memory.failIntent = false;
  journal.bindCurrentPreparationSpecies(null, 'another-batch');
  await expect(journal.retryMissingOriginalRemovals()).rejects.toThrow('batch changed');
  expect(memory.rows.get(saved.id).value.files).toHaveLength(2);
  expect(store.getState().files.some(file => file.id === 'SD/MISSING.JPG')).toBe(true);
});
it('replays a durable removal during preparation loading after a prior transaction failure', async () => {
  const { saved } = seedMissingRemoval('remove-reload-replay');
  await journal.flushPreparation();
  memory.failAtomicStage = 'flip';
  await expect(journal.removeMissingOriginal('SD/MISSING.JPG')).rejects.toThrow('QuotaExceededError');
  memory.failAtomicStage = '';
  // listPreparations is the startup gate: it replays the journal before it
  // returns any recoverable preparation to the UI.
  await journal.listPreparations();
  expect(memory.rows.get(saved.id).value.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(memory.flips.get(saved.flipId!)!.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect([...memory.removals.values()].find(row => row.value.preparationId === saved.id)?.value.appliedAt).toBeTruthy();
});
it.each(['preparation', 'flip'] as const)('keeps a replacement at the same path in the %s and surfaces an identity conflict during replay', async source => {
  const { saved } = seedMissingRemoval(`remove-conflict-${source}`);
  await journal.flushPreparation();
  if (source === 'preparation') {
    const replacement = memory.rows.get(saved.id);
    replacement.value.files[0] = { ...replacement.value.files[0], sha256: 'different-content' };
    memory.rows.set(saved.id, replacement);
  } else {
    const replacement = memory.flips.get(saved.flipId!)!;
    replacement.files[0] = { ...replacement.files[0], sha256: 'different-content' };
    memory.flips.set(saved.flipId!, replacement);
  }
  const intent = { v: 1, id: 'remove-conflict-intent', preparationId: saved.id, flipId: saved.flipId, ownerScope: memory.ownerScope, relPath: 'SD/MISSING.JPG', size: 12, sha256: 'hash-missing', createdAt: new Date().toISOString() };
  memory.removals.set(intent.id, { id: intent.id, value: intent });
  await expect(journal.readPreparation()).rejects.toThrow('different file at SD/MISSING.JPG');
  expect(memory.rows.get(saved.id).value.files).toHaveLength(2);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(2);
  expect(source === 'preparation' ? memory.rows.get(saved.id).value.files[0].sha256 : memory.flips.get(saved.flipId!)!.files[0].sha256).toBe('different-content');
  expect(memory.removals.get(intent.id)?.value.appliedAt).toBeUndefined();
  memory.removals.clear();
});
it('retains a durable intent when the active login does not own its Flip handoff', async () => {
  const { saved } = seedMissingRemoval('remove-owner-conflict');
  await journal.flushPreparation();
  const intent = { v: 1, id: 'remove-owner-intent', preparationId: saved.id, flipId: saved.flipId, ownerScope: 'another-owner', relPath: 'SD/MISSING.JPG', size: 12, sha256: 'hash-missing', createdAt: new Date().toISOString() };
  memory.removals.set(intent.id, { id: intent.id, value: intent });
  await expect(journal.readPreparation()).rejects.toThrow('different connected login');
  expect(memory.rows.get(saved.id).value.files).toHaveLength(2);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(2);
  expect(memory.removals.get(intent.id)?.value.appliedAt).toBeUndefined();
  memory.removals.clear();
});
it('marks a replayed intent applied idempotently when both saved records already omit that identity', async () => {
  const { saved } = seedMissingRemoval('remove-idempotent');
  await journal.flushPreparation();
  const preparation = memory.rows.get(saved.id);
  preparation.value.files = preparation.value.files.filter((file: any) => file.relPath !== 'SD/MISSING.JPG');
  memory.rows.set(saved.id, preparation);
  const flip = memory.flips.get(saved.flipId!)!;
  flip.files = flip.files.filter((file: any) => file.relPath !== 'SD/MISSING.JPG');
  delete flip.tags['SD/MISSING.JPG'];
  memory.flips.set(saved.flipId!, flip);
  const intent = { v: 1, id: 'remove-idempotent-intent', preparationId: saved.id, flipId: saved.flipId, ownerScope: memory.ownerScope, relPath: 'SD/MISSING.JPG', size: 12, sha256: 'hash-missing', createdAt: new Date().toISOString() };
  memory.removals.set(intent.id, { id: intent.id, value: intent });
  await journal.listPreparations();
  expect(memory.removals.get(intent.id)?.value.appliedAt).toBeTruthy();
  expect(memory.rows.get(saved.id).value.files).toHaveLength(1);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(1);
});

it('keeps an unrelated preparation available when a sibling removal has an owner conflict', async () => {
  memory.rows.clear(); memory.flips.clear(); memory.removals.clear();
  const { saved } = seedMissingRemoval('remove-sibling-owner-conflict');
  const healthy = { ...structuredClone(saved), id: 'healthy-sibling', flipId: null, files: saved.files.map(file => ({ ...file, id: `healthy/${file.fileName}`, relPath: `healthy/${file.fileName}` })) };
  memory.rows.set(healthy.id, { id: healthy.id, value: healthy });
  const intent = { v: 1, id: 'sibling-owner-intent', preparationId: saved.id, flipId: saved.flipId, ownerScope: 'another-owner', relPath: 'SD/MISSING.JPG', size: 12, sha256: 'hash-missing', createdAt: new Date().toISOString() };
  memory.removals.set(intent.id, { id: intent.id, value: intent });
  const unavailable: string[] = [];
  const available = await journal.listPreparations(id => unavailable.push(id));
  expect(available.map(item => item.id)).toEqual(['healthy-sibling']);
  expect(unavailable).toEqual([saved.id]);
  expect(memory.rows.get(healthy.id).value.files).toHaveLength(2);
  expect(memory.removals.get(intent.id)?.value.appliedAt).toBeUndefined();
  memory.removals.delete(intent.id);
  memory.rows.clear(); memory.flips.clear(); memory.removals.clear();
  memory.rows.delete(healthy.id);
});

it('does not let an older tab autosave a removed original back into its preparation', async () => {
  const { saved } = seedMissingRemoval('remove-stale-tab-autosave');
  await journal.flushPreparation();
  const staleFiles = [...store.getState().files];
  await journal.removeMissingOriginal('SD/MISSING.JPG');
  expect(memory.rows.get(saved.id).value.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  // Another tab still has the original two-file snapshot and makes an unrelated
  // metadata edit. Its autosave must preserve the durable removal tombstone.
  store.setState({ files: staleFiles, uploadDescription: 'edited in stale tab' });
  await journal.flushPreparation();
  expect(memory.rows.get(saved.id).value.files.map((file: any) => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(memory.rows.get(saved.id).value.inputs.uploadDescription).toBe('edited in stale tab');
  expect([...memory.removals.values()].some(row => row.value.preparationId === saved.id && row.value.appliedAt)).toBe(true);
});

it('clears the pending row in this tab when Retry finds that another tab already applied its removal', async () => {
  const { saved } = seedMissingRemoval('remove-applied-in-other-tab');
  await journal.flushPreparation();
  memory.failAtomicStage = 'flip';
  await expect(journal.removeMissingOriginal('SD/MISSING.JPG')).rejects.toThrow('QuotaExceededError');
  expect(journal.isMissingRemovalPending('SD/MISSING.JPG')).toBe(true);

  // Simulate the other tab's successful atomic transaction and durable marker.
  memory.failAtomicStage = '';
  const intentRow = [...memory.removals.values()].find(row => row.value.preparationId === saved.id)!;
  const intent = intentRow.value;
  const preparation = memory.rows.get(saved.id);
  preparation.value.files = preparation.value.files.filter((file: any) => file.relPath !== intent.relPath);
  memory.rows.set(saved.id, preparation);
  const flip = memory.flips.get(saved.flipId!)!;
  flip.files = flip.files.filter((file: any) => file.relPath !== intent.relPath);
  delete flip.tags[intent.relPath];
  memory.flips.set(saved.flipId!, flip);
  memory.removals.set(intent.id, { id: intent.id, value: { ...intent, appliedAt: new Date().toISOString() } });

  await journal.retryMissingOriginalRemovals();
  expect(store.getState().files.map(file => file.relPath)).toEqual(['SD/GOOD.JPG']);
  expect(journal.isMissingRemovalPending('SD/MISSING.JPG')).toBe(false);
  expect(memory.flips.get(saved.flipId!)!.tags).not.toHaveProperty('SD/MISSING.JPG');
});

it('keeps a pending last-file removal recoverable through autosave until replay updates both journals', async () => {
  const { saved } = seedMissingRemoval('remove-pending-last-file', true, true);
  await journal.flushPreparation();
  memory.failAtomicStage = 'flip';
  await expect(journal.removeMissingOriginal('SD/MISSING.JPG')).rejects.toThrow('QuotaExceededError');

  // An unrelated edit causes the older tab's normal autosave while the intent
  // is still pending; it must not treat that intent as a completed tombstone.
  store.getState().setUploadDescription('edited while removal is pending');
  await journal.flushPreparation();
  expect(memory.rows.get(saved.id).value.files.map((file: any) => file.relPath)).toEqual(['SD/MISSING.JPG']);
  expect(memory.rows.get(saved.id).value.inputs.uploadDescription).toBe('edited while removal is pending');
  expect(memory.flips.get(saved.flipId!)!.files.map((file: any) => file.relPath)).toEqual(['SD/MISSING.JPG']);
  expect(memory.flips.get(saved.flipId!)!.tags).toHaveProperty('SD/MISSING.JPG');

  memory.failAtomicStage = '';
  await journal.listPreparations();
  expect(memory.rows.has(saved.id)).toBe(false);
  expect(memory.flips.get(saved.flipId!)!.files).toHaveLength(0);
  expect(memory.flips.get(saved.flipId!)!.tags).not.toHaveProperty('SD/MISSING.JPG');
  expect([...memory.removals.values()].find(row => row.value.preparationId === saved.id)?.value.appliedAt).toBeTruthy();
});
