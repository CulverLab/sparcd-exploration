// Local-batch mode: a batch the uploader handed over before it was uploaded.
//
// `?batch=<id>` on the tagger's own URL is the whole entry contract. There is no
// S3 anywhere in this path — no connection, no collection, no canonical CSVs —
// because the images do not exist in the collection yet. Everything the
// workspace needs comes out of the shared record: the file list, the
// thumbnails, and (when the browser will part with it) the folder handle that
// gets us the full-resolution originals.
//
// Media resolves in two stages so the grid is never blank: thumbnails paint
// immediately from the record, and the originals replace them once the folder
// opens. On Firefox and Safari that second stage needs a user gesture, so it is
// exposed as an action the UI can offer rather than something that just fails.

import { create } from 'zustand';
import { hashOriginal, deriveFlipOwnerScope, flipRecordUnavailableReason, isValidFlipOwnerScope, readFlipRecord, finishFlipRecord, updateFlipTags, type FlipRecord } from '@sparcd/flip';
import { loadSessionConnection } from '@sparcd/auth-ui';
import type { DraftRecord } from './db';
import { tagsFromDrafts } from './localWorkspace';
import { safeReturnUrl } from './siblings';

/** The batch id this page load was opened with, if any. Read synchronously so
 *  the app can skip the Connect gate on the very first render. */
// Unit tests import the store in Node, where there is no browser global. A
// missing window means ordinary connected mode rather than a local batch.
export const localBatchId =
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('batch');
/** Scope is carried from the connected Uploader handoff, not recomputed from Tagger attribution. */
export const localBatchOwnerScope =
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('ownerScope');

export type LocalBatchStatus = 'loading' | 'ready' | 'missing' | 'error';

type LocalBatchState = {
  status: LocalBatchStatus;
  /** The record as it was at entry. Deliberately never replaced by a tag
   *  write-back: the workspace seeds its drafts from these observations, and
   *  re-seeding them mid-session would undo the user's own edits. */
  record: FlipRecord | null;
  media: Record<string, Blob>; // relPath → the best blob we have (thumb, then original)
  fullAttached: boolean;
  originalError: string;
  saveError: string;
  loadError: string;
  /** The browser wants a click before it will open the folder. */
  needsGesture: boolean;

  load: () => Promise<void>;
  attachOriginals: () => Promise<void>;
};

export const useLocalBatch = create<LocalBatchState>((set, get) => ({
  status: 'loading',
  record: null,
  media: {},
  fullAttached: false,
  originalError: '',
  saveError: '',
  loadError: '',
  needsGesture: false,

  load: async () => {
    if (!localBatchId) return;
    let record;
    try {
      if (!isValidFlipOwnerScope(localBatchOwnerScope)) {
        set({ status: 'missing', loadError: 'This batch is not available for the connected login. Reopen it from Uploader using the login that started it; saved work has been kept.' });
        return;
      }
      const connected = loadSessionConnection();
      if (connected && await deriveFlipOwnerScope(connected) !== localBatchOwnerScope) {
        set({ status: 'missing', loadError: 'This batch is not available for the connected login. Reopen it from Uploader using the login that started it; saved work has been kept.' });
        return;
      }
      record = await readFlipRecord(localBatchId, localBatchOwnerScope);
      const connectedAfterRead = loadSessionConnection();
      if (connectedAfterRead && await deriveFlipOwnerScope(connectedAfterRead) !== localBatchOwnerScope) record = undefined;
    }
    catch { set({ status: 'error', loadError: 'Local batch storage could not be read. Keep this window open, check browser storage, then reload to retry.' }); return; }
    if (!record) {
      const message = await flipRecordUnavailableReason(localBatchId, localBatchOwnerScope ?? undefined).catch(() => 'Local batch storage could not be read. Check browser storage and reload to retry.');
      const scopedMessage = message.includes('unsupported app version')
        ? message
        : 'This batch is not available for the connected login. Reopen it from Uploader using the login that started it; saved work has been kept.';
      set({ status: 'missing', loadError: scopedMessage });
      return;
    }
    const media: Record<string, Blob> = {};
    for (const f of record.files) if (f.thumb) media[f.relPath] = f.thumb;
    set({ status: 'ready', record, media });
    if (record.dirHandle) await get().attachOriginals().catch(() => set({ originalError: 'Original files could not be opened. Saved thumbnails and tags remain available.' }));
  },

  attachOriginals: async () => {
    const handle = get().record?.dirHandle;
    if (!handle) return;

    // Keep the permission calls ahead of every other await: Firefox and Safari
    // silently no-op `requestPermission` once a gesture's turn has been given
    // up, even to a fast IndexedDB read.
    let state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'prompt';
    if (state !== 'granted') state = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
    if (state !== 'granted') {
      set({ needsGesture: true });
      return;
    }

    const record = get().record!;
    const onDisk = await walkDirectory(handle);
    // Reopened handles may reference edited bytes; verify before using originals.
    const media = { ...get().media };
    const problems: string[] = [];
    for (const f of record.files) {
      const file = onDisk.get(f.relPath);
      if (file && file.size === f.size && await hashOriginal(file) === f.sha256) media[f.relPath] = file;
      else problems.push(f.fileName);
    }
    set({ media, fullAttached: problems.length === 0, needsGesture: false,
      originalError: problems.length ? `Missing or changed originals: ${problems.join(', ')}. Saved thumbnails and tags are unchanged.` : '' });
  },
}));

/**
 * Walk a directory handle into relative-path → File. Paths are prefixed with the
 * handle's own name, matching the `topFolder/sub/file.jpg` shape the uploader
 * scanned with — that shape is the record's file key.
 */
async function walkDirectory(dir: FileSystemDirectoryHandle): Promise<Map<string, File>> {
  const out = new Map<string, File>();
  const walk = async (handle: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const entry of handle.values()) {
      const path = `${prefix}/${entry.name}`;
      if (entry.kind === 'file') out.set(path, await entry.getFile());
      else await walk(entry, path);
    }
  };
  await walk(dir, dir.name);
  return out;
}

// --- Saving back -----------------------------------------------------------

export async function saveLocalTags(id: string, drafts: Record<string, DraftRecord>): Promise<void> {
  try {
    const ownerScope = useLocalBatch.getState().record?.ownerScope;
    if (!ownerScope) throw new Error('The saved batch owner could not be verified.');
    await assertLocalBatchOwner(useLocalBatch.getState().record!);
    await updateFlipTags(id, tagsFromDrafts(drafts), ownerScope);
    useLocalBatch.setState({ saveError: '' });
  }
  catch (error) { useLocalBatch.setState({ saveError: error instanceof Error ? error.message : 'Tags could not be copied to the local batch. Keep this tab open, check browser storage, and retry saving tags.' }); }
}

/** Hand the batch back: the final tags, who tagged them, and the return trip. */
export async function finishLocalBatch(
  record: FlipRecord,
  drafts: Record<string, DraftRecord>,
  taggerUser: string,
): Promise<void> {
  if (!record.ownerScope) throw new Error('The saved batch owner could not be verified.');
  await assertLocalBatchOwner(record);
  await finishFlipRecord(record.id, tagsFromDrafts(drafts), taggerUser, record.ownerScope);
  window.location.href = safeReturnUrl(record.returnUrl, window.location.origin);
}

async function assertLocalBatchOwner(record: FlipRecord): Promise<void> {
  const connected = loadSessionConnection();
  if (connected && await deriveFlipOwnerScope(connected) !== record.ownerScope) {
    throw new Error('The connected login changed. This batch is still saved for its original login; return to Uploader and reopen it with that login.');
  }
}
