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
import { readFlipRecord, finishFlipRecord, updateFlipTags, type FlipRecord } from '@sparcd/flip';
import type { DraftRecord } from './db';
import { tagsFromDrafts } from './localWorkspace';
import { safeReturnUrl } from './siblings';

/** The batch id this page load was opened with, if any. Read synchronously so
 *  the app can skip the Connect gate on the very first render. */
export const localBatchId = new URLSearchParams(window.location.search).get('batch');

export type LocalBatchStatus = 'loading' | 'ready' | 'missing';

type LocalBatchState = {
  status: LocalBatchStatus;
  /** The record as it was at entry. Deliberately never replaced by a tag
   *  write-back: the workspace seeds its drafts from these observations, and
   *  re-seeding them mid-session would undo the user's own edits. */
  record: FlipRecord | null;
  media: Record<string, Blob>; // relPath → the best blob we have (thumb, then original)
  fullAttached: boolean;
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
  needsGesture: false,

  load: async () => {
    if (!localBatchId) return;
    const record = await readFlipRecord(localBatchId);
    if (!record) {
      set({ status: 'missing' });
      return;
    }
    const media: Record<string, Blob> = {};
    for (const f of record.files) if (f.thumb) media[f.relPath] = f.thumb;
    set({ status: 'ready', record, media });
    if (record.dirHandle) await get().attachOriginals();
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
    // Same trusted matching the uploader's own round trip uses: path and size.
    // The record's hashes were computed from these very bytes minutes ago, so
    // re-proving them would cost seconds to learn nothing.
    const media = { ...get().media };
    for (const f of record.files) {
      const file = onDisk.get(f.relPath);
      if (file && file.size === f.size) media[f.relPath] = file;
    }
    set({ media, fullAttached: true, needsGesture: false });
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

export function saveLocalTags(id: string, drafts: Record<string, DraftRecord>): Promise<void> {
  return updateFlipTags(id, tagsFromDrafts(drafts));
}

/** Hand the batch back: the final tags, who tagged them, and the return trip. */
export async function finishLocalBatch(
  record: FlipRecord,
  drafts: Record<string, DraftRecord>,
  taggerUser: string,
): Promise<void> {
  await finishFlipRecord(record.id, tagsFromDrafts(drafts), taggerUser);
  window.location.href = safeReturnUrl(record.returnUrl, window.location.origin);
}
