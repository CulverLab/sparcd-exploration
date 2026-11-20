import { loadMasterSpecies } from './masterSpecies';
// The pre-upload journal is separate from real-upload sessions and credentials.
// A single IndexedDB transaction replaces the snapshot: interrupted writes keep
// the previous version. Original File bytes never enter this record.
import { deriveFlipOwnerScope, flipDb, isValidFlipOwnerScope, readFlipRecord, validPreparedSpecies, type PreparedSpecies, type FlipRecord } from '@sparcd/flip';
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
  /** Owner of the Tagger handoff, retained so saved tags can be read offline. */
  ownerScope?: string;
  species: PreparedSpecies | null;
  inputs: Pick<ReturnType<typeof useStore.getState>, 'selectedBucket' | 'selectedLocationId' | 'uploadDescription' | 'uploadTimeZone'> & Partial<Pick<ReturnType<typeof useStore.getState>, 'mountainRange' | 'dateCollected' | 'uploadCommentDate'>>;
};
type MissingRemovalIntent = { v: 1; id: string; preparationId: string; flipId: string | null; ownerScope?: string; relPath: string; size: number; sha256: string; createdAt: string; appliedAt?: string };
const pendingMissingRemovals = new Map<string, { intentId: string; preparationId: string; relPath: string; fileName: string; error: string }>();
let failedRemovalRequest: { fileId: string; preparationId: string; flipId: string | null; relPath: string; size: number; sha256: string } | null = null;
const removalListeners = new Set<() => void>();
let removalMessage = '';
let removalRevision = 0;
export const missingRemovalStatus = () => removalMessage;
export const missingRemovalVersion = () => removalRevision;
export const subscribeMissingRemoval = (listener: () => void) => { removalListeners.add(listener); return () => { removalListeners.delete(listener); }; };
function reportMissingRemoval(message: string) { removalMessage = message; removalRevision++; for (const listener of removalListeners) listener(); }
export function isMissingRemovalPending(fileId: string): boolean { return pendingMissingRemovals.has(fileId); }
export function isAnyMissingRemovalPending(): boolean { return pendingMissingRemovals.size > 0; }
let installed = false;
let batchSpecies: PreparedSpecies | null = null;
let lastToken = -1;
let preparationId = '';
let nextSpecies: PreparedSpecies | null = null;
let nextConnection: unknown;
let speciesRead: Promise<PreparedSpecies | null> = Promise.resolve(null);
let skipNextPreparationFileSnapshot = false;
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
  batchSpecies = species ?? null;
  speciesRead = Promise.resolve(batchSpecies);
  lastToken = useStore.getState().batchToken + 1;
}
export async function acceptPreparationSpecies(species: PreparedSpecies): Promise<void> {
  const state = useStore.getState();
  // Refresh the next-batch seed even when the current batch keeps its catalog.
  nextSpecies = species; nextConnection = state.s3Config;
  if (!state.files.length) return;
  if (validPreparedSpecies(batchSpecies)) return;
  const token = state.batchToken, id = preparationId;
  // The first journal write may still be reading its saved catalog. Do not
  // replace that immutable batch snapshot with a later background refresh.
  const existing = await speciesRead;
  if (useStore.getState().batchToken !== token || preparationId !== id || validPreparedSpecies(batchSpecies)) return;
  if (existing != null) { batchSpecies = existing; return; }
  batchSpecies = species; speciesRead = Promise.resolve(species); lastToken = token;
  retryPreparation();
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
function removeStoreFileAfterDurableCommit(fileId: string): void {
  skipNextPreparationFileSnapshot = true;
  try { useStore.getState().removeFile(fileId); }
  finally { skipNextPreparationFileSnapshot = false; }
}
export async function listPreparations(onUnavailable?: (id: string, reason?: string, fileName?: string) => void): Promise<LocalPreparation[]> {
  const rows = await flipDb.preparations.toArray();
  const unique = new Map<string, LocalPreparation>();
  for (const row of rows) {
    try {
      const value = validatePreparation(row.value);
      if (!value) throw new Error('Empty preparation');
      try {
        // A conflict in one handoff must not hide unrelated recoverable batches.
        await replayMissingRemovalIntents({ preparationId: value.id });
      } catch (error) {
        onUnavailable?.(row.id, (error as Error).message, value.files[0]?.fileName);
        continue;
      }
      const refreshed = validatePreparation((await flipDb.preparations.get(row.id))?.value);
      if (refreshed && (!unique.has(refreshed.id) || unique.get(refreshed.id)!.savedAt < refreshed.savedAt)) unique.set(refreshed.id, refreshed);
    } catch { onUnavailable?.(row.id, 'Saved data is damaged or from an unsupported version.'); }
  }
  return [...unique.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function readPreparationForFlip(flipId: string): Promise<LocalPreparation | null> {
  await replayMissingRemovalIntents({ flipId });
  // Validate matching journals only: unrelated damaged/future records cannot
  // strand a healthy Flip return. A damaged matching record remains an error.
  const rows = await flipDb.preparations.toArray();
  const matching = rows.filter(row => row.value && typeof row.value === 'object' && 'flipId' in row.value && row.value.flipId === flipId);
  return matching.map(row => validatePreparation(row.value)!).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
}

function sameRemovalTarget(file: { relPath?: unknown; size?: unknown; sha256?: unknown }, intent: MissingRemovalIntent): boolean {
  return file.relPath === intent.relPath && file.size === intent.size && file.sha256 === intent.sha256;
}
function assertRemovalTarget(file: { relPath?: unknown; size?: unknown; sha256?: unknown }, intent: MissingRemovalIntent, source: string): void {
  if (file.relPath !== intent.relPath) return;
  if (!sameRemovalTarget(file, intent)) throw new Error(`${source} now contains a different file at ${intent.relPath}. The saved record was kept; review it before removing anything.`);
}
async function applyMissingRemovalIntent(intent: MissingRemovalIntent): Promise<void> {
  let ownerConnectionId: number | null = null;
  if (intent.flipId) {
    const state = useStore.getState();
    if (!state.s3Config) throw new Error('Reconnect with the login that owns this Tagger handoff before retrying its removal.');
    ownerConnectionId = state.connectionId;
    const ownerScope = await deriveFlipOwnerScope(state.s3Config);
    if (ownerScope !== intent.ownerScope || useStore.getState().connectionId !== ownerConnectionId) {
      throw new Error('This removal belongs to a different connected login. Reconnect with the login that owns this batch and retry.');
    }
  }
  await flipDb.transaction('rw', flipDb.preparations, flipDb.records, flipDb.removalIntents, async () => {
    if (ownerConnectionId !== null && useStore.getState().connectionId !== ownerConnectionId) {
      throw new Error('The connected login changed during removal. The saved records were kept; reconnect to the batch owner and retry.');
    }
    const preparationRow = await flipDb.preparations.get(intent.preparationId);
    if (preparationRow) {
      const preparation = validatePreparation(preparationRow.value);
      if (!preparation || preparation.id !== intent.preparationId) throw new Error('The saved preparation changed and could not be safely updated. Keep it open and retry.');
      const entry = preparation.files.find(file => file.relPath === intent.relPath);
      if (entry) {
        assertRemovalTarget(entry, intent, 'The saved preparation');
        preparation.files = preparation.files.filter(file => file.relPath !== intent.relPath);
        if (preparation.files.length) {
          preparation.savedAt = new Date().toISOString();
          await flipDb.preparations.put({ id: intent.preparationId, value: preparation });
        } else await flipDb.preparations.delete(intent.preparationId);
      }
    }
    if (intent.flipId) {
      const record = await flipDb.records.get(intent.flipId);
      if (record) {
        if (record.ownerScope !== intent.ownerScope) throw new Error('The saved Tagger handoff ownership changed. Its record was kept; reconnect to the original login and retry.');
        const entry = record.files.find(file => file.relPath === intent.relPath);
        if (entry) {
          assertRemovalTarget(entry, intent, 'The saved Tagger handoff');
          const tags = { ...record.tags };
          delete tags[intent.relPath];
          const updated: FlipRecord = { ...record, files: record.files.filter(file => file.relPath !== intent.relPath), tags, usedAt: new Date().toISOString(), revision: (record.revision ?? 0) + 1 };
          await flipDb.records.put(updated);
        }
      }
    }
    // Keep the completed intent as a durable tombstone. Another open Uploader
    // tab may still hold the old preparation snapshot and autosave it later.
    await flipDb.removalIntents.put({ id: intent.id, value: { ...intent, appliedAt: new Date().toISOString() } });
  });
}
export async function replayMissingRemovalIntents(scope: { preparationId?: string; flipId?: string } = {}): Promise<void> {
  const rows = await flipDb.removalIntents.toArray();
  const completed: MissingRemovalIntent[] = [];
  for (const row of rows) {
    const intent = row.value as MissingRemovalIntent;
    // Applied intents remain as durable cross-tab tombstones; they are not work
    // to replay. Filter before validation so a damaged sibling cannot block a
    // different batch from opening.
    if ((scope.preparationId && intent?.preparationId !== scope.preparationId) || (scope.flipId && intent?.flipId !== scope.flipId)) continue;
    if (!intent || intent.v !== 1 || intent.id !== row.id || typeof intent.preparationId !== 'string' || !intent.preparationId || (intent.flipId !== null && typeof intent.flipId !== 'string') || (intent.ownerScope !== undefined && typeof intent.ownerScope !== 'string') || typeof intent.relPath !== 'string' || !intent.relPath || !Number.isFinite(intent.size) || intent.size < 0 || typeof intent.sha256 !== 'string' || !intent.sha256 || !Number.isFinite(Date.parse(intent.createdAt)) || (intent.appliedAt !== undefined && !Number.isFinite(Date.parse(intent.appliedAt)))) {
      throw new Error('A saved removal needs recovery. Its journal is invalid; keep this browser data and contact support.');
    }
    // A different tab may have completed this intent while this tab still has
    // the row hidden in memory. Include completed tombstones in local cleanup,
    // but never apply their storage mutation a second time.
    if (intent.appliedAt) { completed.push(intent); continue; }
    try {
      await applyMissingRemovalIntent(intent);
      completed.push(intent);
    } catch (error) {
      const message = (error as Error).message;
      for (const [fileId, pending] of pendingMissingRemovals) if (pending.intentId === intent.id) pendingMissingRemovals.set(fileId, { ...pending, error: message });
      finalizeReplayedRemovals(completed);
      reportMissingRemoval(`Could not replay the saved removal for ${intent.relPath}. ${message}`);
      throw error;
    }
  }
  if (finalizeReplayedRemovals(completed)) reportMissingRemoval('Removed file from the saved preparation and Tagger handoff.');
}
function finalizeReplayedRemovals(completed: MissingRemovalIntent[]): boolean {
  let finalized = false;
  for (const intent of completed) {
    if (preparationId === intent.preparationId) {
      const currentFile = useStore.getState().files.find(file => file.relPath === intent.relPath && file.size === intent.size && file.sha256 === intent.sha256);
      if (currentFile) { removeStoreFileAfterDurableCommit(currentFile.id); finalized = true; }
    }
    for (const [fileId, pending] of pendingMissingRemovals) {
      if (pending.intentId !== intent.id) continue;
      pendingMissingRemovals.delete(fileId);
      finalized = true;
    }
  }
  return finalized;
}
export async function removeMissingOriginal(fileId: string): Promise<void> {
  if (pendingMissingRemovals.has(fileId)) return;
  if (pendingMissingRemovals.size) throw new Error('Finish or retry the pending removal before removing another original.');
  const state = useStore.getState();
  const file = state.files.find(entry => entry.id === fileId && entry.needsOriginal);
  if (!file) throw new Error('This file no longer needs recovery. Refresh the file list and try again.');
  const operation = { batchToken: state.batchToken, connectionId: state.connectionId, preparationId, flipId: state.flipId };
  const retryRequest = { fileId, preparationId: operation.preparationId, flipId: operation.flipId, relPath: file.relPath, size: file.size, sha256: file.sha256 ?? '' };
  const isSameActiveTarget = () => {
    const current = useStore.getState();
    const currentFile = current.files.find(entry => entry.id === fileId);
    return current.batchToken === operation.batchToken && current.connectionId === operation.connectionId &&
      preparationId === operation.preparationId && current.flipId === operation.flipId &&
      !!currentFile?.needsOriginal && currentFile.relPath === file.relPath && currentFile.size === file.size && currentFile.sha256 === file.sha256;
  };
  const assertSameActiveTarget = () => {
    if (!isSameActiveTarget()) throw new Error('The batch or connection changed during removal. The current batch was left unchanged; reopen the original batch to finish recovery.');
  };
  let saved: LocalPreparation;
  let flip: FlipRecord | undefined;
  try {
    await flushPreparation();
    assertSameActiveTarget();
    await replayMissingRemovalIntents({ preparationId: operation.preparationId, ...(operation.flipId ? { flipId: operation.flipId } : {}) });
    const currentRow = operation.preparationId ? await flipDb.preparations.get(operation.preparationId) : undefined;
    assertSameActiveTarget();
    const current = validatePreparation(currentRow?.value);
    if (!current) throw new Error('The saved preparation could not be found.');
    const savedFile = current.files.find(entry => entry.relPath === file.relPath);
    if (!savedFile || !savedFile.sha256 || !file.sha256 || savedFile.size !== file.size || savedFile.sha256 !== file.sha256) throw new Error('The saved preparation no longer matches this file identity. Refresh the recovered batch before removing it.');
    saved = current;
    flip = saved.flipId ? await flipDb.records.get(saved.flipId) : undefined;
    assertSameActiveTarget();
    if (saved.flipId) {
      const currentState = useStore.getState();
      if (!flip?.ownerScope || !currentState.s3Config) throw new Error('The Tagger handoff owner could not be verified. Reconnect to the login that owns this batch before removing it.');
      const ownerScope = await deriveFlipOwnerScope(currentState.s3Config);
      assertSameActiveTarget();
      if (ownerScope !== flip.ownerScope) throw new Error('This Tagger handoff belongs to a different connected login. Reconnect to its owner before removing it.');
    }
  } catch (error) {
    if (isSameActiveTarget()) failedRemovalRequest = retryRequest;
    reportMissingRemoval(`Could not prepare the removal for ${file.fileName}. The file remains in the list. ${(error as Error).message}`);
    throw error;
  }
  assertSameActiveTarget();
  const intent: MissingRemovalIntent = { v: 1, id: crypto.randomUUID(), preparationId: saved.id, flipId: saved.flipId, ownerScope: flip?.ownerScope, relPath: file.relPath, size: file.size, sha256: file.sha256!, createdAt: new Date().toISOString() };
  // The intent is the commit point: a failed journal write leaves the file visible.
  try { await flipDb.removalIntents.put({ id: intent.id, value: intent }); }
  catch (error) {
    if (isSameActiveTarget()) failedRemovalRequest = retryRequest;
    reportMissingRemoval(`Could not save the removal request for ${file.fileName}. The file remains in the list. ${(error as Error).message}`);
    throw error;
  }
  try { assertSameActiveTarget(); }
  catch (error) {
    reportMissingRemoval(`The removal request for ${file.fileName} was saved, but the batch changed before it could be applied. Reopen the original batch to finish recovery.`);
    throw error;
  }
  failedRemovalRequest = null;
  pendingMissingRemovals.set(fileId, { intentId: intent.id, preparationId: saved.id, relPath: file.relPath, fileName: file.fileName, error: '' });
  reportMissingRemoval(`Removing ${file.fileName} from the saved batch…`);
  try {
    assertSameActiveTarget();
    await applyMissingRemovalIntent(intent);
    const pending = pendingMissingRemovals.get(fileId);
    if (pending?.intentId === intent.id) pendingMissingRemovals.delete(fileId);
    if (isSameActiveTarget()) {
      // Only after both durable records agree do we alter the autosaved store.
      removeStoreFileAfterDurableCommit(fileId);
      reportMissingRemoval(`Removed ${file.fileName} from this batch and its saved Tagger handoff.`);
    } else reportMissingRemoval(`Removed ${file.fileName} from its saved batch. The active batch changed and was left untouched.`);
  } catch (error) {
    const message = (error as Error).message;
    if (isSameActiveTarget()) {
      pendingMissingRemovals.set(fileId, { intentId: intent.id, preparationId: saved.id, relPath: file.relPath, fileName: file.fileName, error: message });
    } else {
      const pending = pendingMissingRemovals.get(fileId);
      if (pending?.intentId === intent.id) pendingMissingRemovals.delete(fileId);
      failedRemovalRequest = null;
    }
    reportMissingRemoval(isSameActiveTarget()
      ? `Could not finish removing ${file.fileName}. ${message}`
      : `The batch changed while removing ${file.fileName}. The active batch was left untouched; reopen the original batch to finish recovery.`);
    throw error;
  }
}
export async function retryMissingOriginalRemovals(): Promise<void> {
  const request = failedRemovalRequest;
  await replayMissingRemovalIntents({ preparationId: request?.preparationId ?? preparationId, ...(request?.flipId ? { flipId: request.flipId } : {}) });
  failedRemovalRequest = null;
  if (!request) return;
  const currentState = useStore.getState();
  const currentFile = currentState.files.find(file => file.id === request.fileId && file.needsOriginal);
  if (preparationId !== request.preparationId || currentState.flipId !== request.flipId || !currentFile || currentFile.relPath !== request.relPath || currentFile.size !== request.size || currentFile.sha256 !== request.sha256) {
    const error = new Error('The batch changed after this removal failed. Review the current batch before retrying.');
    reportMissingRemoval(`Could not prepare the removal again. ${error.message}`);
    throw error;
  }
  await removeMissingOriginal(request.fileId);
}
/** The in-memory binding also exists when durable writes fail. Never substitute
 * another window's selected cache for a batch with no prepared vocabulary. */
export async function readBoundPreparationSpecies(): Promise<PreparedSpecies | null> {
  const species = validPreparedSpecies(batchSpecies) ? batchSpecies : await speciesRead;
  return validPreparedSpecies(species) ? species : null;
}
export async function readPreparation(): Promise<LocalPreparation | null> {
  if (!preparationId) return null;
  await replayMissingRemovalIntents({ preparationId });
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
    (value.inputs.selectedLocationId === null || typeof value.inputs.selectedLocationId === 'string') &&
    (value.ownerScope === undefined || isValidFlipOwnerScope(value.ownerScope));
  if (!valid) throw new Error('Saved preparation is damaged or from an unsupported version. Its stored data has been kept. Reopen the compatible app or reselect your folder to start a new batch.');
  return value;
}
/** Capture ownership when starting a fresh upload; never infer it from files. */
export function preparationIdForUpload(): string | undefined {
  const state = useStore.getState();
  return state.files.length && lastToken === state.batchToken ? preparationId || undefined : undefined;
}
export function startPreparationJournal(): void {
  if (installed) return;
  installed = true;
  useStore.subscribe((s, previous) => {
    if (skipNextPreparationFileSnapshot && s.files !== previous.files) { skipNextPreparationFileSnapshot = false; return; }
    const changed = s.files !== previous.files || s.flipId !== previous.flipId || s.selectedBucket !== previous.selectedBucket || s.selectedLocationId !== previous.selectedLocationId || s.uploadDescription !== previous.uploadDescription || s.uploadTimeZone !== previous.uploadTimeZone || s.mountainRange !== previous.mountainRange || s.dateCollected !== previous.dateCollected || s.uploadCommentDate !== previous.uploadCommentDate;
    const snap = s.activeSnap;
    // Consume the transition, not a lingering done snapshot. A History run may
    // belong to a different batch (or have no ownership on legacy sessions).
    const completed = snap?.phase === 'done' && !snap.dryRun &&
      (previous.activeSnap?.sessionId !== snap.sessionId || previous.activeSnap?.phase !== 'done');
    const publishedId = completed ? snap.preparationId : undefined;
    if (publishedId) {
      const currentPublished = preparationId === publishedId;
      if (currentPublished) { preparationId = ''; hasPreparation = false; }
      // Queue behind this ID's pending saves so none can resurrect it afterward.
      writes.enqueue(publishedId, async () => {
        await flipDb.transaction('rw', flipDb.preparations, async () => {
          await flipDb.preparations.delete(publishedId);
          const legacy = await flipDb.preparations.get('active');
          if (legacy?.value && (legacy.value as LocalPreparation).id === publishedId) await flipDb.preparations.delete('active');
        });
      });
      if (currentPublished) return;
    }
    if (!changed) return;
    // Do not erase a recoverable batch merely because the startup store is empty.
    if (!s.files.length && !previous.files.length) return;
    // Retain immutable references; serialize only the snapshot that actually writes.
    const files = s.files;
    const inputs = { selectedBucket: s.selectedBucket, selectedLocationId: s.selectedLocationId, uploadDescription: s.uploadDescription, uploadTimeZone: s.uploadTimeZone, mountainRange: s.mountainRange, dateCollected: s.dateCollected, uploadCommentDate: s.uploadCommentDate };
    // Capture ownership before queuing writes. Other windows have independent IDs.
    if (s.files.length && lastToken !== s.batchToken) {
      batchSpecies = null;
      speciesRead = nextConnection === s.s3Config && validPreparedSpecies(nextSpecies) ? Promise.resolve(nextSpecies) : loadMasterSpecies(s.s3Config ?? undefined);
      preparationId = crypto.randomUUID();
      lastToken = s.batchToken;
    }
    if (s.files.length && !preparationId) preparationId = crypto.randomUUID();
    const id = preparationId;
    const speciesPromise = validPreparedSpecies(batchSpecies) ? Promise.resolve(batchSpecies) : speciesRead;
    if (!files.length) preparationId = '';
    if (!id) return;
    hasPreparation = files.length > 0;
    report('Saving local preparation…');
    writes.enqueue(id, async () => {
      if (!files.length) { if (id) await flipDb.preparations.delete(id); }
      else {
        const species = await speciesPromise;
        await flipDb.transaction('rw', flipDb.preparations, flipDb.removalIntents, flipDb.records, async () => {
          const tombstones = (await flipDb.removalIntents.toArray())
            .map(row => row.value as MissingRemovalIntent)
            .filter(intent => intent?.preparationId === id && !!intent.appliedAt);
          const retainedFiles = files.filter(file => !tombstones.some(intent => intent.relPath === file.relPath && sameRemovalTarget(file, intent)));
          if (!retainedFiles.length) {
            await flipDb.preparations.delete(id);
            return;
          }
          const previous = await flipDb.preparations.get(id);
          const priorValue = previous?.value as LocalPreparation | undefined;
          const priorOwnerScope = priorValue?.flipId === s.flipId && isValidFlipOwnerScope(priorValue.ownerScope) ? priorValue.ownerScope : undefined;
          const flipRecord = s.flipId ? await flipDb.records.get(s.flipId) : undefined;
          const recordOwnerScope = isValidFlipOwnerScope(flipRecord?.ownerScope) ? flipRecord.ownerScope : undefined;
          if (priorOwnerScope && recordOwnerScope && priorOwnerScope !== recordOwnerScope) {
            throw new Error('The saved Tagger batch owner changed. Its preparation was kept; reconnect to the original login before continuing.');
          }
          const ownerScope = recordOwnerScope ?? priorOwnerScope;
          const value: LocalPreparation = { v: 1, id, dirHandle: s.dirHandle ?? undefined, savedAt: new Date().toISOString(), files: retainedFiles.map(({ file, ...entry }) => ({ ...entry, lastModified: file.lastModified })), flipId: s.flipId, ...(ownerScope ? { ownerScope } : {}), species, inputs };
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
  if (!result.attached.size && result.problems.length) throw new Error(result.problems.map(p => `${p.fileName}: ${p.reason}`).join('; ') + '. Your saved preparation is unchanged. Reselect the original folder.');
  const recoveryConfig = useStore.getState().s3Config;
  let flip: FlipRecord | null = null;
  if (saved.flipId) {
    const ownerScope = recoveryConfig ? await deriveFlipOwnerScope(recoveryConfig) : saved.ownerScope;
    if (!isValidFlipOwnerScope(ownerScope)) {
      throw new Error('The Tagger handoff owner is not saved with this preparation. Connect with the batch owner before recovering so saved identifications can be restored. Your preparation is unchanged.');
    }
    if (saved.ownerScope && saved.ownerScope !== ownerScope) {
      throw new Error('This saved Tagger handoff belongs to a different connected login. Reconnect to its owner before recovering; your preparation is unchanged.');
    }
    flip = (await readFlipRecord(saved.flipId, ownerScope)) ?? null;
    if (!flip || flip.ownerScope !== ownerScope) {
      throw new Error('The saved Tagger identifications could not be verified for this batch. Connect with its owner and retry; your preparation is unchanged.');
    }
  }
  guard();
  const files: FileEntry[] = saved.files.map(({ lastModified, ...entry }) => {
    const fresh = result.resolved.get(entry.relPath);
    const original = result.attached.get(entry.relPath);
    const tags = flip && Object.hasOwn(flip.tags, entry.relPath)
      ? { preTags: flip.tags[entry.relPath], preTaggerUser: flip.taggerUser } : {};
    if (!original) {
      const problem = result.problems.find(p => p.localPath === entry.relPath);
      // Retain every expected hash, tag and Inspect result in the journal.
      // The empty File supplies no unverified bytes, and error validation blocks
      // upload/handoff until originals are reselected (or explicitly removed).
      return { ...entry, ...tags, file: new File([], entry.fileName, { lastModified }),
        processState: 'error', needsOriginal: true, processError: problem?.reason ?? 'Original file could not be verified' };
    }
    return { ...entry, ...(entry.sha256 ? {} : fresh), id: entry.id, ...tags, file: new File([original], original.name, { type: original.type, lastModified }), processState: 'ready', processError: undefined, needsOriginal: undefined };
  });
  // Legacy singleton journals remain recoverable, but new writes have batch keys.
  preparationId = saved.id;
  speciesRead = Promise.resolve(flip?.preparedSpecies ?? saved.species);
  batchSpecies = flip?.preparedSpecies ?? saved.species;
  lastToken = useStore.getState().batchToken + 1;
  useStore.getState().adoptTaggedBatch({ flipId: saved.flipId, files, dirHandle });
  useStore.setState({ mountainRange: '', dateCollected: '', uploadCommentDate: null, ...saved.inputs });
}
