// Upload orchestration. Runs the full publish sequence for one bundle:
//
//   1. Stream every image blob under the upload prefix (bounded concurrency,
//      exponential backoff + jitter on transient failures, HEAD verify).
//   2. Write the three CSVs.
//   3. Write UploadMeta.json — upstream SPARC'd's completion marker, so it
//      lands after the blobs and CSVs.
//   4. Write UploadComplete.json last — this project's richer integrity sentinel.
//
// Ordering is the half-populated-directory guard: an upstream reader only
// treats the prefix as complete once UploadMeta.json exists, by which point
// the blobs and CSVs are already in place.
//
// Dry-run (default on for the first session) walks the same sequence but issues
// no PUTs — it logs every write the run would make (bucket, key, size, hash) —
// and persists nothing, since there is nothing to resume.
//
// Re-stamp retry (fresh runs only): a 412 on any final-prefix metadata object
// means another uploader took this `<stamp>_<user>` prefix. We abandon it, bump
// the stamp by one second, rebuild the bundle (new prefix → new keys), and
// retry the whole run once; a second collision surfaces. Abandoned blobs are
// orphans — this tool never deletes (open question 5 lean: auto-retry once,
// then surface).
//
// Resume (P5): a wet run persists its session to IndexedDB (Dexie) and updates
// per-file state as blobs land. `resumeUpload` replays a persisted session
// against reattached source files — completed blobs are skipped after a
// statObject size/hash sanity check, and interrupted files restart from
// scratch (mid-file multipart resume is a follow-on, not v0). The prefix is
// reused, so a 412 on a metadata write is treated as "already written, skip"
// rather than a re-stamp.
//
// Bounded concurrency is a small inline lane pool rather than p-limit: lanes
// lazily pull the next blob, so memory stays flat across thousands of files and
// a hard failure aborts the in-flight set at once.

import type { S3Config } from '@sparcd/types';
import { PreconditionFailedError } from '@sparcd/s3-safe';
import { getClient } from './s3';
import {
  buildBundle,
  resolveBatchNaming,
  planItemFor,
  type BuildInput,
  type UploadItem,
} from './bundle';
import { locationToDeployment } from './locations';
import type { FileEntry } from '../store';
import {
  fileRecordId,
  openSession,
  attachBundle,
  markFileState,
  markBatchComplete,
  type BatchRecord,
  type BundleRecord,
  type FileAccessMode,
  type FileRecord,
  type LoadedSession,
} from './db';

export type UploadPhase = 'idle' | 'blobs' | 'metadata' | 'partial' | 'done' | 'error';
// 'inspecting': part of the batch, not yet processed by Inspect — only
// reachable via a streamed run; a fixed-plan run never has such a file.
export type FileState = 'inspecting' | 'pending' | 'uploading' | 'verifying' | 'done' | 'skipped' | 'failed';

export type FileProgress = {
  id: string;
  key: string;
  size: number;
  loaded: number;
  state: FileState;
  attempt: number;
  error?: string;
};

export type LogLine = { kind: 'put' | 'info' | 'warn' | 'error'; text: string };

export type UploadSnapshot = {
  version: number; // bumped each emit so React re-renders the live arrays
  sessionId: string;
  phase: UploadPhase;
  dryRun: boolean;
  files: FileProgress[];
  uploadedBytes: number;
  totalBytes: number;
  log: LogLine[];
  uploadPath?: string;
  bucket: string;
  metadataBundleSha256?: string;
  error?: string;
};

export type UploadParams = {
  config: S3Config;
  build: Omit<BuildInput, 'now'>;
  dryRun: boolean;
  concurrency: number; // parallel blob lanes
  // Resume metadata persisted in the batch row; absent for dry runs.
  uploaderUser?: string; // raw identity (the slug lives in build.uploaderSlug)
  fileAccessMode?: FileAccessMode;
  dirHandle?: FileSystemDirectoryHandle | null;
};

export type ResumeParams = {
  config: S3Config;
  session: LoadedSession;
  attached: Map<string, File>; // localPath → reattached source file
  concurrency: number;
};

