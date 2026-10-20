// The pre-upload journal is separate from real-upload sessions and credentials.
// A single IndexedDB transaction replaces the snapshot: interrupted writes keep
// the previous version. Original File bytes never enter this record.
import { flipDb, loadPreparedSpecies, readFlipRecord, validPreparedSpecies, type PreparedSpecies } from '@sparcd/flip';
import { useStore, type FileEntry } from '../store';
import { reconcileReselect, restoreFromHandle, type RestoreOk } from './resume';
import type { ScannedFile } from './scanFiles';
import { PreparationQueue } from './preparationQueue';
export type LocalPreparation = {
  v: 1;
  id: string;
  dirHandle?: FileSystemDirectoryHandle;
  savedAt: string;
  files: (Omit<FileEntry, 'file'> & { lastModified: number })[];
  flipId: string | null;
  species: PreparedSpecies | null;
  inputs: Pick<ReturnType<typeof useStore.getState>, 'selectedBucket' | 'selectedLocationId' | 'uploadDescription' | 'uploadTimeZone'> & Partial<Pick<ReturnType<typeof useStore.getState>, 'mountainRange' | 'dateCollected' | 'uploadCommentDate'>>;
};
let installed = false;
let batchSpecies: PreparedSpecies | null = null;
let lastToken = -1;
let preparationId = '';
let nextSpecies: PreparedSpecies | null = null;
let nextConnection: unknown;
let speciesRead: Promise<PreparedSpecies | null> = Promise.resolve(null);
/** Reject asynchronous restoration after a new batch or connection takes ownership. */
export function recoveryGuard(): () => void {
  const { batchToken, connectionId } = useStore.getState();
  return () => {
    const current = useStore.getState();
    if (current.batchToken !== batchToken || current.connectionId !== connectionId) throw new Error('The batch or connection changed. Your saved preparation is unchanged.');
  };
}
export function bindCurrentPreparationSpecies(species: PreparedSpecies | null | undefined, id?: string): void {
  preparationId = id ?? crypto.randomUUID();
  batchSpecies = validPreparedSpecies(species) ? species : null;
  speciesRead = Promise.resolve(batchSpecies);
  lastToken = useStore.getState().batchToken + 1;
}
export function acceptPreparationSpecies(species: PreparedSpecies): void {
  const state = useStore.getState();
  if (!state.files.length) { nextSpecies = species; nextConnection = state.s3Config; return; }
  if (!validPreparedSpecies(batchSpecies)) { batchSpecies = species; speciesRead = Promise.resolve(species); lastToken = state.batchToken; retryPreparation(); }
}
const listeners = new Set<() => void>();
let status = '';
let hasPreparation = false;
const writes = new PreparationQueue(failed => report(failed
  ? 'Local preparation could not be saved. Keep this tab open, free browser storage, and retry before leaving.'
  : hasPreparation ? 'Local preparation saved. Original files remain in your folder.' : ''));
