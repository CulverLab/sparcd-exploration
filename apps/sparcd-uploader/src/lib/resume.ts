// Restoring local file access for a resumed upload (P5). Browser paths are not
// durable capabilities, so a closed-tab resume recovers source bytes one of two
// ways:
//
//   1. Persistent handle (Chromium): a `FileSystemDirectoryHandle` was stored
//      when the folder was first chosen. We revalidate read permission (which
//      needs a user gesture — the Resume click) and walk it.
//   2. Reselect-required (everywhere else, or revoked permission): the user
//      reselects the folder and we reconcile by relative path, size, and
//      SHA-256 before queuing the remaining work. We never claim to upload
//      bytes from a `localPath` string alone.

import type { BatchRecord, FileRecord } from './db';
import {
  pickDirectory,
  scanDirectoryHandle,
  scanFileList,
  supportsDirectoryHandle,
  type MediaKind,
  type ScannedFile,
} from './scanFiles';
import { processBatch } from './processPool';

export type RestoreOk = {
  ok: true;
  attached: Map<string, File>; // localPath → reattached source file
  // Files whose recorded size/hash no longer match on disk — surfaced (never
  // attached) exactly as the reselect path does.
  problems: ReconcileProblem[];
  // A fresh durable handle obtained during a reselect, so the session can be
  // upgraded to `persistent-handle` for next time.
  newHandle?: FileSystemDirectoryHandle;
};

export type RestoreFailed = { ok: false; reason: string };
export type RestoreResult = RestoreOk | RestoreFailed;

export type ReconcileProblem = { localPath: string; fileName: string; reason: string };

/**
 * Revalidate the stored directory handle's read permission, walk it, and
 * reconcile the reattached files against the persisted records — re-hashing
 * every recorded file. The handle identifies the same folder, but a same-size
 * in-place edit between sessions would otherwise upload the wrong bytes past the
 * app's own recorded-hash verification, so we compare content just like the
 * reselect path and exclude any mismatch from the attach map.
 */
export async function restoreFromHandle(
  batch: BatchRecord,
  records: FileRecord[],
): Promise<RestoreResult> {
  const handle = batch.dirHandle;
  if (!handle) return { ok: false, reason: 'No durable folder handle is stored for this session.' };

  let state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'prompt';
  if (state !== 'granted') {
    state = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
  }
  if (state !== 'granted') {
    return { ok: false, reason: 'Read permission to the folder was not granted — reselect it instead.' };
  }

  const scanned = await scanDirectoryHandle(handle);
  const { attached, problems } = await reconcileReselect(records, scanned);
  return { ok: true, attached, problems };
}

// Hash a set of files through the existing worker pool, returning relPath → digest.
function hashAll(items: { id: string; file: File; fileKind: MediaKind }[]): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const out = new Map<string, string>();
    if (items.length === 0) {
      resolve(out);
      return;
    }
    const run = processBatch(
      items,
      () => {},
      (r) => {
        if (r.sha256) out.set(r.id, r.sha256);
      },
    );
    void run.done.then(() => resolve(out));
  });
}

/**
 * Reconcile a freshly reselected folder against the persisted file list. A file
 * matches only if its relative path, byte size, AND SHA-256 all agree with the
 * recorded values — so a different folder, an edited image, or a renamed file
 * is surfaced as a problem rather than silently uploaded as the wrong bytes.
 */
export async function reconcileReselect(
  records: FileRecord[],
  scanned: ScannedFile[],
): Promise<{ attached: Map<string, File>; problems: ReconcileProblem[] }> {
  const byPath = new Map(scanned.map((f) => [f.relPath, f]));
  const problems: ReconcileProblem[] = [];
  const candidates: { record: FileRecord; file: File; mediaKind: MediaKind }[] = [];

  for (const rec of records) {
    const sf = byPath.get(rec.localPath);
    if (!sf) {
      problems.push({ localPath: rec.localPath, fileName: rec.fileName, reason: 'not in the selected folder' });
      continue;
    }
    if (sf.size !== rec.size) {
      problems.push({
        localPath: rec.localPath,
        fileName: rec.fileName,
        reason: `size differs (${sf.size} ≠ ${rec.size})`,
      });
      continue;
    }
    candidates.push({ record: rec, file: sf.file, mediaKind: sf.mediaKind });
  }

  const hashes = await hashAll(
    candidates.map((c) => ({ id: c.record.localPath, file: c.file, fileKind: c.mediaKind })),
  );

  const attached = new Map<string, File>();
  for (const c of candidates) {
    // A record that never finished Inspect before the interruption has no
    // prior hash to compare against — path + size matching is all there is
    // to check; it proceeds into (re-)processing, not a hash mismatch.
    if (c.record.sha256 !== undefined && hashes.get(c.record.localPath) !== c.record.sha256) {
      problems.push({
        localPath: c.record.localPath,
        fileName: c.record.fileName,
        reason: 'content hash differs from the original',
      });
      continue;
    }
    attached.set(c.record.localPath, c.file);
  }
  return { attached, problems };
}

/**
 * Prompt the user to reselect the source folder. Uses the durable picker where
 * available (so the session can be upgraded to a persistent handle), and falls
 * back to a transient `<input webkitdirectory>` FileList otherwise.
 */
export async function reselectFolder(
  fallbackList?: FileList,
): Promise<{ scanned: ScannedFile[]; handle?: FileSystemDirectoryHandle } | null> {
  if (fallbackList) return { scanned: scanFileList(fallbackList) };
  if (supportsDirectoryHandle) {
    const handle = await pickDirectory();
    if (!handle) return null;
    return { scanned: await scanDirectoryHandle(handle), handle };
  }
  return null;
}