export type UploadRun = { cancel: () => void; done: Promise<void> };

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
// Ten independent blob failures usually means credentials, CORS, or endpoint policy, not bad files.
const MAX_FILE_FAILURES = 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Clock-skew errors surface as a 403 but are worth retrying: against a
// load-balanced MinIO, a single node that has drifted off NTP rejects a request
// as skewed while its siblings accept it, so a retry usually lands on a healthy
// node. (The front proxy stamps a correct Date header, so the SDK's own
// clock-skew correction can't fix it — the app-level retry is what recovers.)
const CLOCK_SKEW_CODES = new Set(['RequestTimeTooSkewed', 'RequestExpired', 'RequestInTheFuture']);

// A 412 (precondition) or an access denial is never worth retrying; network
// blips, 5xx, 429, and clock-skew are. Default to transient only when we
// recognize it.
function isTransient(err: unknown): boolean {
  if (err instanceof PreconditionFailedError) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name && CLOCK_SKEW_CODES.has(e.name)) return true;
  const status = e.$metadata?.httpStatusCode;
  if (status === undefined) return true; // network/CORS/DNS — worth a retry
  if (status >= 500 || status === 429) return true;
  return false;
}

function isRunFatalBlobError(err: unknown): boolean {
  if (err instanceof PreconditionFailedError) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 403 || status === 501;
}

// Full jitter: random in [0, base * 2^attempt].
const backoff = (attempt: number) => Math.random() * (BASE_BACKOFF_MS * 2 ** attempt);

// A statObject 404 (the object isn't there) is a recognizable shape; anything
// without a 2xx/expected stat means "re-upload".
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey';
}

/** A single blob to (maybe) upload, with whether the persisted state says done. */
type PlanItem = {
  id: string;
  localPath: string;
  fileName: string;
  objectName: string;
  key: string;
  size: number;
  sha256: string;
  captureTimestamp?: string;
  mediaKind: FileRecord['mediaKind'];
  mimeType: string;
  file: File | null;
  doneAlready: boolean;
};

type RunPlan = {
  sessionId: string;
  bucket: string;
  uploadPath: string;
  totalBytes: number;
  metadataBundleSha256: string;
  items: PlanItem[];
  writes: { name: string; body: string; contentType: string }[];
};

const metadataWrites = (b: {
  deploymentsCsv: string;
  mediaCsv: string;
  observationsCsv: string;
  uploadMetaJson: string;
  uploadCompleteJson: string;
}): RunPlan['writes'] => [
  { name: 'deployments.csv', body: b.deploymentsCsv, contentType: 'text/csv' },
  { name: 'media.csv', body: b.mediaCsv, contentType: 'text/csv' },
  { name: 'observations.csv', body: b.observationsCsv, contentType: 'text/csv' },
  { name: 'UploadMeta.json', body: b.uploadMetaJson, contentType: 'application/json' },
  { name: 'UploadComplete.json', body: b.uploadCompleteJson, contentType: 'application/json' },
];

const fileRecordFor = (sessionId: string, it: UploadItem, state: FileRecord['state']): FileRecord => ({
  id: fileRecordId(sessionId, it.localPath),
  sessionId,
  localPath: it.localPath,
  fileName: it.fileName,
  relPathInBundle: it.objectName,
  sanitizedObjectName: it.objectName,
  size: it.size,
  sha256: it.sha256,
  captureTimestamp: it.captureTimestamp,
  mediaKind: it.mediaKind,
  mimeType: it.mimeType,
  state,
  remoteKey: it.key,
  attempt: 0,
});

/** A file record for a scanned-but-not-yet-processed file — everything a
 * streamed session knows about it before its own Inspect pass finishes. */
const awaitingFileRecordFor = (sessionId: string, f: { id: string; relPath: string; fileName: string; size: number }): FileRecord => ({
  id: fileRecordId(sessionId, f.id),
  sessionId,
  localPath: f.id,
  fileName: f.fileName,
  relPathInBundle: f.relPath,
  size: f.size,
  state: 'awaiting-processing',
  attempt: 0,
});

