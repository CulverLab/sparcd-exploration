import { beforeAll, expect, it, vi } from 'vitest';
const storage = () => { const entries = new Map<string, string>(); return { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v), removeItem: (k: string) => entries.delete(k) }; };
Object.assign(globalThis, { window: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, localStorage: storage(), sessionStorage: storage() }) });
const pending = vi.hoisted(() => ({ resolve: (_value: any) => {} }));
vi.mock('../src/lib/resume', () => ({
  reselectFolder: () => new Promise(resolve => { pending.resolve = resolve; }),
  reconcileReselect: () => new Promise(resolve => { pending.resolve = resolve; }),
  restoreFromHandle: () => new Promise(resolve => { pending.resolve = resolve; }),
}));
vi.mock('@sparcd/flip', async original => ({ ...(await original<typeof import('@sparcd/flip')>()), readFlipRecord: async () => null }));
let store: typeof import('../src/store')['useStore'];
let journal: typeof import('../src/lib/preparation');
let flip: typeof import('../src/lib/flip');
beforeAll(async () => { ({ useStore: store } = await import('../src/store')); journal = await import('../src/lib/preparation'); flip = await import('../src/lib/flip'); });
const original = new File(['original'], 'old.jpg');
const oldFile = { id: 'old.jpg', relPath: 'old.jpg', fileName: 'old.jpg', size: original.size, lastModified: original.lastModified, mediaKind: 'image' as const, processState: 'ready' as const, sha256: 'original' };
const saved = { v: 1 as const, id: 'old', savedAt: new Date().toISOString(), files: [oldFile], flipId: null, species: null, inputs: { selectedBucket: null, selectedLocationId: null, uploadDescription: 'old private notes', uploadTimeZone: 'America/Phoenix' } };
const record = { id: 'old', v: 1 as const, createdAt: saved.savedAt, returnUrl: '', dirHandle: {} as FileSystemDirectoryHandle, files: [oldFile], tags: {} };
for (const path of ['folder reselect', 'folder handle', 'Flip reselect', 'Flip handle', 'Flip picker'] as const) {
  for (const change of ['Disconnect', 'new batch', 'account switch', 'Start over'] as const) {
    it(`${path} does not restore stale files or inputs after ${change}`, async () => {
      const recovery = path === 'folder reselect' ? journal.recoverPreparation(saved, [])
        : path === 'folder handle' ? journal.recoverPreparationFromHandle(saved)
        : path === 'Flip reselect' ? flip.adoptReselected(record, [])
        : path === 'Flip picker' ? flip.reselectFlip(record) : flip.adoptRecord(record);
      // Observe rejection before releasing the delayed verification.
      const rejected = expect(recovery).rejects.toThrow('batch or connection changed');
      if (change === 'Disconnect') store.getState().disconnect();
      if (change === 'new batch') {
        const file = new File(['replacement'], 'new.jpg');
        store.getState().setFiles([{ id: file.name, relPath: file.name, fileName: file.name, size: file.size, mediaKind: 'image', file }]);
      }
      if (change === 'Start over') store.getState().resetBatch();
      if (change === 'account switch') store.setState(s => ({ connectionId: s.connectionId + 1 }));
      const current = store.getState();
      pending.resolve({ ok: true, attached: new Map([['old.jpg', original]]), problems: [], resolved: new Map() });
      await rejected;
      expect(store.getState().files).toBe(current.files);
      expect(store.getState().uploadDescription).toBe(current.uploadDescription);
      expect(store.getState().batchToken).toBe(current.batchToken);
    });
  }
}

it('cancelling the Flip picker without changing the session leaves the current batch intact', async () => {
  const current = store.getState();
  const recovery = flip.reselectFlip(record);
  pending.resolve(null);
  await recovery;
  expect(store.getState().files).toBe(current.files);
  expect(store.getState().batchToken).toBe(current.batchToken);
});
