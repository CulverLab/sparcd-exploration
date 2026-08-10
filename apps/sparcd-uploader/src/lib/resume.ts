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

import type { BatchRecord, FileRecord, BundleRecord } from './db';
import { attachBundle, updateFileRecords } from './db';
import {
  pickDirectory,
  scanDirectoryHandle,
  scanFileList,
  supportsDirectoryHandle,
  type MediaKind,
  type ScannedFile,
} from './scanFiles';
import { processBatch, type ProcessResponse } from './processPool';
import { namingForUploadPath, objectKeyFor, buildBundleFromRecords, type ResolvedFileRecord } from './bundle';
import { naiveInZoneToUtcNaive } from './exifTime';

export type RestoreOk = {
  ok: true;
  attached: Map<string, File>; // localPath → reattached source file
  // Files whose recorded size/hash no longer match on disk — surfaced (never
  // attached) exactly as the reselect path does.
  problems: ReconcileProblem[];
  // Full Inspect-equivalent results for every attached file, from the same
  // re-hash pass — lets a caller resolve a record that never finished
  // Inspect in the original run (state `awaiting-processing`, no sha256 to
  // compare against) without re-processing it a second time.
  resolved: Map<string, ProcessResponse>;
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
 *
 * `requestPermission` needs a live user gesture (the Resume click) — Firefox
 * and Safari silently no-op it (no prompt, no error) if anything gets
 * awaited first, even a fast IndexedDB read. `recordsPromise` lets the
 * caller kick that load off in parallel instead of awaiting it up front;
 * it's only consumed here after the gated permission call resolves.
 */
export async function restoreFromHandle(
  batch: BatchRecord,
  recordsPromise: Promise<FileRecord[]>,
  onProgress?: (done: number, total: number) => void,
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

  const records = await recordsPromise;
  const scanned = await scanDirectoryHandle(handle);
  const { attached, problems, resolved } = await reconcileReselect(records, scanned, onProgress);
  return { ok: true, attached, problems, resolved };
}

// Hash (and otherwise Inspect) a set of files through the existing worker
// pool, returning localPath → full result. `onProgress` is throttled to
// ~150ms — re-hashing a large batch (thousands of files) can take real time,
// and firing on every single result would mean a React state update per file
// at the call site.
function hashAll(
  items: { id: string; file: File; fileKind: MediaKind }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ProcessResponse>> {
  return new Promise((resolve) => {
    const out = new Map<string, ProcessResponse>();
    if (items.length === 0) {
      resolve(out);
      return;
    }
    let done = 0;
    let lastReported = 0;
    const run = processBatch(
      items,
      () => {},
      (r) => {
        if (r.sha256) out.set(r.id, r);
        done++;
        const now = Date.now();
        if (onProgress && (now - lastReported >= 150 || done === items.length)) {
          lastReported = now;
          onProgress(done, items.length);
        }
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
 * A record with no prior hash (never finished Inspect before the interruption)
 * has nothing to compare against — path + size is all there is to check, and
 * this pass's own result becomes its first hash instead of a mismatch.
 */
export async function reconcileReselect(
  records: FileRecord[],
  scanned: ScannedFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ attached: Map<string, File>; problems: ReconcileProblem[]; resolved: Map<string, ProcessResponse> }> {
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

  const resolved = await hashAll(
    candidates.map((c) => ({ id: c.record.localPath, file: c.file, fileKind: c.mediaKind })),
    onProgress,
  );

  const attached = new Map<string, File>();
  for (const c of candidates) {
    const r = resolved.get(c.record.localPath);
    if (c.record.sha256 !== undefined && r?.sha256 !== c.record.sha256) {
      problems.push({
        localPath: c.record.localPath,
        fileName: c.record.fileName,
        reason: 'content hash differs from the original',
      });
      continue;
    }
    attached.set(c.record.localPath, c.file);
  }
  return { attached, problems, resolved };
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

export type EnsureBundleResult = { ok: true } | { ok: false; problems: ReconcileProblem[] };

/**
 * Resolve every still-`awaiting-processing` record from this reconciliation
 * pass's own re-hash results, then build and attach the metadata bundle a
 * session that was interrupted before it ever reached publish never got.
 * Reuses the batch's already-persisted `uploadPrefix` verbatim (not a fresh
 * stamp), so this publishes to the destination the original run was headed
 * for, not a new one — and it needs no source files besides what this
 * reconciliation pass already re-hashed, since bundle content is built from
 * record metadata alone (actual blob bytes are only needed later, when
 * `resumeUpload` itself streams them).
 *
 * A record whose fresh hash failed, or whose only capture-time source was a
 * manual Assign entry (not persisted for a file that never finished Inspect,
 * so unrecoverable here), surfaces as a blocking problem instead of silently
 * publishing incomplete metadata.
 */
export async function ensureBundle(
  batch: BatchRecord,
  session: { bundle: unknown; files: FileRecord[] },
  resolved: Map<string, ProcessResponse>,
): Promise<EnsureBundleResult> {
  if (session.bundle) return { ok: true };

  const naming = namingForUploadPath(
    batch.uploadPrefix,
    session.files.map((f) => ({ id: f.localPath, relPath: f.localPath, fileName: f.fileName })),
  );

  const problems: ReconcileProblem[] = [];
  const updated: FileRecord[] = [];

  for (const rec of session.files) {
    if (rec.state !== 'awaiting-processing') continue;
    const r = resolved.get(rec.localPath);
    if (!r || !r.sha256) {
      problems.push({ localPath: rec.localPath, fileName: rec.fileName, reason: 'could not be inspected' });
      continue;
    }
    const captureTimestamp = r.exifNaive ? naiveInZoneToUtcNaive(r.exifNaive, batch.uploadTimeZone) : '';
    if (!captureTimestamp) {
      problems.push({
        localPath: rec.localPath,
        fileName: rec.fileName,
        reason: 'no capture time — a manual entry made before the interruption cannot be recovered here',
      });
      continue;
    }
    const { objectName, key } = objectKeyFor(rec.localPath, r.sha256, naming);
    updated.push({
      ...rec,
      state: 'pending',
      sanitizedObjectName: objectName,
      relPathInBundle: objectName,
      remoteKey: key,
      sha256: r.sha256,
      captureTimestamp,
      exifCamera: r.exifCamera,
      mediaKind: r.mediaKind,
      mimeType: r.mimeType,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  if (updated.length > 0) await updateFileRecords(updated);

  const byLocalPath = new Map(updated.map((r) => [r.localPath, r]));
  const resolvedRecords: ResolvedFileRecord[] = session.files.map((rec) => {
    const r = byLocalPath.get(rec.localPath) ?? rec;
    return {
      fileName: r.fileName,
      size: r.size,
      sha256: r.sha256!,
      remoteKey: r.remoteKey!,
      captureTimestamp: r.captureTimestamp,
      mimeType: r.mimeType,
    };
  });

  const bundle = await buildBundleFromRecords({
    location: batch.location,
    collectionUuid: batch.collectionUuid,
    bucket: batch.targetBucket,
    uploaderSlug: batch.uploaderSlug,
    description: batch.description,
    uploadPath: batch.uploadPrefix,
    startedAt: new Date(batch.startedAt),
    files: resolvedRecords,
  });

  const bundleRecord: BundleRecord = {
    sessionId: batch.id,
    uploadMetaJson: bundle.uploadMetaJson,
    deploymentsCsv: bundle.deploymentsCsv,
    mediaCsv: bundle.mediaCsv,
    observationsCsv: bundle.observationsCsv,
    uploadCompleteJson: bundle.uploadCompleteJson,
    metadataBundleSha256: bundle.metadataBundleSha256,
  };
  await attachBundle(bundleRecord);
  return { ok: true };
}