/**
 * Minimal async queue: `push` enqueues, `close` signals no more items will
 * ever arrive, `next` resolves the next item or `null` once closed and
 * drained. Lets a bounded set of lanes pull work that arrives over time
 * (files finishing Inspect one at a time) instead of from a fixed array.
 */
function makeAsyncQueue<T>() {
  const items: T[] = [];
  let closed = false;
  // Every concurrency lane can be waiting on `next()` at once — a single
  // waiter slot would let a later lane's wait overwrite an earlier one's,
  // permanently orphaning it (its promise never resolves, so `Promise.all`
  // over the lanes never settles and the run hangs). Wake every waiter on
  // any push/close; each re-checks the loop condition for itself.
  const waiters = new Set<() => void>();
  const wake = () => {
    for (const w of waiters) w();
    waiters.clear();
  };
  return {
    push(item: T): void {
      items.push(item);
      wake();
    },
    close(): void {
      closed = true;
      wake();
    },
    async next(): Promise<T | null> {
      for (;;) {
        if (items.length > 0) return items.shift()!;
        if (closed) return null;
        await new Promise<void>((resolve) => {
          waiters.add(resolve);
        });
      }
    },
  };
}

/**
 * The shared executor over a RunPlan. Used by both a fresh run and a resume; the
 * differences are: `persist` (write Dexie state as blobs land), `isResume`
 * (treat a metadata 412 as already-written rather than a collision to re-stamp),
 * and `dryRun` (log only).
 */
