import { loadMasterSpecies } from './masterSpecies';
// Handing a not-yet-uploaded batch to the tagger, and taking it back.
//
// Out: everything the tagger needs to show and tag the batch offline — the
// per-file identity the uploader already computed, the thumbnails it already
// made, and (where the browser granted one) the folder handle that gets it
// full-resolution bytes. Then a same-tab navigation to the tagger.
//
// Back: `?flip=<id>` on the uploader's own URL. The record still holds every
// file's Inspect result, so the only thing that has to be recovered is the
// `File` objects themselves — a browser reload drops those and nothing else.
// Source bytes are verified again after navigation or restart; names and sizes
// alone cannot establish that a file has not changed.

import {
  newFlipId,
  isValidFlipOwnerScope,
  deriveFlipOwnerScope,
  flipRecordUnavailableReason,
  readFlipRecord,
  writeFlipRecord,
  type FlipFile,
  type FlipRecord,
} from '@sparcd/flip';
import { assertPreparedSpecies } from './preparedSpecies';
import { useStore, type FileEntry } from '../store';
import { restoreFromHandle, reconcileReselect, reselectFolder, type ReconcileProblem } from './resume';
import type { ScannedFile } from './scanFiles';
import { flushPreparation, readPreparation, bindCurrentPreparationSpecies, recoveryGuard, readPreparationForFlip } from './preparation';
import { formatNaive } from './exifTime';
import { estimateCaptureTimes, type CaptureEstimate } from './estimateCaptureTime';
import { taggerBatchUrl, uploaderReturnUrl } from './siblings';

/** The flip id on this page load, if the tagger just sent the user back. */
export const returningFlipId = (): string | null =>
  new URLSearchParams(window.location.search).get('flip');

// Everything Inspect established travels, because the batch is rebuilt from
// this on the way back and there is no second Inspect pass to recover a field
// that didn't. Most of it only feeds the file list, but `mimeType` is the
// worker's own sniff and lands in media.csv — drop it and `mimeFor` falls back
// to the extension, so a batch that went through the tagger would publish
// different bytes from the same batch uploaded straight through.
const toFlipFile = (f: FileEntry, estimate: CaptureEstimate | undefined): FlipFile => ({
  relPath: f.relPath,
  fileName: f.fileName,
  size: f.size,
  sha256: f.sha256!,
  lastModified: f.file.lastModified,
  mediaKind: f.mediaKind,
  // Both wall-clocks, unconverted and kept apart. The upload zone is applied
  // later, at bundle build; and Inspect shows a camera time as read-only fact
  // but an entered time as the user's own correction, so collapsing the two
  // would bring a manual entry home disguised as EXIF.
  exifTimestamp: f.exifNaive ? formatNaive(f.exifNaive) : undefined,
  exifTimestampSource: f.exifTimestampSource,
  manualTimestamp: f.manualNaive ? formatNaive(f.manualNaive) : undefined,
  manualSpreadStart: f.manualSpreadStart ? formatNaive(f.manualSpreadStart) : undefined,
  manualSpreadMethod: f.manualSpreadMethod,
  manualSpreadTimeZone: f.manualSpreadTimeZone,
  estimatedTimestamp: estimate ? formatNaive(estimate.naive) : undefined,
  timestampSource: f.exifTimestampSource === 'exif-modify' && !f.manualNaive
    ? 'exif-modify'
    : f.manualNaive ? f.manualSource ?? 'manual' : f.exifNaive ? undefined : estimate?.method,
  mimeType: f.mimeType,
  exifCamera: f.exifCamera,
  gps: f.gps,
  width: f.width,
  height: f.height,
  thumb: f.thumbnail,
});

/**
 * Write the hand-off record for the current batch and navigate to the tagger.
 * Only files that finished Inspect travel: a file with no hash has no stable
 * identity to tag against, and the button is gated on a batch with no blocking
 * errors anyway.
 */