export const preparationStatus = () => status;
export const subscribePreparation = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function report(message: string) { status = message; for (const listener of listeners) listener(); }
export async function listPreparations(onUnavailable?: (id: string) => void): Promise<LocalPreparation[]> {
  const rows = await flipDb.preparations.toArray();
  const unique = new Map<string, LocalPreparation>();
  for (const row of rows) {
    try {
      const value = validatePreparation(row.value);
      if (!value) throw new Error('Empty preparation');
      if (!unique.has(value.id) || unique.get(value.id)!.savedAt < value.savedAt) unique.set(value.id, value);
    } catch { onUnavailable?.(row.id); }
  }
  return [...unique.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function readPreparationForFlip(flipId: string): Promise<LocalPreparation | null> {
  // Validate matching journals only: unrelated damaged/future records cannot
  // strand a healthy Flip return. A damaged matching record remains an error.
  const rows = await flipDb.preparations.toArray();
  const matching = rows.filter(row => row.value && typeof row.value === 'object' && 'flipId' in row.value && row.value.flipId === flipId);
  return matching.map(row => validatePreparation(row.value)!).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
}
/** The in-memory binding also exists when durable writes fail. Never substitute
 * another window's selected cache for a batch with no prepared vocabulary. */
export async function readBoundPreparationSpecies(): Promise<PreparedSpecies | null> {
  const species = validPreparedSpecies(batchSpecies) ? batchSpecies : await speciesRead;
  return validPreparedSpecies(species) ? species : null;
}
export async function readPreparation(): Promise<LocalPreparation | null> {
  if (!preparationId) return null;
  return validatePreparation((await flipDb.preparations.get(preparationId))?.value);
}
function validatePreparation(raw: unknown): LocalPreparation | null {
  const value = raw as LocalPreparation | undefined;
  if (!value) return null;
  const valid = value.v === 1 && typeof value.id === 'string' && !!value.id && Number.isFinite(Date.parse(value.savedAt)) &&
    Array.isArray(value.files) && value.files.length > 0 && new Set(value.files.map(f => f?.relPath)).size === value.files.length &&
    value.files.every(f => f && typeof f.id === 'string' && typeof f.relPath === 'string' && !!f.relPath && typeof f.fileName === 'string' &&
      Number.isFinite(f.size) && f.size >= 0 && Number.isFinite(f.lastModified) && ['image', 'video'].includes(f.mediaKind) &&
      ['queued', 'processing', 'ready', 'error'].includes(f.processState) && (f.processState !== 'ready' || typeof f.sha256 === 'string')) &&
    !!value.inputs && typeof value.inputs.uploadDescription === 'string' && typeof value.inputs.uploadTimeZone === 'string' &&
    (value.inputs.mountainRange === undefined || typeof value.inputs.mountainRange === 'string') &&
    (value.inputs.dateCollected === undefined || typeof value.inputs.dateCollected === 'string') &&
    (value.inputs.uploadCommentDate == null || typeof value.inputs.uploadCommentDate === 'string') &&
    (value.inputs.selectedBucket === null || typeof value.inputs.selectedBucket === 'string') &&
    (value.inputs.selectedLocationId === null || typeof value.inputs.selectedLocationId === 'string');
  if (!valid) throw new Error('Saved preparation is damaged or from an unsupported version. Its stored data has been kept. Reopen the compatible app or reselect your folder to start a new batch.');
  return value;
}
export function startPreparationJournal(): void {
  if (installed) return;
  installed = true;
  useStore.subscribe((s, previous) => {
    const changed = s.files !== previous.files || s.flipId !== previous.flipId || s.selectedBucket !== previous.selectedBucket || s.selectedLocationId !== previous.selectedLocationId || s.uploadDescription !== previous.uploadDescription || s.uploadTimeZone !== previous.uploadTimeZone || s.mountainRange !== previous.mountainRange || s.dateCollected !== previous.dateCollected || s.uploadCommentDate !== previous.uploadCommentDate;
    const published = s.activeSnap?.phase === 'done' && !s.activeSnap.dryRun;
    if (!changed && !published) return;
    // Do not erase a recoverable batch merely because the startup store is empty.
    if (!s.files.length && !previous.files.length && !published) return;
    // Retain immutable references; serialize only the snapshot that actually writes.
    const files = s.files;
    const inputs = { selectedBucket: s.selectedBucket, selectedLocationId: s.selectedLocationId, uploadDescription: s.uploadDescription, uploadTimeZone: s.uploadTimeZone, mountainRange: s.mountainRange, dateCollected: s.dateCollected, uploadCommentDate: s.uploadCommentDate };
    // Capture ownership before queuing writes. Other windows have independent IDs.
    if (s.files.length && !published && lastToken !== s.batchToken) {
      batchSpecies = null;
      speciesRead = nextConnection === s.s3Config && validPreparedSpecies(nextSpecies) ? Promise.resolve(nextSpecies) : loadPreparedSpecies(s.s3Config ?? undefined);
      preparationId = crypto.randomUUID();
      lastToken = s.batchToken;
    }
    if (s.files.length && !published && !preparationId) preparationId = crypto.randomUUID();
    const id = preparationId;
    const speciesPromise = validPreparedSpecies(batchSpecies) ? Promise.resolve(batchSpecies) : speciesRead;
    if (!files.length || published) preparationId = '';
    if (!id) return;
    hasPreparation = files.length > 0 && !published;
    report('Saving local preparation…');
    writes.enqueue(id, async () => {
      if (!files.length || published) { if (id) await flipDb.preparations.delete(id); }
      else {
        const species = await speciesPromise;
        const value: LocalPreparation = { v: 1, id, dirHandle: s.dirHandle ?? undefined, savedAt: new Date().toISOString(), files: files.map(({ file, ...entry }) => ({ ...entry, lastModified: file.lastModified })), flipId: s.flipId, species, inputs };
        await flipDb.transaction('rw', flipDb.preparations, async () => {
          await flipDb.preparations.put({ id, value });
          // Retire only this batch's legacy singleton after its replacement is durable.
          const legacy = await flipDb.preparations.get('active');
          if (legacy?.value && (legacy.value as LocalPreparation).id === id) await flipDb.preparations.delete('active');
        });
      }
    });
  });
}
export async function flushPreparation(): Promise<void> {
  await writes.flush();
}
/** Include raw/unsupported journals and failed/pending writes in destructive
 * cleanup warnings. Do not filter out work just because it cannot be read. */
export async function countPreparationsForDiscard(): Promise<number> {
  const rows = await flipDb.preparations.toArray();
  const ids = new Set(rows.map(row => {
    if (row.id !== 'active') return row.id;
    try { return validatePreparation(row.value)?.id ?? row.id; }
    catch { return row.id; }
  }));
  for (const id of writes.ids()) ids.add(id);
  if (useStore.getState().files.length && preparationId) ids.add(preparationId);
  return ids.size;
}

export function retryPreparation(): void {
  writes.retry();
  const s = useStore.getState();
  useStore.setState({ files: [...s.files] });
}
export async function recoverPreparation(saved: LocalPreparation, scanned: ScannedFile[], dirHandle: FileSystemDirectoryHandle | null = null): Promise<void> {
  const guard = recoveryGuard();
  const result = await reconcileReselect(saved.files.map(f => ({ localPath: f.relPath, fileName: f.fileName, size: f.size, sha256: f.sha256 })), scanned);
  guard();
  await applyRecoveredPreparation(saved, result, guard, dirHandle);
}
export async function recoverPreparationFromHandle(saved: LocalPreparation): Promise<void> {
  const guard = recoveryGuard();
  const result = await restoreFromHandle({ dirHandle: saved.dirHandle }, Promise.resolve(saved.files.map(f => ({ localPath: f.relPath, fileName: f.fileName, size: f.size, sha256: f.sha256 }))));
  if (!result.ok) throw new Error(result.reason);
  guard();
  await applyRecoveredPreparation(saved, result, guard, saved.dirHandle ?? null);
}
async function applyRecoveredPreparation(saved: LocalPreparation, result: Pick<RestoreOk, 'attached' | 'problems' | 'resolved'>, guard: () => void, dirHandle: FileSystemDirectoryHandle | null): Promise<void> {
  if (result.problems.length) throw new Error(result.problems.map(p => `${p.fileName}: ${p.reason}`).join('; ') + '. Your saved preparation is unchanged. Reselect the original folder.');
  const flip = saved.flipId ? await readFlipRecord(saved.flipId) : null;
  guard();
  const files: FileEntry[] = saved.files.map(({ lastModified, ...entry }) => {
    const fresh = result.resolved.get(entry.relPath);
    const original = result.attached.get(entry.relPath)!;
    return { ...entry, ...(entry.sha256 ? {} : fresh), id: entry.id, ...(flip ? { preTags: flip.tags[entry.relPath] ?? [], preTaggerUser: flip.taggerUser } : {}), file: new File([original], original.name, { type: original.type, lastModified }), processState: 'ready' };
  });
  // Legacy singleton journals remain recoverable, but new writes have batch keys.
  preparationId = saved.id;
  speciesRead = Promise.resolve(flip?.preparedSpecies ?? saved.species);
  batchSpecies = flip?.preparedSpecies ?? saved.species;
  lastToken = useStore.getState().batchToken + 1;
  useStore.getState().adoptTaggedBatch({ flipId: saved.flipId, files, dirHandle });
  useStore.setState({ mountainRange: '', dateCollected: '', uploadCommentDate: null, ...saved.inputs });
}