function makeRunner(
  config: S3Config,
  concurrency: number,
  onUpdate: (snap: UploadSnapshot) => void,
  opts: { persist: boolean; isResume: boolean; dryRun: boolean },
) {
  const { persist, isResume, dryRun } = opts;
  const client = getClient(config);
  let cancelled = false;
  let abort = new AbortController();

  const snap: UploadSnapshot = {
    version: 0,
    sessionId: '',
    phase: 'idle',
    dryRun,
    files: [],
    uploadedBytes: 0,
    totalBytes: 0,
    log: [],
    bucket: '',
  };

  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return; // coalesce byte-progress spam
    lastEmit = now;
    snap.version++;
    onUpdate({ ...snap });
  };
  const log = (kind: LogLine['kind'], text: string) => {
    snap.log.push({ kind, text });
    emit(true);
  };

  const persistFile = (sessionId: string, localPath: string, patch: Partial<FileRecord>) => {
    if (persist) void markFileState(fileRecordId(sessionId, localPath), patch);
  };

  // Upload (or skip) one blob. Returns once the object is present and verified,
  // or throws on a non-recoverable failure.
  const processItem = async (sessionId: string, fp: FileProgress, it: PlanItem): Promise<void> => {
    // A completed blob from a prior run: sanity-check the remote copy before
    // skipping it. Size + recorded SHA-256 metadata is the portable contract.
    const verifyExisting = async (): Promise<boolean> => {
      try {
        const stat = await client.statObject(snap.bucket, it.key);
        if (stat.size === it.size && stat.metadata.sha256 === it.sha256) {
          fp.state = 'skipped';
          snap.uploadedBytes += it.size - fp.loaded;
          fp.loaded = it.size;
          log('info', `verified, skip: ${it.key}`);
          emit(true);
          return true;
        }
        log('warn', `remote mismatch: ${it.key}`);
      } catch (err) {
        if (isNotFound(err)) log('warn', `remote missing, re-uploading: ${it.key}`);
        else throw err;
      }
      return false;
    };

    if (it.doneAlready) {
      if (await verifyExisting()) return;
    }

    if (!it.file) {
      fp.state = 'failed';
      fp.error = 'source file unavailable — reselect the folder';
      persistFile(sessionId, it.localPath, { state: 'failed', lastError: fp.error });
      log('error', `${it.key}: ${fp.error}`);
      throw new Error(fp.error);
    }

    for (let attempt = 0; ; attempt++) {
      if (cancelled) throw new Error('cancelled');
      fp.attempt = attempt + 1;
      fp.state = 'uploading';
      snap.uploadedBytes -= fp.loaded; // reset this file's contribution on retry
      fp.loaded = 0;
      emit(true);
      try {
        const { etag } = await client.writeImmutableStream(snap.bucket, it.key, it.file, {
          sha256: it.sha256,
          contentType: it.mimeType,
          signal: abort.signal,
          onProgress: (loaded) => {
            snap.uploadedBytes += loaded - fp.loaded;
            fp.loaded = loaded;
            emit();
          },
        });
        // Portable verification: HEAD and confirm size + recorded digest.
        fp.state = 'verifying';
        emit(true);
        const stat = await client.statObject(snap.bucket, it.key);
        if (stat.size !== fp.size) throw new Error(`size mismatch (${stat.size} ≠ ${fp.size})`);
        if (stat.metadata.sha256 !== it.sha256) throw new Error('sha256 metadata mismatch');
        fp.state = 'done';
        persistFile(sessionId, it.localPath, {
          state: 'done',
          remoteETag: etag,
          attempt: fp.attempt,
        });
        emit(true);
        return;
      } catch (err) {
        if (err instanceof PreconditionFailedError) {
          // Fresh runs must not silently accept a blob collision. Resume can
          // accept an existing key only after the portable size/hash HEAD check.
          if (isResume && (await verifyExisting())) {
            persistFile(sessionId, it.localPath, { state: 'done' });
            return;
          }
          throw err;
        }
        // A user cancel or a sibling lane's fatal failure aborts the signal;
        // don't retry an aborted request — let the run unwind.
        if (cancelled || abort.signal.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt + 1 >= MAX_ATTEMPTS || !isTransient(err)) {
          fp.state = 'failed';
          fp.error = msg;
          persistFile(sessionId, it.localPath, { state: 'failed', lastError: msg, attempt: fp.attempt });
          log('error', `failed ${it.key}: ${msg}`);
          throw err;
        }
        const wait = backoff(attempt);
        log('warn', `retry ${it.key} (attempt ${attempt + 2}) after ${Math.round(wait)}ms: ${msg}`);
        await sleep(wait);
      }
    }
  };

  // One attempt at the whole sequence for a given plan. Throws
  // PreconditionFailedError on a final-prefix metadata collision (fresh runs
  // re-stamp; resumes skip).
  const runOnce = async (plan: RunPlan): Promise<void> => {
    abort = new AbortController(); // fresh signal per attempt
    snap.sessionId = plan.sessionId;
    snap.bucket = plan.bucket;
    snap.uploadPath = plan.uploadPath;
    snap.metadataBundleSha256 = plan.metadataBundleSha256;
    snap.totalBytes = plan.totalBytes;
    snap.uploadedBytes = 0;
    snap.files = plan.items.map((it) => ({
      id: it.id,
      key: it.key,
      size: it.size,
      loaded: 0,
      state: 'pending' as FileState,
      attempt: 0,
    }));
    const byId = new Map(snap.files.map((f) => [f.id, f]));

    // --- Phase 1: blobs ---
    snap.phase = 'blobs';
    const remaining = plan.items.filter((it) => !it.doneAlready).length;
    log(
      'info',
      `${plan.items.length} blobs → ${plan.uploadPath}/` +
        (remaining !== plan.items.length ? ` (${plan.items.length - remaining} already done)` : ''),
    );

    if (dryRun) {
      for (const it of plan.items) {
        const fp = byId.get(it.id)!;
        fp.state = 'done';
        fp.loaded = it.size;
        snap.uploadedBytes += it.size;
        log('put', `PUT ${snap.bucket}/${it.key} (${it.size} B, sha256 ${it.sha256.slice(0, 12)}…)`);
      }
      emit(true);
    } else {
      let next = 0;
      let fatal: unknown = null;
      let fileFailures = 0;
      const lane = async (): Promise<void> => {
        for (;;) {
          if (cancelled || fatal) return;
          const i = next++;
          if (i >= plan.items.length) return;
          const it = plan.items[i];
          try {
            await processItem(plan.sessionId, byId.get(it.id)!, it);
          } catch (err) {
            if (cancelled || abort.signal.aborted) return;
            if (isRunFatalBlobError(err)) {
              if (!fatal) {
                fatal = err;
                abort.abort(); // stop sibling lanes' in-flight requests at once
              }
              return;
            }
            fileFailures++;
            if (fileFailures >= MAX_FILE_FAILURES && !fatal) {
              fatal = new Error(
                `aborted after ${MAX_FILE_FAILURES} file failures — the problem looks systemic, not per-file`,
              );
              abort.abort(); // stop sibling lanes' in-flight requests at once
              return;
            }
            if (fatal) return;
            continue;
          }
        }
      };
      const lanes = Math.max(1, Math.min(concurrency, plan.items.length));
      await Promise.all(Array.from({ length: lanes }, lane));
      if (fatal) throw fatal;
    }

    if (cancelled) throw new Error('cancelled');

    const failed = snap.files.filter((f) => f.state === 'failed').length;
    if (failed > 0) {
      log(
        'warn',
        `${failed} files failed — metadata not written; retry the failed files to complete the upload`,
      );
      snap.phase = 'partial';
      emit(true);
      return;
    }

    // --- Phase 2: metadata, in publish order ---
    snap.phase = 'metadata';
    emit(true);
    await writeMetadata(plan.writes, plan.uploadPath);
  };

  // Shared by a fixed-plan run and a streamed run: writes the CSVs/JSON in
  // publish order, dry-run logs instead of PUTting, and treats a 412 as
  // already-written (idempotent) only on resume — a fresh run must not
  // silently accept a metadata collision.
  const writeMetadata = async (writes: RunPlan['writes'], uploadPath: string): Promise<void> => {
    for (const w of writes) {
      const key = `${uploadPath}/${w.name}`;
      if (dryRun) {
        log('put', `PUT ${snap.bucket}/${key} (${new TextEncoder().encode(w.body).length} B)`);
        continue;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          await client.writeImmutable(snap.bucket, key, w.body, { contentType: w.contentType });
          log('info', `wrote ${key}`);
          break;
        } catch (err) {
          if (err instanceof PreconditionFailedError) {
            if (isResume) {
              log('info', `already present, skip: ${key}`);
              break;
            }
            throw err;
          }
          if (attempt + 1 >= MAX_ATTEMPTS || !isTransient(err)) throw err;
          await sleep(backoff(attempt));
        }
      }
    }
  };

  /**
   * Stream blobs from a live queue instead of a fixed plan — items arrive as
   * files individually finish Inspect (see `runStreamingUpload`). Blocks in
   * the 'blobs' phase until `queue.close()` has been called (every file in
   * the batch is known and enqueued) and every enqueued item has settled;
   * only then does it enter the metadata phase, building the bundle via
   * `buildMetadata` — called exactly once, after the blob queue is fully
   * drained, so it always sees the complete set.
   */
  const runStreaming = async (
    seed: {
      sessionId: string;
      bucket: string;
      uploadPath: string;
      totalBytes: number; // the FULL batch's total, known from the scan — not grown incrementally
      initialFiles: FileProgress[]; // placeholder ('inspecting') or real ('pending') entry per known file
    },
    queue: ReturnType<typeof makeAsyncQueue<PlanItem>>,
    buildMetadata: () => Promise<{ writes: RunPlan['writes']; metadataBundleSha256: string }>,
  ): Promise<void> => {
    abort = new AbortController();
    snap.sessionId = seed.sessionId;
    snap.bucket = seed.bucket;
    snap.uploadPath = seed.uploadPath;
    snap.totalBytes = seed.totalBytes;
    snap.files = seed.initialFiles;
    snap.phase = 'blobs';
    emit(true);

    let fatal: unknown = null;
    let fileFailures = 0;
    const lane = async (): Promise<void> => {
      for (;;) {
        if (cancelled || fatal) return;
        const it = await queue.next();
        if (it === null) return;
        const fp: FileProgress = { id: it.id, key: it.key, size: it.size, loaded: 0, state: 'pending', attempt: 0 };
        const idx = snap.files.findIndex((f) => f.id === it.id);
        if (idx >= 0) snap.files[idx] = fp;
        else snap.files.push(fp);
        emit(true);
        if (dryRun) {
          fp.state = 'done';
          fp.loaded = it.size;
          snap.uploadedBytes += it.size;
          log('put', `PUT ${snap.bucket}/${it.key} (${it.size} B, sha256 ${it.sha256.slice(0, 12)}…)`);
          emit(true);
          continue;
        }
        try {
          await processItem(seed.sessionId, fp, it);
        } catch (err) {
          if (cancelled || abort.signal.aborted) return;
          if (isRunFatalBlobError(err)) {
            if (!fatal) {
              fatal = err;
              abort.abort();
            }
            return;
          }
          fileFailures++;
          if (fileFailures >= MAX_FILE_FAILURES && !fatal) {
            fatal = new Error(
              `aborted after ${MAX_FILE_FAILURES} file failures — the problem looks systemic, not per-file`,
            );
            abort.abort();
            return;
          }
          if (fatal) return;
          continue;
        }
      }
    };

    const lanes = Math.max(1, concurrency);
    await Promise.all(Array.from({ length: lanes }, lane));
    if (fatal) throw fatal;
    if (cancelled) throw new Error('cancelled');

    // The blob loop only exits normally (no fatal/cancel) once the queue is
    // closed and drained — the caller only closes it once every file in the
    // batch is known — so the full set is always available here, whether or
    // not every blob actually succeeded. Build (and persist) the bundle
    // unconditionally: on a partial failure this gives a later retry a real,
    // byte-identical ledger to resume from instead of starting over: it's
    // just not written to S3 until every blob has actually landed.
    const { writes, metadataBundleSha256 } = await buildMetadata();
    snap.metadataBundleSha256 = metadataBundleSha256;

    const failed = snap.files.filter((f) => f.state === 'failed').length;
    if (failed > 0) {
      log(
        'warn',
        `${failed} files failed — metadata not published; retry the failed files to complete the upload`,
      );
      snap.phase = 'partial';
      emit(true);
      return;
    }

    snap.phase = 'metadata';
    emit(true);
    await writeMetadata(writes, snap.uploadPath!);
  };

  return {
    snap,
    log,
    emit,
    runOnce,
    runStreaming,
    cancel: () => {
      cancelled = true;
      abort.abort();
    },
    isCancelled: () => cancelled,
  };
}