export async function handOffToTagger(): Promise<void> {
  const s = useStore.getState();
  const guard = recoveryGuard();
  await flushPreparation();
  const preparation = await readPreparation();
  const preparedSpecies = preparation ? preparation.species : await loadMasterSpecies(s.s3Config ?? undefined);
  guard();
  if (!preparedSpecies) throw new Error('Connect with the login that owns this batch and prepare species before opening Tagger. Your inspected files and tags are unchanged.');
  assertPreparedSpecies(preparedSpecies);
  const ownerScope = s.s3Config ? await deriveFlipOwnerScope(s.s3Config) : preparedSpecies.ownerScope;
  if (!isValidFlipOwnerScope(ownerScope) || ownerScope !== preparedSpecies.ownerScope) throw new Error('This prepared batch is not available for the connected login. Its saved work has been kept.');
  if (useStore.getState().batchToken !== s.batchToken || useStore.getState().s3Config !== s.s3Config) throw new Error('The batch or connection changed. Try tagging again.');
  await flushPreparation();
  const id = newFlipId();
  const estimates = estimateCaptureTimes(s.files, s.uploadTimeZone);
  await writeFlipRecord({
    id,
    v: 2,
    createdAt: new Date().toISOString(),
    returnUrl: uploaderReturnUrl(id, ownerScope),
    dirHandle: s.dirHandle ?? undefined,
    files: s.files.filter((f) => f.processState === 'ready' && f.sha256).map((f) => toFlipFile(f, estimates.get(f.id))),
    tags: Object.fromEntries(s.files.filter(f => f.preTags?.length).map(f => [f.relPath, f.preTags!])),
    preparedSpecies: structuredClone(preparedSpecies),
    ownerScope,
  });
  if (useStore.getState().batchToken !== s.batchToken || useStore.getState().s3Config !== s.s3Config) throw new Error('The batch or connection changed. Try tagging again.');
  guard();
  useStore.setState({ flipId: id });
  await flushPreparation();
  guard();
  window.location.href = taggerBatchUrl(id, ownerScope);
}

/** Re-enter the same tagging session — drafts live tagger-side, so it resumes. */
export async function reopenTagger(flipId: string): Promise<void> {
  const guard = recoveryGuard();
  const config = useStore.getState().s3Config;
  const ownerScope = config ? await deriveFlipOwnerScope(config) : returningFlipOwnerScope();
  if (!ownerScope) throw new Error('Reconnect with the login that owns this batch before reopening Tagger.');
  const record = await readFlipRecord(flipId, ownerScope);
  if (!record) throw new Error('This batch is not available for the connected login. Its saved work has been kept.');
  await flushPreparation();
  guard();
  window.location.href = taggerBatchUrl(flipId, ownerScope);
}

const toFileEntry = (f: FlipFile, file: File, record: FlipRecord): FileEntry => ({
  id: f.relPath,
  file: f.lastModified === undefined ? file : new File([file], file.name, { type: file.type, lastModified: f.lastModified }),
  relPath: f.relPath,
  fileName: f.fileName,
  size: f.size,
  mediaKind: f.mediaKind,
  processState: 'ready',
  sha256: f.sha256,
  exifNaive: parseNaive(f.exifTimestamp),
  // `timestampSource` is the effective publishing source. Keep the underlying
  // ModifyDate provenance separately so a manual correction remains stronger
  // than the stale EXIF candidate when the batch comes back from the Tagger.
  exifTimestampSource: f.exifTimestampSource ?? (f.timestampSource === 'exif-modify' ? 'exif-modify' : undefined),
  manualNaive: parseNaive(f.manualTimestamp),
  manualSource: f.timestampSource === 'manual' || f.timestampSource === 'spread' ? f.timestampSource : undefined,
  manualSpreadStart: parseNaive(f.manualSpreadStart),
  manualSpreadMethod: f.manualSpreadMethod,
  manualSpreadTimeZone: f.manualSpreadTimeZone,
  mimeType: f.mimeType,
  exifCamera: f.exifCamera,
  gps: f.gps,
  width: f.width,
  height: f.height,
  thumbnail: f.thumb,
  preTags: record.tags[f.relPath] ?? [],
  preTaggerUser: record.taggerUser,
});

// The inverse of `formatNaive` — the record carries the wall-clock as text, and
// the rest of the uploader works in components.
function parseNaive(iso: string | undefined): FileEntry['exifNaive'] {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6]),
  };
}

export type FlipReturn =
  /** The record is gone — a different origin in dev, or cleared storage. */
  | { kind: 'not-found'; message?: string }
  /** The folder handle needs a user gesture before it will hand back bytes. */
  | { kind: 'needs-gesture'; record: FlipRecord }
  /** No durable handle rode along; the folder has to be chosen again. */
  | { kind: 'needs-reselect'; record: FlipRecord }
  | { kind: 'restored' };

/**
 * Load the returning batch and put the wizard back on Inspect.
 *
 * A page load is not a user gesture, so on Firefox and Safari — and on
 * Chromium once the grant has lapsed — `requestPermission` will refuse. That
 * is the `needs-gesture` result, and the caller renders a button whose click
 * calls straight back in here; that click IS the gesture, which is why the
 * permission call has to stay ahead of every other await (see
 * `restoreFromHandle`).
 */