export type StreamingUploadRun = {
  cancel: () => void;
  done: Promise<void>;
  /** Enqueue files the caller has observed finish Inspect successfully. */
  notifyReady: (files: FileEntry[]) => void;
  /** Signal that every file in the batch is now known — no more files will
   * ever be enqueued (the caller's `processingComplete(files)` became true).
   * `finalFiles` is the complete batch, used to build the metadata bundle
   * once the blob queue drains. */
  close: (finalFiles: FileEntry[]) => void;
};

/**
 * Upload as files individually finish Inspect, instead of waiting for the
 * whole batch. Every file's object key is frozen once, immediately, from the
 * full scanned listing (names/collisions never depend on file content) — so
 * a blob can upload the moment its own hash is ready, with no risk of ever
 * needing to rename something already on S3. The metadata/CSV publish step
 * is unchanged in behavior: it still only fires once, atomically, after
 * every file is known and every blob has landed — nothing partial is ever
 * visible to anything reading the bucket.
 *
 * Simplification vs. `runUpload`: a metadata-prefix collision (`412`) is
 * treated as a hard error rather than auto-retried under a new stamp — that
 * collision only happens on genuinely concurrent identical-second uploads,
 * a rare edge case not worth the added complexity here yet.
 */
export function runStreamingUpload(
  params: UploadParams,
  onUpdate: (snap: UploadSnapshot) => void,
): StreamingUploadRun {
  const { config, build, dryRun, concurrency } = params;
  const persist = !dryRun;
  const runner = makeRunner(config, concurrency, onUpdate, { persist, isResume: false, dryRun });
  const sessionId = crypto.randomUUID();
  runner.snap.sessionId = sessionId;

  const now = new Date();
  const naming = resolveBatchNaming({
    collectionUuid: build.collectionUuid,
    uploaderSlug: build.uploaderSlug,
    now,
    files: build.files,
  });

  const queue = makeAsyncQueue<PlanItem>();
  const enqueuedIds = new Set<string>();
  let finalFiles: FileEntry[] | null = null;

  const enqueue = (f: FileEntry): void => {
    if (f.processState !== 'ready' || !f.sha256 || enqueuedIds.has(f.id)) return;
    enqueuedIds.add(f.id);
    const item = planItemFor(f, naming, build.timeZone);
    queue.push({ ...item, doneAlready: false });
    if (persist) void markFileState(fileRecordId(sessionId, item.localPath), fileRecordFor(sessionId, item, 'pending'));
  };

  if (persist) {
    const deploymentId = locationToDeployment(build.location, build.collectionUuid).deploymentId;
    const batch: BatchRecord = {
      id: sessionId,
      targetBucket: build.bucket,
      uploadPrefix: naming.uploadPath,
      deploymentId,
      location: build.location,
      uploaderUser: params.uploaderUser ?? build.uploaderSlug,
      uploaderSlug: build.uploaderSlug,
      collectionUuid: build.collectionUuid,
      description: build.description,
      startedAt: new Date().toISOString(),
      totalFiles: build.files.length,
      totalBytes: build.files.reduce((n, f) => n + f.size, 0),
      uploadTimeZone: build.timeZone,
      fileAccessMode: params.fileAccessMode ?? 'reselect-required',
      dirHandle: params.dirHandle ?? undefined,
    };
    const initialRecords = build.files.map((f) =>
      f.processState === 'ready' && f.sha256
        ? fileRecordFor(sessionId, planItemFor(f, naming, build.timeZone), 'pending')
        : awaitingFileRecordFor(sessionId, f),
    );
    void openSession(batch, initialRecords);
  }

  const initialFiles: FileProgress[] = build.files.map((f) => ({
    id: f.id,
    key: '',
    size: f.size,
    loaded: 0,
    state: f.processState === 'ready' && f.sha256 ? 'pending' : 'inspecting',
    attempt: 0,
  }));

  for (const f of build.files) enqueue(f);

  const done = (async () => {
    try {
      await runner.runStreaming(
        {
          sessionId,
          bucket: build.bucket,
          uploadPath: naming.uploadPath,
          totalBytes: build.files.reduce((n, f) => n + f.size, 0),
          initialFiles,
        },
        queue,
        async () => {
          const files = finalFiles ?? build.files;
          const bundle = await buildBundle({ ...build, files, now, naming });
          if (persist) {
            const bundleRec: BundleRecord = {
              sessionId,
              uploadMetaJson: bundle.uploadMetaJson,
              deploymentsCsv: bundle.deploymentsCsv,
              mediaCsv: bundle.mediaCsv,
              observationsCsv: bundle.observationsCsv,
              uploadCompleteJson: bundle.uploadCompleteJson,
              metadataBundleSha256: bundle.metadataBundleSha256,
            };
            await attachBundle(bundleRec);
          }
          return { writes: metadataWrites(bundle), metadataBundleSha256: bundle.metadataBundleSha256 };
        },
      );
      if (runner.snap.phase !== 'partial') {
        runner.snap.phase = 'done';
        if (persist) await markBatchComplete(sessionId, new Date().toISOString());
        runner.log('info', dryRun ? 'dry-run complete — nothing written' : `published ${naming.uploadPath}/`);
        runner.emit(true);
      }
    } catch (err) {
      if (runner.isCancelled()) {
        runner.snap.phase = 'error';
        runner.snap.error = 'cancelled';
        runner.log('warn', 'cancelled');
        return;
      }
      runner.snap.phase = 'error';
      runner.snap.error = err instanceof Error ? err.message : String(err);
      runner.log('error', runner.snap.error);
      runner.emit(true);
    }
  })();

  return {
    cancel: runner.cancel,
    done,
    notifyReady: (files) => {
      for (const f of files) enqueue(f);
    },
    close: (files) => {
      finalFiles = files;
      queue.close();
    },
  };
}