export async function resumeFromFlip(flipId: string): Promise<FlipReturn> {
  const guard = recoveryGuard();
  const config = useStore.getState().s3Config;
  const ownerScope = config ? await deriveFlipOwnerScope(config) : returningFlipOwnerScope();
  if (!ownerScope) return { kind: 'not-found', message: 'Reconnect with the login that owns this batch to return it to Uploader. The saved batch has been kept.' };
  const record = await readFlipRecord(flipId, ownerScope);
  guard();
  if (!record) return { kind: 'not-found', message: await flipRecordUnavailableReason(flipId, ownerScope) };
  return adoptRecord(record);
}

/** The retry a "Reopen batch" click drives, with the record already in hand. */
export async function adoptRecord(record: FlipRecord): Promise<FlipReturn> {
  const guard = recoveryGuard();
  await assertRecordOwner(record);
  if (!record.dirHandle) return { kind: 'needs-reselect', record };

  let restore: Awaited<ReturnType<typeof restoreFromHandle>>;
  try {
    restore = await restoreFromHandle(
      { dirHandle: record.dirHandle },
      Promise.resolve(record.files.map((f) => ({ localPath: f.relPath, fileName: f.fileName, size: f.size, sha256: f.sha256 }))),
    );
  } catch {
    guard();
    await assertRecordOwner(record);
    return { kind: 'needs-reselect', record };
  }
  guard();
  if (!restore.ok) return { kind: 'needs-gesture', record };

  if (!restore.attached.size && restore.problems.length) return { kind: 'needs-reselect', record };
  await attach(record, restore.attached, guard, restore.problems);
  return { kind: 'restored' };
}

/** Scope the OS picker and its folder scan to the same batch/connection as
 * verification. The picker can stay open while another tab disconnects. */
export async function reselectFlip(record: FlipRecord, list?: FileList): Promise<void> {
  const guard = recoveryGuard();
  // Input handlers clear their live FileList immediately after this call.
  // Capture the selection before asynchronously validating ownership.
  const originals = list ? Array.from(list) : undefined;
  await assertRecordOwner(record);
  const picked = await reselectFolder(originals);
  guard();
  await assertRecordOwner(record);
  if (picked) await adoptReselected(record, picked.scanned);
}

/** Verify the original bytes before attaching; keep all saved work on failure. */
export async function adoptReselected(
  record: FlipRecord,
  scanned: { relPath: string; size: number; file: File }[],
): Promise<void> {
  const guard = recoveryGuard();
  await assertRecordOwner(record);
  const result = await reconcileReselect(
    record.files.map(f => ({ localPath: f.relPath, fileName: f.fileName, size: f.size, sha256: f.sha256 })),
    scanned.map(f => ({ ...f, id: f.relPath, fileName: f.file.name, mediaKind: record.files.find(r => r.relPath === f.relPath)?.mediaKind ?? 'image' })) as ScannedFile[],
  );
  guard();
  if (!result.attached.size && result.problems.length) throw new Error(result.problems.map(p => `${p.fileName}: ${p.reason}`).join('; ') + '. Nothing was removed. Reselect the original unchanged folder.');
  await attach(record, result.attached, guard, result.problems);
}

async function attach(record: FlipRecord, attached: Map<string, File>, guard: () => void, problems: ReconcileProblem[]): Promise<void> {
  const preparation = await readPreparationForFlip(record.id);
  guard();
  const files: FileEntry[] = [];
  for (const f of record.files) {
    const file = attached.get(f.relPath);
    if (file) files.push(toFileEntry(f, file, record));
    else files.push({ ...toFileEntry(f, new File([], f.fileName), record), processState: 'error', needsOriginal: true,
      processError: problems.find(problem => problem.localPath === f.relPath)?.reason ?? 'Original file could not be verified' });
  }
  bindCurrentPreparationSpecies(record.preparedSpecies, preparation?.id);
  useStore.getState().adoptTaggedBatch({
    flipId: record.id,
    files,
    dirHandle: record.dirHandle ?? null,
  });
  if (preparation) useStore.setState({ mountainRange: '', dateCollected: '', uploadCommentDate: null, ...preparation.inputs });
}

/** The validated scope carried by an explicit offline return from Tagger. */
export function returningFlipOwnerScope(): string | null {
  const scope = new URLSearchParams(window.location.search).get('ownerScope');
  return isValidFlipOwnerScope(scope) ? scope : null;
}

async function assertRecordOwner(record: FlipRecord): Promise<string> {
  const config = useStore.getState().s3Config;
  const ownerScope = config ? await deriveFlipOwnerScope(config) : returningFlipOwnerScope();
  if (!record.ownerScope || ownerScope !== record.ownerScope) {
    throw new Error('This batch is not available for the connected login. Its saved work has been kept.');
  }
  return record.ownerScope;
}