/**
 * Resume a persisted session against reattached source files. The prefix and
 * keys are reused verbatim, so completed blobs skip (after a sanity check) and
 * only the interrupted/pending files re-upload. Always a wet run.
 *
 * A streamed run that's interrupted before every file finished Inspect has no
 * bundle yet — `session.bundle` is null. There's nothing byte-identical to
 * republish in that case (the CSVs were never built), and re-driving Inspect
 * standalone outside the live wizard session is out of scope here — this
 * surfaces a clear, actionable error instead of attempting it. No data is
 * lost: blobs already uploaded stay on S3 under their (deterministic, keyed
 * by content) object names, and starting a fresh upload with the same folder
 * will detect and skip them automatically via the normal verify-before-upload
 * check.
 */
export function resumeUpload(
  params: ResumeParams,
  onUpdate: (snap: UploadSnapshot) => void,
): UploadRun {
  const { config, session, attached, concurrency } = params;
  const { batch, bundle, files } = session;
  const runner = makeRunner(config, concurrency, onUpdate, {
    persist: true,
    isResume: true,
    dryRun: false,
  });
  runner.snap.sessionId = batch.id;

  if (!bundle) {
    const done = (async () => {
      runner.snap.phase = 'error';
      runner.snap.error =
        'This upload was interrupted before every file finished being inspected, so there is no publish-ready bundle to resume. Start a fresh upload with the same folder — files already uploaded will be detected and skipped automatically.';
      runner.log('error', runner.snap.error);
      runner.emit(true);
    })();
    return { cancel: runner.cancel, done };
  }

  // A bundle exists, so per the streamed-open invariant every record here has
  // already finished Inspect (never 'awaiting-processing') — filter defensively
  // rather than trust that blindly, since a corrupted/foreign row shouldn't
  // crash a resume.
  const processedFiles = files.filter((r) => r.state !== 'awaiting-processing' && r.sha256 !== undefined);

  const plan: RunPlan = {
    sessionId: batch.id,
    bucket: batch.targetBucket,
    uploadPath: batch.uploadPrefix,
    totalBytes: processedFiles.reduce((n, f) => n + f.size, 0),
    metadataBundleSha256: bundle.metadataBundleSha256,
    items: processedFiles.map((r) => ({
      id: r.localPath,
      localPath: r.localPath,
      fileName: r.fileName,
      objectName: r.sanitizedObjectName!,
      key: r.remoteKey!,
      size: r.size,
      sha256: r.sha256!,
      captureTimestamp: r.captureTimestamp,
      mediaKind: r.mediaKind!,
      mimeType: r.mimeType!,
      file: attached.get(r.localPath) ?? null,
      doneAlready: r.state === 'done',
    })),
    writes: metadataWrites(bundle),
  };

  const done = (async () => {
    try {
      runner.log('info', `resuming ${batch.uploadPrefix}/`);
      await runner.runOnce(plan);
      if (runner.snap.phase !== 'partial') {
        runner.snap.phase = 'done';
        await markBatchComplete(batch.id, new Date().toISOString());
        runner.log('info', `published ${batch.uploadPrefix}/`);
        runner.emit(true);
      }
    } catch (err) {
      if (runner.isCancelled()) {
        runner.snap.phase = 'error';
        runner.snap.error = 'cancelled';
        runner.log('warn', 'cancelled');
        return;
      }
      runner.snap.phase = 'error';
      runner.snap.error = err instanceof Error ? err.message : String(err);
      runner.log('error', runner.snap.error);
      runner.emit(true);
    }
  })();

  return { cancel: runner.cancel, done };
}
