// Upload orchestration. Runs the full publish sequence for one bundle:
//
//   1. Stream every image blob (bounded concurrency, exponential backoff +
//      jitter on transient failures). Media layout: under `Media/<sha256>/`,
//      reusing an original already stored for the same bytes. Legacy layout:
//      under the upload prefix.
//   2. Write the metadata files. Legacy: the three CSVs, then UploadMeta.json
//      (upstream SPARC'd's completion marker), then UploadComplete.json, this
//      project's richer integrity sentinel. Media: media.csv last, because an
//      upload folder without it is not an upload yet.
//
// Ordering is the half-populated-directory guard: a reader only treats the
// folder as complete once its marker exists, by which point everything the
// metadata names is already in place.
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
// only after the existing object is read and its bytes match.
//
// Bounded concurrency is a small inline lane pool rather than p-limit: lanes
// lazily pull the next blob, so memory stays flat across thousands of files and
// a hard failure aborts the in-flight set at once. The pool size follows a live
// target — either the manual setting (readable mid-run) or the adaptive
// controller, which searches for the throughput knee and then holds it.
//
// Blob transfers stripe round-robin over the endpoint's live shard origins (see
// `probeShardClients`), sticky per item so a retry reuses the same connection.
// An item that fails twice on its shard finishes on the primary, which the run
// depends on anyway. Metadata, listings, and existing-object checks always go
// through the primary.

import { processingComplete } from './validation';
import { estimateCaptureTimes } from './estimateCaptureTime';
import type { S3Config } from '@sparcd/types';
import {
  PreconditionFailedError,
  type CollectionRef,
  type ObjectInfo,
  type ObjectStat,
  type SafeS3Client,
} from '@sparcd/s3-safe';
import { existingOriginal, mediaFolder, mediaObjectName, parseMedia } from '@sparcd/camtrap';
import { getClient, probeShardClients, type ShardSet } from './s3';
import { createAdaptiveController, type AdaptiveController } from './adaptiveConcurrency';
import {
  buildBundle,
  buildBundleFromRecords,
  resolveBatchNaming,
  planItemFor,
  type BuildInput,
  type Dropped,
  type Layout,
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

export type UploadPhase = 'idle' | 'preparing' | 'blobs' | 'metadata' | 'partial' | 'done' | 'error';
// 'inspecting': part of the batch, not yet processed by Inspect — only
// reachable via a streamed run; a fixed-plan run never has such a file.
export type FileState = 'inspecting' | 'pending' | 'uploading' | 'done' | 'skipped' | 'failed';

export type FileProgress = {
  id: string;
  key: string;
  size: number;
  loaded: number;
  state: FileState;
  attempt: number;
  error?: string;
  // Failed because the request never got an answer, not because storage said no.
  network?: boolean;
};

export type LogLine = { kind: 'put' | 'info' | 'warn' | 'error'; text: string };

export type UploadSnapshot = {
  version: number; // bumped each emit so React re-renders the live arrays
  sessionId: string;
  phase: UploadPhase;
  dryRun: boolean;
  files: FileProgress[];
  uploadedBytes: number;
  // Bytes credited by a verified skip rather than transferred over the wire.
  // `uploadedBytes - skippedBytes` is the only honest input to a rate.
  skippedBytes: number;
  totalBytes: number;
  log: LogLine[];
  uploadPath?: string;
  bucket: string;
  collectionUuid: string;
  metadataBundleSha256?: string;
  lanes?: number; // live blob-lane target, so the UI can show what adaptive settled on
  error?: string;
  // A partial run whose every failure was a lost connection: nothing needs
  // fixing, so the app retries it on its own.
  autoRetry?: boolean;
};

/**
 * How the blob lane count is decided. `manual` reads `get()` live on every
 * pull, so a mid-run slider change applies without restarting the run;
 * `adaptive` hands the target to the throughput controller.
 */
export type ConcurrencyControl = { mode: 'manual'; get: () => number } | { mode: 'adaptive' };

export type UploadParams = {
  config: S3Config;
  build: Omit<BuildInput, 'now'>;
  dryRun: boolean;
  concurrency: ConcurrencyControl; // parallel blob lanes
  // Resume metadata persisted in the batch row; absent for dry runs.
  uploaderUser?: string; // raw identity (the slug lives in build.uploaderSlug)
  fileAccessMode?: FileAccessMode;
  dirHandle?: FileSystemDirectoryHandle | null;
};

export type ResumeParams = {
  config: S3Config;
  session: LoadedSession;
  attached: Map<string, File>; // localPath → reattached source file
  concurrency: ConcurrencyControl;
};

export type UploadRun = { cancel: () => void; done: Promise<void> };

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
// Ten independent blob failures usually means credentials, CORS, or endpoint policy, not bad files.
const MAX_FILE_FAILURES = 10;
// How often the supervisor refills the pool. Lanes also pump on every landed
// item; the interval is what notices a raised target while every lane is busy
// with a long file.
const SUPERVISOR_MS = 1_000;

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
  // A 403 whose specific reason can't even be read — CORS hides the response
  // body cross-origin for some error responses, so the SDK falls back to a
  // generic `UnknownError` with no code to check against CLOCK_SKEW_CODES
  // above — is indistinguishable from that same load-balanced clock-skew
  // case, just with the identifying detail stripped in transit. A genuinely
  // *named* denial (AccessDenied, etc.) is still never retried; only the
  // unreadable case gets the same chance a recognized one already does.
  // Confirmed live: 7 of 8 concurrent PUTs to the same bucket failed this way
  // while the 8th succeeded — a real, consistent permission failure would
  // fail all of them, not most.
  if (status === 403 && (!e.name || e.name === 'UnknownError')) return true;
  return false;
}

function isRunFatalBlobError(err: unknown): boolean {
  if (err instanceof PreconditionFailedError) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 403 || status === 501;
}

// Full jitter: random in [0, base * 2^attempt].
const backoff = (attempt: number) => Math.random() * (BASE_BACKOFF_MS * 2 ** attempt);

// Resolves once the browser reports it has a network link — immediately if
// it already does. A whole-connection drop makes every concurrently-uploading
// lane fail at once, which looks identical (per file) to N independent
// failures — without pausing here instead of spending a retry attempt, that
// single blip alone can exhaust MAX_FILE_FAILURES and abort the run as
// "systemic" well before the network has any chance to come back.
// How often to re-check `navigator.onLine` even without an `online` event —
// the event isn't guaranteed to fire (VPNs and some adapters can leave it
// permanently wrong), so this is the escape hatch that keeps a stuck reading
// from hanging the run forever instead of just delaying it.
const ONLINE_POLL_MS = 30_000;
// After this much elapsed time with navigator.onLine still false, ensureOnline
// lets one upload attempt proceed. Elapsed time—not a count of poll wakeups—is
// deliberate: repeated focus events restart the poll timer and must not starve
// the escape indefinitely.
const MAX_STUCK_OFFLINE_MS = 3 * ONLINE_POLL_MS;

function waitForOnline(signal: AbortSignal): Promise<void> {
  // Strictly `false`, not falsy: `navigator.onLine` is `undefined` in plain
  // Node (no `window` either, e.g. the test environment) — treat "unknown"
  // as online rather than waiting on a `window.addEventListener` that would
  // throw there.
  if (typeof window === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise((resolve, reject) => {
    let poll: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      window.removeEventListener('online', onEvent);
      window.removeEventListener('focus', onEvent);
      if (poll !== null) clearInterval(poll);
      signal.removeEventListener('abort', onAbort);
    };
    const onEvent = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); reject(new Error('cancelled')); };
    window.addEventListener('online', onEvent);
    window.addEventListener('focus', onEvent);
    poll = setInterval(onEvent, ONLINE_POLL_MS);
    signal.addEventListener('abort', onAbort);
    // Close the race between the preflight check and listener registration.
    if (signal.aborted) onAbort();
  });
}

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

type MetadataWrite = { name: string; body: string; contentType: string };
type BuiltMetadata = { writes: MetadataWrite[]; metadataBundleSha256: string };

type RunPlan = {
  sessionId: string;
  bucket: string;
  collectionUuid: string;
  uploadPath: string;
  totalBytes: number;
  items: PlanItem[];
  /** The metadata to publish, asked for once every blob has landed. */
  metadata: () => Promise<BuiltMetadata>;
};

/**
 * Where a new upload goes. A collection with a data bucket gets the Media
 * layout there; one with only its legacy bucket keeps the old layout in it.
 */
export function uploadTarget(c: Pick<CollectionRef, 'bucket' | 'dataBucket'>): { bucket: string; layout: Layout } {
  return c.dataBucket ? { bucket: c.dataBucket, layout: 'media' } : { bucket: c.bucket, layout: 'legacy' };
}

const metadataWrites = (
  b: {
    deploymentsCsv: string;
    mediaCsv: string;
    observationsCsv: string;
    uploadMetaJson: string;
    uploadCompleteJson: string;
  },
  layout: Layout,
): MetadataWrite[] => {
  const media = { name: 'media.csv', body: b.mediaCsv, contentType: 'text/csv' };
  const rest = [
    { name: 'observations.csv', body: b.observationsCsv, contentType: 'text/csv' },
    { name: 'UploadMeta.json', body: b.uploadMetaJson, contentType: 'application/json' },
    { name: 'UploadComplete.json', body: b.uploadCompleteJson, contentType: 'application/json' },
  ];
  const deployments = { name: 'deployments.csv', body: b.deploymentsCsv, contentType: 'text/csv' };
  // The Java desktop app reads legacy uploads straight from storage, so their
  // order stays as it was. A Media-layout upload exists once media.csv does.
  return layout === 'media' ? [deployments, ...rest, media] : [deployments, media, ...rest];
};

const droppedLine = (d: Dropped): string =>
  `${d.localPath}: same bytes as another file in this upload, listed once as ${d.key}`;

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
  timestampSource: it.timestampSource,
  mediaKind: it.mediaKind,
  mimeType: it.mimeType,
  state,
  remoteKey: it.key,
  attempt: 0,
  preTags: it.preTags,
  preTaggerUser: it.preTaggerUser,
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
  let aborted = false;
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
      if (aborted) return;
      items.push(item);
      wake();
    },
    /** Hand an item back, at the head so batch order survives — used when a
     *  lane wakes to find the pool has shrunk past it and must retire without
     *  doing the work it was just given. */
    unshift(item: T): void {
      if (aborted) return; // the run is unwinding; nothing may be requeued
      items.unshift(item);
      wake();
    },
    close(): void {
      closed = true;
      wake();
    },
    /** Cancel, or a failure that kills the whole run: drop whatever is still
     *  queued and release every parked lane at once. Aborting the request
     *  controller is not enough — a lane waiting here holds no request, just a
     *  promise that only a push or a close would ever resolve, so the lane set
     *  would never settle. `next()` returns null from here on. */
    abort(): void {
      aborted = true;
      items.length = 0;
      wake();
    },
    /** Closed and drained: no lane can ever get another item. Derived rather
     *  than latched by whichever lane first saw `next()` return null — a lane
     *  retiring over target hands its item back, and the pool has to notice
     *  that the queue is live again. */
    get spent(): boolean {
      return aborted || (closed && items.length === 0);
    },
    async next(): Promise<T | null> {
      for (;;) {
        if (aborted) return null;
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
 * `dryRun` (log only), and `layout` (where blobs go and how they are checked).
 */
function makeRunner(
  config: S3Config,
  concurrency: ConcurrencyControl,
  onUpdate: (snap: UploadSnapshot) => void,
  opts: { persist: boolean; isResume: boolean; dryRun: boolean; layout: Layout },
) {
  const { persist, isResume, dryRun, layout } = opts;
  const client = getClient(config); // metadata, listings, existing-object checks
  // Read at assignment time, never awaited: the run starts striping over
  // whatever has answered so far, so a shard port that blackholes costs a
  // slower ramp rather than five seconds before the first blob moves.
  const shards: ShardSet = dryRun
    ? { live: [client], settled: Promise.resolve([client]) }
    : probeShardClients(config);
  // Sticky per item, not per lane: a retry stays on the same origin.
  const blobClientFor = (index: number): SafeS3Client =>
    shards.live[index % shards.live.length];
  let cancelled = false;
  let abort = new AbortController();
  // Set for the life of a streamed run so `cancel()` can also release lanes
  // parked on the queue; a fixed-plan run leaves it null and needs nothing.
  let activeQueue: { abort: () => void } | null = null;

  // Per-file ledger writes must never overtake the session row they belong to.
  // `openSession` replaces every row for its session, so an update that lands
  // first is dropped outright (Dexie's `update` is a no-op on a row that does
  // not exist yet) and then overwritten by the bulk put. A streamed run points
  // this at its `openSession` promise; every other path leaves it resolved.
  // Chained, not fanned out from one promise: two updates to the same file
  // (pending, then done) would otherwise both hang off the same resolved
  // promise and race each other into IndexedDB, so the row could settle on
  // whichever landed last rather than whichever was written last. Appending
  // each write to the tail makes the ledger a serial queue, and puts the
  // batch-completion stamp behind every per-file write by construction.
  // `.then(write, write)` on both arms on purpose: one rejected write — or a
  // ledger that never opened — must not poison the rest of the queue.
  let ledgerReady: Promise<unknown> = Promise.resolve();
  let ledgerWriteFailed = false;
  const afterLedger = (write: () => Promise<unknown>): Promise<unknown> => {
    ledgerReady = ledgerReady.then(write, write);
    ledgerReady.catch(() => {
      ledgerWriteFailed = true;
    });
    return ledgerReady;
  };
  // A completed batch's tally is read as final, so a ledger that dropped a
  // file write leaves the batch open instead; resuming it re-checks every file.
  const completeBatch = (sessionId: string): Promise<unknown> =>
    afterLedger(async () => {
      if (ledgerWriteFailed) {
        log('warn', 'some file states could not be saved on this machine, so History keeps this upload open');
        return;
      }
      await markBatchComplete(sessionId, new Date().toISOString());
    });

  // Manual reads the caller's getter on every pull, so a slider change lands
  // mid-run; adaptive owns both the lane target and the length of the window it
  // wants measured, which the blob phase feeds it one sample at a time.
  const adaptive: AdaptiveController | null =
    concurrency.mode === 'adaptive' ? createAdaptiveController() : null;
  const targetLanes = concurrency.mode === 'manual' ? concurrency.get : adaptive!.target;
  const currentTarget = () => Math.max(1, Math.round(targetLanes()));

  const snap: UploadSnapshot = {
    version: 0,
    sessionId: '',
    phase: 'idle',
    dryRun,
    files: [],
    uploadedBytes: 0,
    skippedBytes: 0,
    totalBytes: 0,
    log: [],
    bucket: '',
    collectionUuid: '',
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
    // The run log has no on-screen panel (#108) — it stays as run state for
    // diagnostics, and this is where the browser harness reads it.
    (globalThis as { __uploadLog?: LogLine[] }).__uploadLog = snap.log;
    emit(true);
  };

  // `refused` describes the file's latest state only: a file refused once and
  // then failing for another reason must not keep the old refusal.
  const persistFile = (sessionId: string, localPath: string, patch: Partial<FileRecord>) => {
    if (persist) {
      void afterLedger(() => markFileState(fileRecordId(sessionId, localPath), { refused: false, ...patch }));
    }
  };

  // Whether a stored object is `it`'s bytes. Size + recorded SHA-256 metadata
  // is the portable contract. A Media key names its hash in its folder, and an
  // original another writer stored may lack our metadata, so there the
  // metadata only has to agree when it is present.
  const storedAs = (it: PlanItem, stat: ObjectStat): boolean =>
    stat.size === it.size &&
    (layout === 'media'
      ? it.key.startsWith(mediaFolder(it.sha256)) && (stat.metadata.sha256 ?? it.sha256) === it.sha256
      : stat.metadata.sha256 === it.sha256);

  // The original already stored for these bytes, if any.
  const originalOf = async (sha256: string): Promise<ObjectInfo | undefined> => {
    const listed: ObjectInfo[] = [];
    for await (const o of client.listObjects(snap.bucket, mediaFolder(sha256))) listed.push(o);
    const key = existingOriginal(listed.map((o) => o.key));
    return listed.find((o) => o.key === key);
  };

  // Settle a file on an original already in storage instead of writing its
  // own. One whose size disagrees is a different file under the same hash
  // folder: fail it and leave the stored object alone.
  const reuseOriginal = (sessionId: string, fp: FileProgress, it: PlanItem, found: ObjectInfo): void => {
    if (found.size !== it.size) {
      fp.state = 'failed';
      fp.error = `${found.key} is already stored at ${found.size} bytes, this file is ${it.size} — not overwritten`;
      persistFile(sessionId, it.localPath, { state: 'failed', lastError: fp.error });
      log('error', fp.error);
      throw new Error(fp.error);
    }
    it.key = found.key;
    fp.key = found.key;
    fp.state = 'skipped';
    snap.uploadedBytes += it.size - fp.loaded;
    snap.skippedBytes += it.size;
    fp.loaded = it.size;
    persistFile(sessionId, it.localPath, {
      state: 'done',
      remoteKey: found.key,
      sanitizedObjectName: mediaObjectName(found.key, snap.uploadPath!),
    });
    log('info', `already stored, skip: ${found.key}`);
    emit(true);
  };

  // Two files with the same bytes go one after the other, so the second finds
  // the first's original instead of racing it into a second one.
  const hashTurns = new Map<string, Promise<void>>();
  const processItem = (
    sessionId: string,
    fp: FileProgress,
    it: PlanItem,
    blobClient: SafeS3Client,
  ): Promise<void> => {
    if (layout !== 'media') return transfer(sessionId, fp, it, blobClient);
    const turn = (hashTurns.get(it.sha256) ?? Promise.resolve())
      .catch(() => {})
      .then(() => transfer(sessionId, fp, it, blobClient));
    hashTurns.set(it.sha256, turn);
    return turn;
  };

  // Upload (or skip) one blob. Returns once the object is present and verified,
  // or throws on a non-recoverable failure.
  const transfer = async (
    sessionId: string,
    fp: FileProgress,
    it: PlanItem,
    blobClient: SafeS3Client,
  ): Promise<void> => {
    // Shared by the pre-verify check below and the upload retry loop — a
    // whole-connection drop hits `statObject` (verify) exactly as it hits
    // `writeImmutableStream` (upload), so a resume started offline needs the
    // same wait-don't-fail treatment before it ever reaches the network,
    // not just once the retry loop is already running.
    const ensureOnline = async (): Promise<void> => {
      if (typeof window !== 'undefined' && navigator.onLine === false) {
        // Log once when entering the offline wait, not on every poll tick —
        // a long outage with many lanes would otherwise flood the run monitor.
        log('warn', `waiting for network to retry ${it.key}`);
        const escapeAt = Date.now() + MAX_STUCK_OFFLINE_MS;
        let stuck = false;
        while (navigator.onLine === false) {
          if (cancelled || abort.signal.aborted) throw new Error('cancelled');
          if (Date.now() >= escapeAt) {
            // navigator.onLine has stayed false for the bounded wait even after
            // any focus/online nudges. Let one attempt through and
            // let the retry/backoff loop be the actual connectivity arbiter —
            // it handles transient network errors the same way regardless.
            log('warn', `navigator.onLine stuck false after ${MAX_STUCK_OFFLINE_MS / 1000}s — attempting ${it.key} anyway`);
            stuck = true;
            break;
          }
          await waitForOnline(abort.signal);
        }
        if (!stuck) log('info', `network back, retrying ${it.key}`);
      }
      if (cancelled || abort.signal.aborted) throw new Error('cancelled');
    };

    // A completed blob from a prior run: sanity-check the remote copy before
    // skipping it (`storedAs`).
    // Transient statObject failures (network blip, 5xx) are retried with the
    // same backoff as uploads — without this, all verify lanes can trip
    // MAX_FILE_FAILURES from a single blip and trigger the systemic abort.
    const verifyExisting = async (): Promise<boolean> => {
      let attempt = 0;
      for (;;) {
        try {
          const stat = await client.statObject(snap.bucket, it.key);
          if (storedAs(it, stat)) {
            fp.state = 'skipped';
            snap.uploadedBytes += it.size - fp.loaded;
            snap.skippedBytes += it.size;
            fp.loaded = it.size;
            log('info', `verified, skip: ${it.key}`);
            emit(true);
            return true;
          }
          log('warn', `remote mismatch: ${it.key}`);
          return false;
        } catch (err) {
          if (isNotFound(err)) {
            log('warn', `remote missing, re-uploading: ${it.key}`);
            return false;
          }
          if (cancelled || abort.signal.aborted) throw err;
          if (attempt + 1 >= MAX_ATTEMPTS || !isTransient(err)) {
            // Classified like a failed write. The ledger keeps its `done`: the
            // object may well be there, and the next attempt checks again.
            fp.state = 'failed';
            fp.error = err instanceof Error ? err.message : String(err);
            fp.network = isTransient(err);
            emit(true);
            throw err;
          }
          const wait = backoff(attempt);
          log('warn', `verify retry ${it.key} (attempt ${attempt + 2}) after ${Math.round(wait)}ms`);
          await sleep(wait);
          if (cancelled || abort.signal.aborted) throw err;
          await ensureOnline();
          attempt++;
        }
      }
    };

    if (it.doneAlready) {
      await ensureOnline();
      if (await verifyExisting()) return;
    }

    if (!it.file) {
      fp.state = 'failed';
      fp.error = 'source file unavailable — reselect the folder';
      persistFile(sessionId, it.localPath, { state: 'failed', lastError: fp.error });
      log('error', `${it.key}: ${fp.error}`);
      throw new Error(fp.error);
    }

    let attempt = 0;
    let raced: PreconditionFailedError | null = null;
    for (;;) {
      await ensureOnline();
      fp.attempt = attempt + 1;
      fp.state = 'uploading';
      snap.uploadedBytes -= fp.loaded; // reset this file's contribution on retry
      fp.loaded = 0;
      emit(true);
      let found: ObjectInfo | undefined;
      try {
        if (layout === 'media') {
          found = await originalOf(it.sha256);
          if (!found && raced) throw raced;
        }
        if (!found) {
          const { etag } = await blobClient.writeImmutableStream(snap.bucket, it.key, it.file, {
            sha256: it.sha256,
            contentType: it.mimeType,
            signal: abort.signal,
            onProgress: (loaded) => {
              snap.uploadedBytes += loaded - fp.loaded;
              fp.loaded = loaded;
              emit();
            },
          });
          fp.state = 'done';
          persistFile(sessionId, it.localPath, {
            state: 'done',
            remoteETag: etag,
            attempt: fp.attempt,
          });
          emit(true);
          return;
        }
      } catch (err) {
        if (err instanceof PreconditionFailedError) {
          // In a hash folder a 412 is another writer landing the same bytes
          // first: list again and settle on its original.
          if (layout === 'media') {
            if (raced) throw err;
            raced = err;
            continue;
          }
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
          fp.network = isTransient(err);
          persistFile(sessionId, it.localPath, {
            state: 'failed',
            lastError: msg,
            attempt: fp.attempt,
            refused: !fp.network,
          });
          log('error', `failed ${it.key}: ${msg}`);
          throw err;
        }
        const wait = backoff(attempt);
        log('warn', `retry ${it.key} (attempt ${attempt + 2}) after ${Math.round(wait)}ms: ${msg}`);
        await sleep(wait);
        attempt++;
        if (attempt >= 2) blobClient = client;
      }
      if (found) return reuseOriginal(sessionId, fp, it, found);
    }
  };

  // Once enough files have failed for want of an answer, the connection is
  // down in a way `navigator.onLine` did not notice. The rest of the batch is
  // marked unsent without touching the network, so the run ends `partial`
  // with its ledger intact and the app can pick it up again on its own.
  const markNotSent = (sessionId: string, fp: FileProgress, it: PlanItem) => {
    fp.state = 'failed';
    fp.error = 'not sent: connection lost';
    fp.network = true;
    persistFile(sessionId, it.localPath, { state: 'failed', lastError: fp.error });
    emit(true);
  };
  const stallMessage =
    `connection lost: ${MAX_FILE_FAILURES} files got no answer from storage — stopping here; ` +
    'the upload picks up again on its own';

  const endPartial = (failed: number, published: string) => {
    snap.autoRetry = snap.files.every((f) => f.state !== 'failed' || f.network);
    log(
      'warn',
      snap.autoRetry
        ? `${failed} files failed — metadata not ${published}; the upload picks up again on its own`
        : `${failed} files failed — metadata not ${published}; retry the failed files to complete the upload`,
    );
    snap.phase = 'partial';
    emit(true);
  };

  // Past the blob phase only the final review and the metadata writes are
  // left. One that gets no answer is the same lost connection the blob phase
  // stalls on, so the run ends partial and picks up on its own; a refusal
  // still ends the run in error.
  const endUnpublished = (err: unknown): void => {
    if (cancelled || !isTransient(err)) throw err;
    log(
      'warn',
      `connection lost before publishing (${err instanceof Error ? err.message : String(err)}) — ` +
        'the upload picks up again on its own',
    );
    snap.autoRetry = snap.files.every((f) => f.state !== 'failed' || f.network);
    snap.phase = 'partial';
    emit(true);
  };

  /**
   * How a wet run confirms itself: one listing pass (1 request per 1000
   * objects) checks every blob landed at its exact size, instead of a HEAD
   * round-trip per file during the run.
   *
   * Only files the run believes it finished are checked — one that already
   * failed its own retries has nothing to confirm, and the count reported is
   * the number actually reviewed, not the size of the batch.
   *
   * A listing can't show the recorded SHA-256, so a handful of HEADs sample
   * that half of the contract. Sampling is enough because the way it breaks
   * is systematic — something in the path dropping `x-amz-meta-*` on write —
   * not one object at a time.
   *
   * The Media layout has no one folder holding the images, and each was
   * written with If-None-Match or found by listing its own hash folder, so
   * the sampled HEADs are the whole review.
   */
  const finalReview = async (
    sessionId: string,
    uploadPath: string,
    items: PlanItem[],
  ): Promise<void> => {
    const sizes = new Map<string, number>();
    if (layout === 'legacy') {
      log('info', 'final review: listing uploaded objects…');
      for await (const o of client.listObjects(snap.bucket, `${uploadPath}/`)) {
        sizes.set(o.key, o.size);
      }
    }
    const byId = new Map(snap.files.map((f) => [f.id, f]));
    const fail = (it: PlanItem, fp: FileProgress, reason: string) => {
      fp.state = 'failed';
      fp.error = reason;
      persistFile(sessionId, it.localPath, { state: 'failed', lastError: reason });
      log('error', `${reason}: ${it.key}`);
    };
    let mismatched = 0;
    let reviewed = 0;
    const confirmed: PlanItem[] = [];
    for (const it of items) {
      const fp = byId.get(it.id);
      if (!fp || (fp.state !== 'done' && fp.state !== 'skipped')) continue;
      reviewed++;
      if (layout === 'media') {
        confirmed.push(it);
        continue;
      }
      const size = sizes.get(it.key);
      if (size !== it.size) {
        mismatched++;
        fail(
          it,
          fp,
          size === undefined
            ? 'final review: object missing'
            : `final review: size mismatch (${size} ≠ ${it.size})`,
        );
      } else {
        confirmed.push(it);
      }
    }

    // First, middle, last of what is confirmed so far — spread across the
    // run so a sample lands in whichever lane or window went wrong.
    const n = confirmed.length;
    const picks = n === 0 ? [] : [...new Set([0, (n - 1) >> 1, n - 1])];
    for (const i of picks) {
      const it = confirmed[i];
      const fp = byId.get(it.id)!;
      const stat = await client.statObject(snap.bucket, it.key);
      if (storedAs(it, stat)) continue;
      mismatched++;
      fail(
        it,
        fp,
        `final review: digest contract broken (recorded sha256 ${stat.metadata.sha256 ?? 'absent'}, expected ${it.sha256})`,
      );
      log(
        'error',
        'a sampled object lost its sha256 metadata — treat the whole batch as suspect and check that nothing in the upload path strips x-amz-meta-* headers',
      );
    }

    log(
      'info',
      mismatched > 0
        ? `final review: ${mismatched} of ${reviewed} objects failed the final check`
        : layout === 'media'
          ? `final review: ${picks.length} of ${reviewed} objects re-read and confirmed`
          : `final review: all ${reviewed} objects confirmed by listing, ${picks.length} sampled for digest`,
    );
    emit(true);
  };

  /**
   * Drive a dynamically-sized pool of blob lanes. Lanes spawn up to the live
   * target and retire from the top when it drops, so indices stay packed at
   * 0..size-1. The supervisor refills the pool when the target rises even
   * while every lane is busy with a long file, and feeds the adaptive
   * controller one throughput sample per window. Resolves once every lane has
   * exited (a retiring lane may still be finishing its last file).
   *
   * `spawnable` is what stops the pool respawning into a run with no work
   * left: a fixed plan knows when its items are all handed out, a streamed
   * queue only knows once a lane has seen the queue close and drain.
   */
  const drivePool = async (
    laneTarget: () => number,
    spawnable: () => boolean,
    stopped: () => boolean,
    body: (index: number, pump: () => void) => Promise<void>,
    onLaneError: (err: unknown) => void,
  ): Promise<void> => {
    const live = new Set<number>();
    const syncLanes = () => {
      const t = laneTarget();
      if (snap.lanes !== t) {
        snap.lanes = t;
        emit(true);
      }
    };

    let pump = () => {};
    const drained = new Promise<void>((resolve) => {
      pump = () => {
        syncLanes();
        while (!stopped() && spawnable() && live.size < laneTarget()) {
          let index = 0;
          while (live.has(index)) index++;
          live.add(index);
          void body(index, () => pump())
            .catch(onLaneError)
            .finally(() => {
              live.delete(index);
              pump();
            });
        }
        if (live.size === 0) resolve();
      };
    });

    const supervisor = setInterval(() => pump(), SUPERVISOR_MS);
    // Feed the controller one throughput sample per window, counting only
    // bytes that crossed the wire — a verified skip credits a whole file
    // instantly and would read as a throughput spike the lane count didn't
    // earn. Bytes can also dip when a retry rewinds a file's contribution;
    // clamp so a rewind reads as a slow window rather than a negative rate.
    //
    // Rescheduled rather than fixed-interval: the controller runs short windows
    // while it hunts for the knee and long ones once it's holding it, so the
    // next window's length is only known after the current one is reported.
    const transferred = () => snap.uploadedBytes - snap.skippedBytes;
    let windowBytes = transferred();
    let windowAt = Date.now();
    let windowTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleWindow = (ctl: AdaptiveController) => {
      windowTimer = setTimeout(() => {
        const now = Date.now();
        // Offline, every lane is parked in `waitForOnline` and moves nothing.
        // Feeding that window in would read as a throughput collapse and make
        // the controller give up lanes on the way back up. Roll the window
        // forward instead, so the outage never reaches it.
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          ctl.onWindow({
            bytes: Math.max(0, transferred() - windowBytes),
            ms: now - windowAt,
          });
          pump();
        }
        windowBytes = transferred();
        windowAt = now;
        scheduleWindow(ctl);
      }, ctl.windowMs());
    };
    if (adaptive) scheduleWindow(adaptive);

    try {
      pump();
      await drained;
    } finally {
      clearInterval(supervisor);
      if (windowTimer) clearTimeout(windowTimer);
    }
  };

  // One attempt at the whole sequence for a given plan. Throws
  // PreconditionFailedError on a final-prefix metadata collision (fresh runs
  // re-stamp; resumes verify matching bytes before skipping).
  const runOnce = async (plan: RunPlan): Promise<void> => {
    abort = new AbortController(); // fresh signal per attempt
    let stalled = false;
    snap.sessionId = plan.sessionId;
    snap.bucket = plan.bucket;
    snap.collectionUuid = plan.collectionUuid;
    snap.uploadPath = plan.uploadPath;
    snap.totalBytes = plan.totalBytes;
    snap.uploadedBytes = 0;
    snap.skippedBytes = 0;
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
      let networkFailures = 0;
      const laneTarget = () => Math.min(currentTarget(), plan.items.length);

      const lane = async (index: number, pump: () => void): Promise<void> => {
        for (;;) {
          if (cancelled || fatal) return;
          if (index >= laneTarget()) return; // pool shrank past this lane
          const i = next++;
          if (i >= plan.items.length) return;
          const it = plan.items[i];
          const fp = byId.get(it.id)!;
          if (stalled) {
            if (!it.doneAlready) markNotSent(plan.sessionId, fp, it);
            continue;
          }
          try {
            await processItem(plan.sessionId, fp, it, blobClientFor(i));
          } catch (err) {
            if (cancelled || abort.signal.aborted) return;
            if (isRunFatalBlobError(err)) {
              if (!fatal) {
                fatal = err;
                abort.abort(); // stop sibling lanes' in-flight requests at once
              }
              return;
            }
            if (fp.network) {
              if (++networkFailures >= MAX_FILE_FAILURES && !stalled) {
                stalled = true;
                log('warn', stallMessage);
              }
              continue;
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
          pump(); // a landed item is a chance to grow into a raised target
        }
      };

      await drivePool(
        laneTarget,
        () => next < plan.items.length,
        () => cancelled || fatal !== null,
        lane,
        (err) => {
          if (!fatal) fatal = err;
        },
      );
      if (fatal) throw fatal;
    }

    if (cancelled) throw new Error('cancelled');

    // With the connection down the review listing cannot answer either; the
    // next attempt reviews whatever it confirms.
    if (!dryRun && !stalled) {
      try {
        await finalReview(plan.sessionId, plan.uploadPath, plan.items);
      } catch (err) {
        return endUnpublished(err);
      }
    }

    const failed = snap.files.filter((f) => f.state === 'failed').length;
    if (failed > 0) {
      endPartial(failed, 'written');
      return;
    }

    // --- Phase 2: metadata, in publish order ---
    const { writes, metadataBundleSha256 } = await plan.metadata();
    snap.metadataBundleSha256 = metadataBundleSha256;
    snap.phase = 'metadata';
    emit(true);
    await writeMetadata(writes, plan.uploadPath).catch(endUnpublished);
  };

  // Shared by a fixed-plan run and a streamed run: writes the CSVs/JSON in
  // publish order, dry-run logs instead of PUTting, and treats a 412 as
  // already-written only on resume after verifying the existing bytes. A
  // fresh run must not silently accept a metadata collision, and a resumed
  // run must not accept a different publication under the same key.
  const writeMetadata = async (writes: MetadataWrite[], uploadPath: string): Promise<void> => {
    const readExisting = async (key: string): Promise<Uint8Array> => {
      for (let attempt = 0; ; attempt++) {
        if (cancelled) throw new Error('cancelled');
        try {
          return await client.getObject(snap.bucket, key);
        } catch (err) {
          if (cancelled) throw new Error('cancelled');
          if (attempt + 1 >= MAX_ATTEMPTS || !isTransient(err)) throw err;
          const wait = backoff(attempt);
          log('warn', `verify existing metadata retry ${key} (attempt ${attempt + 2}) after ${Math.round(wait)}ms`);
          await sleep(wait);
        }
      }
    };

    for (const w of writes) {
      if (cancelled) throw new Error('cancelled');
      const key = `${uploadPath}/${w.name}`;
      if (dryRun) {
        log('put', `PUT ${snap.bucket}/${key} (${new TextEncoder().encode(w.body).length} B)`);
        continue;
      }
      for (let attempt = 0; ; attempt++) {
        if (cancelled) throw new Error('cancelled');
        try {
          await client.writeImmutable(snap.bucket, key, w.body, {
            contentType: w.contentType,
            signal: abort.signal,
          });
          if (cancelled) throw new Error('cancelled');
          log('info', `wrote ${key}`);
          break;
        } catch (err) {
          if (cancelled) throw new Error('cancelled');
          if (err instanceof PreconditionFailedError) {
            if (isResume) {
              // A 412 only says something is there. It is this upload's own
              // earlier write only if it holds the same bytes; anything else
              // would publish another upload's file as part of this one.
              const existing = await readExisting(key);
              const expected = new TextEncoder().encode(w.body);
              const sameBytes = existing.length === expected.length && existing.every((byte, i) => byte === expected[i]);
              if (!sameBytes) {
                // Carries the 412 so it reads as a refusal, not a lost connection.
                throw Object.assign(
                  new Error(
                    `${key} already holds different content — another upload wrote to this folder, so this one was not published`,
                  ),
                  { $metadata: { httpStatusCode: 412 } },
                );
              }
              log('info', `already present with matching content, skip: ${key}`);
              break;
            }
            throw err;
          }
          if (attempt + 1 >= MAX_ATTEMPTS || !isTransient(err)) throw err;
          await sleep(backoff(attempt));
          if (cancelled) throw new Error('cancelled');
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
   * drained, so it always sees the complete set and the key each file
   * actually landed under.
   */
  const runStreaming = async (
    seed: {
      sessionId: string;
      bucket: string;
      collectionUuid: string;
      uploadPath: string;
      totalBytes: number; // the FULL batch's total, known from the scan — not grown incrementally
      initialFiles: FileProgress[]; // placeholder ('inspecting') or real ('pending') entry per known file
    },
    queue: ReturnType<typeof makeAsyncQueue<PlanItem>>,
    buildMetadata: (resolvedKeys: Map<string, string>) => Promise<BuiltMetadata>,
  ): Promise<void> => {
    abort = new AbortController();
    activeQueue = queue;
    snap.sessionId = seed.sessionId;
    snap.bucket = seed.bucket;
    snap.collectionUuid = seed.collectionUuid;
    snap.uploadPath = seed.uploadPath;
    snap.totalBytes = seed.totalBytes;
    snap.files = seed.initialFiles;
    snap.phase = 'blobs';
    emit(true);

    let fatal: unknown = null;
    let fileFailures = 0;
    let networkFailures = 0;
    let stalled = false;
    // Every item the pool actually pulled, for the batched final review.
    const pulled: PlanItem[] = [];
    // A failure that kills the run has to stop both kinds of waiting: sibling
    // lanes with a request in flight, and sibling lanes parked on the queue
    // waiting for Inspect to hand them a file. Aborting only the first leaves
    // the parked ones waiting forever and the run never settles.
    const fail = (err: unknown): void => {
      if (fatal) return;
      fatal = err;
      abort.abort();
      queue.abort();
    };
    const lane = async (index: number, pump: () => void): Promise<void> => {
      for (;;) {
        if (cancelled || fatal) return;
        if (index >= currentTarget()) return; // pool shrank past this lane
        const it = await queue.next();
        if (it === null) return;
        // Woken by a cancel or a sibling's fatal failure rather than by real
        // work: hand the item back and let the run unwind.
        if (cancelled || fatal) {
          queue.unshift(it);
          return;
        }
        // Recheck the target after the park, not just before it: a lane can
        // sit in `next()` for minutes while Inspect works, and the adaptive
        // target may have dropped far below this index in the meantime.
        // Without this a burst of newly-inspected files wakes every parked
        // lane at once and they all upload, ignoring the lowered target. The
        // item goes back to the head of the queue for a surviving lane.
        if (index >= currentTarget()) {
          queue.unshift(it);
          return;
        }
        pulled.push(it);
        const blobIndex = pulled.length - 1;
        const fp: FileProgress = { id: it.id, key: it.key, size: it.size, loaded: 0, state: 'pending', attempt: 0 };
        const idx = snap.files.findIndex((f) => f.id === it.id);
        if (idx >= 0) snap.files[idx] = fp;
        else snap.files.push(fp);
        emit(true);
        if (stalled) {
          markNotSent(seed.sessionId, fp, it);
          continue;
        }
        if (dryRun) {
          fp.state = 'done';
          fp.loaded = it.size;
          snap.uploadedBytes += it.size;
          log('put', `PUT ${snap.bucket}/${it.key} (${it.size} B, sha256 ${it.sha256.slice(0, 12)}…)`);
          emit(true);
          pump();
          continue;
        }
        try {
          await processItem(seed.sessionId, fp, it, blobClientFor(blobIndex));
        } catch (err) {
          if (cancelled || abort.signal.aborted) return;
          if (isRunFatalBlobError(err)) {
            fail(err);
            return;
          }
          if (fp.network) {
            if (++networkFailures >= MAX_FILE_FAILURES && !stalled) {
              stalled = true;
              log('warn', stallMessage);
            }
            continue;
          }
          fileFailures++;
          if (fileFailures >= MAX_FILE_FAILURES) {
            fail(
              new Error(
                `aborted after ${MAX_FILE_FAILURES} file failures — the problem looks systemic, not per-file`,
              ),
            );
            return;
          }
          if (fatal) return;
          continue;
        }
        pump(); // a landed item is a chance to grow into a raised target
      }
    };

    await drivePool(
      currentTarget,
      // Not "no lane has seen the end yet": a lane retiring over target hands
      // its item back, and the pool must respawn a surviving lane for it.
      () => !queue.spent,
      () => cancelled || fatal !== null,
      lane,
      (err) => {
        if (!fatal) fatal = err;
      },
    );
    if (fatal) throw fatal;
    if (cancelled) throw new Error('cancelled');

    // A review that gets no answer still builds the bundle below: a retry
    // can only resume a session that has one.
    let reviewError: unknown = null;
    if (!dryRun && !stalled) {
      await finalReview(seed.sessionId, seed.uploadPath, pulled).catch((err: unknown) => {
        reviewError = err;
      });
    }

    // The blob loop only exits normally (no fatal/cancel) once the queue is
    // closed and drained — the caller only closes it once every file in the
    // batch is known — so the full set is always available here, whether or
    // not every blob actually succeeded. Build (and persist) the bundle
    // unconditionally: on a partial failure this gives a later retry a real,
    // byte-identical ledger to resume from instead of starting over: it's
    // just not written to S3 until every blob has actually landed.
    const { writes, metadataBundleSha256 } = await buildMetadata(new Map(pulled.map((it) => [it.id, it.key])));
    if (cancelled) throw new Error('cancelled');
    snap.metadataBundleSha256 = metadataBundleSha256;
    if (reviewError) return endUnpublished(reviewError);

    const failed = snap.files.filter((f) => f.state === 'failed').length;
    if (failed > 0) {
      endPartial(failed, 'published');
      return;
    }

    snap.phase = 'metadata';
    emit(true);
    await writeMetadata(writes, snap.uploadPath!).catch(endUnpublished);
  };

  return {
    snap,
    log,
    emit,
    runOnce,
    runStreaming,
    /** Sequence every ledger write behind the session row being written. */
    openLedger: (p: Promise<unknown>) => {
      // A ledger that never opened does not invalidate the upload — the blobs
      // and the publish are still correct — but it does mean this batch will
      // not appear in History and cannot be resumed, which the user should be
      // told rather than left to discover. Log it once and carry on.
      ledgerReady = Promise.resolve(p).catch((err: unknown) => {
        log(
          'warn',
          `could not open the resume ledger (${err instanceof Error ? err.message : String(err)}) — ` +
            'the upload will still complete, but it will not appear in History and cannot be resumed',
        );
      });
    },
    afterLedger,
    completeBatch,
    cancel: () => {
      cancelled = true;
      abort.abort(); // requests in flight
      activeQueue?.abort(); // lanes parked waiting for the next file
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
  const runner = makeRunner(config, concurrency, onUpdate, {
    persist,
    isResume: false,
    dryRun,
    layout: build.layout,
  });
  const sessionId = crypto.randomUUID();
  runner.snap.sessionId = sessionId;
  runner.snap.collectionUuid = build.collectionUuid;
  // Surface the prep work — freezing every object key and opening the resume
  // ledger is real work at thousands of files, and a silent gap reads as a
  // hang. `runStreaming` flips straight to 'blobs' once the lanes start.
  runner.snap.phase = 'preparing';
  runner.log('info', 'preparing upload…');

  const now = new Date();
  const naming = resolveBatchNaming({
    collectionUuid: build.collectionUuid,
    uploaderSlug: build.uploaderSlug,
    now,
    files: build.files,
    layout: build.layout,
  });

  let estimates = processingComplete(build.files) ? estimateCaptureTimes(build.files, build.timeZone) : undefined;
  const queue = makeAsyncQueue<PlanItem>();
  const enqueuedIds = new Set<string>();
  let finalFiles: FileEntry[] | null = null;

  // Returns whether this call flipped a display row from 'inspecting' to
  // 'pending' — callers that enqueue a whole batch at once use that to emit
  // a single update instead of one per file.
  const enqueue = (f: FileEntry, opts: { silent?: boolean } = {}): boolean => {
    if (f.processState !== 'ready' || !f.sha256 || enqueuedIds.has(f.id)) return false;
    if (!f.exifNaive && !f.manualNaive && !estimates?.has(f.id)) return false;
    enqueuedIds.add(f.id);
    const item = planItemFor(f, naming, build.timeZone, estimates ?? new Map());
    queue.push({ ...item, doneAlready: false });
    // Flip the display row the moment a file is actually queued, not when a
    // lane eventually dequeues it — the queue is FIFO and only `concurrency`
    // lanes drain it, so a file queued behind a large head-of-line batch
    // would otherwise look stuck on "inspecting" long after Inspect finished
    // it. (No-op before `runStreaming` seeds `snap.files` — the initial
    // per-file state already accounts for files ready at that point.)
    let flipped = false;
    const idx = runner.snap.files.findIndex((fp) => fp.id === item.id);
    if (idx >= 0 && runner.snap.files[idx].state === 'inspecting') {
      runner.snap.files[idx] = { ...runner.snap.files[idx], key: item.key, state: 'pending' };
      flipped = true;
      if (!opts.silent) runner.emit(true);
    }
    if (persist) {
      void runner.afterLedger(() =>
        markFileState(fileRecordId(sessionId, item.localPath), fileRecordFor(sessionId, item, 'pending')),
      );
    }
    return flipped;
  };

  if (persist) {
    const deploymentId = locationToDeployment(build.location, build.collectionUuid).deploymentId;
    const batch: BatchRecord = {
      id: sessionId,
      targetBucket: build.bucket,
      layout: build.layout,
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
      f.processState === 'ready' && f.sha256 && (estimates || f.exifNaive || f.manualNaive)
        ? fileRecordFor(sessionId, planItemFor(f, naming, build.timeZone, estimates ?? new Map()), 'pending')
        : awaitingFileRecordFor(sessionId, f),
    );
    runner.log('info', `saving resume ledger (${initialRecords.length} files)…`);
    runner.openLedger(openSession(batch, initialRecords));
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
          collectionUuid: build.collectionUuid,
          uploadPath: naming.uploadPath,
          totalBytes: build.files.reduce((n, f) => n + f.size, 0),
          initialFiles,
        },
        queue,
        async (resolvedKeys) => {
          const files = finalFiles ?? build.files;
          const bundle = await buildBundle({ ...build, files, now, naming, resolvedKeys });
          for (const d of bundle.dropped) runner.log('info', droppedLine(d));
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
          return { writes: metadataWrites(bundle, build.layout), metadataBundleSha256: bundle.metadataBundleSha256 };
        },
      );
      if (runner.isCancelled()) throw new Error('cancelled');
      if (runner.snap.phase !== 'partial') {
        runner.snap.phase = 'done';
        // Behind the ledger too: `openSession` re-puts the batch row, so a
        // completion stamp that lands first is wiped by it.
        if (persist) await runner.completeBatch(sessionId);
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
      let anyFlipped = false;
      for (const f of files) {
        if (enqueue(f, { silent: true })) anyFlipped = true;
      }
      if (anyFlipped) runner.emit(true);
    },
    close: (files) => {
      finalFiles = files;
      estimates ??= estimateCaptureTimes(files, build.timeZone);
      // Last sweep for a ready file whose `notifyReady` never arrived — the
      // bridge from Inspect is an event subscription, and a file it missed
      // would be left out of the transfer while still appearing in the CSVs.
      // `enqueue` ignores anything already queued, so this costs nothing when
      // nothing was missed.
      for (const f of files) enqueue(f);
      // Whatever is still not enqueued can never be uploaded: it finished
      // Inspect as an error after Start, so it has no hash and no object key.
      // `buildBundle` filters such a file out of the CSVs, so without this the
      // run published a strictly smaller batch and still reported `done` — the
      // upload looked complete to anything reading the bucket while a file was
      // quietly missing from it. Before Start, a file that cannot be examined
      // blocks the batch at Assign's Continue gate; after Start the equivalent
      // is a failed item, so the run ends `partial`, publishes nothing, and
      // sends the user to Retry. Refusing to close the queue instead would
      // match the gate more literally but hang the run with no way out.
      for (const f of files) {
        if (enqueuedIds.has(f.id)) continue;
        const reason = f.processError ?? 'could not be inspected';
        const fp = runner.snap.files.find((p) => p.id === f.id);
        if (fp) {
          fp.state = 'failed';
          fp.error = reason;
        } else {
          runner.snap.files.push({
            id: f.id,
            key: '',
            size: f.size,
            loaded: 0,
            state: 'failed',
            attempt: 0,
            error: reason,
          });
        }
        if (persist) {
          void runner.afterLedger(() =>
            markFileState(fileRecordId(sessionId, f.id), { state: 'failed', lastError: reason }),
          );
        }
        runner.log('error', `${f.relPath}: ${reason}`);
      }
      queue.close();
    },
  };
}

/**
 * Resume a persisted session against reattached source files. The prefix and
 * keys are reused verbatim, so completed blobs skip (after a sanity check) and
 * only the interrupted/pending files re-upload. Always a wet run.
 *
 * Requires `session.bundle` to already be attached. A streamed run interrupted
 * before it ever reached publish has no bundle yet — callers going through
 * `History.tsx`'s `beginResume` resolve that first via `resume.ts`'s
 * `ensureBundle` (re-hashes whatever hadn't finished Inspect and builds/attaches
 * the bundle from persisted records) before ever calling this. This fallback
 * error path only remains for a caller that skips that step: no data is lost
 * either way — blobs already uploaded stay on S3 under their (deterministic,
 * keyed by content) object names.
 */
export function resumeUpload(
  params: ResumeParams,
  onUpdate: (snap: UploadSnapshot) => void,
): UploadRun {
  const { config, session, attached, concurrency } = params;
  const { batch, bundle, files } = session;
  const layout = batch.layout ?? 'legacy';
  const runner = makeRunner(config, concurrency, onUpdate, {
    persist: true,
    isResume: true,
    dryRun: false,
    layout,
  });
  runner.snap.sessionId = batch.id;
  runner.snap.collectionUuid = batch.collectionUuid;

  if (!bundle) {
    const done = (async () => {
      runner.snap.phase = 'error';
      runner.snap.error =
        'This session has no publish-ready bundle yet and could not be resolved automatically. Go back to History and try Resume again.';
      runner.log('error', runner.snap.error);
      runner.emit(true);
    })();
    return { cancel: runner.cancel, done };
  }

  // A row with no hash can never be uploaded: no content digest, no object
  // key, nothing for the CSVs to describe. That is a file which failed Inspect
  // after Start (`close` records it `failed`), or one the session never got to
  // inspect at all. The persisted bundle was built from the ready files only,
  // so publishing it here would omit those files silently — exactly the short
  // publish the fresh run refuses to make, just one Retry click later. Refuse
  // it too: there is no resume that can complete this batch, and re-inspecting
  // outside the live wizard is out of scope, so the only way forward is a
  // fresh upload of a batch the user has fixed.
  const unresolvable = files.filter((r) => r.sha256 === undefined);
  if (unresolvable.length > 0) {
    const done = (async () => {
      runner.snap.files = unresolvable.map((r) => ({
        id: r.localPath,
        key: '',
        size: r.size,
        loaded: 0,
        state: 'failed' as FileState,
        attempt: 0,
        error: r.lastError ?? 'failed inspection',
      }));
      runner.snap.phase = 'error';
      runner.snap.error =
        `${unresolvable.length} file${unresolvable.length === 1 ? '' : 's'} failed inspection and cannot be uploaded, ` +
        'so this batch can never be published as it stands. Fix or remove them and start the upload over — ' +
        'files already uploaded will be detected and skipped automatically.';
      for (const r of unresolvable.slice(0, 10)) {
        runner.log('error', `${r.fileName}: ${r.lastError ?? 'failed inspection'}`);
      }
      if (unresolvable.length > 10) runner.log('error', `…and ${unresolvable.length - 10} more`);
      runner.log('error', runner.snap.error);
      runner.emit(true);
    })();
    return { cancel: runner.cancel, done };
  }

  const processedFiles = files.filter((r) => r.state !== 'awaiting-processing');

  const plan: RunPlan = {
    sessionId: batch.id,
    bucket: batch.targetBucket,
    collectionUuid: batch.collectionUuid,
    uploadPath: batch.uploadPrefix,
    totalBytes: processedFiles.reduce((n, f) => n + f.size, 0),
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
    // The saved bundle is republished byte for byte while its media.csv still
    // names exactly the keys the files resolved to, which a metadata write an
    // earlier attempt already made depends on. A file that settled on an
    // original stored since the bundle was saved, in this attempt or in one
    // that stopped before publishing, moves its row, so then it is rebuilt.
    metadata: async () => {
      const keyOf = new Map(plan.items.map((it) => [it.id, it.key]));
      const saved = new Set(parseMedia(bundle.mediaCsv).map((m) => m.mediaPath));
      const resolved = new Set(keyOf.values());
      if (layout === 'legacy' || (saved.size === resolved.size && [...resolved].every((k) => saved.has(k)))) {
        return { writes: metadataWrites(bundle, layout), metadataBundleSha256: bundle.metadataBundleSha256 };
      }
      const rebuilt = await buildBundleFromRecords({
        location: batch.location,
        collectionUuid: batch.collectionUuid,
        bucket: batch.targetBucket,
        uploaderSlug: batch.uploaderSlug,
        description: batch.description,
        uploadPath: batch.uploadPrefix,
        startedAt: new Date(batch.startedAt),
        files: processedFiles.map((r) => ({
          localPath: r.localPath,
          fileName: r.fileName,
          size: r.size,
          sha256: r.sha256!,
          remoteKey: keyOf.get(r.localPath)!,
          timestampSource: r.timestampSource,
          captureTimestamp: r.captureTimestamp,
          mimeType: r.mimeType,
          preTags: r.preTags,
        })),
      });
      for (const d of rebuilt.dropped) runner.log('info', droppedLine(d));
      await attachBundle({
        sessionId: batch.id,
        uploadMetaJson: rebuilt.uploadMetaJson,
        deploymentsCsv: rebuilt.deploymentsCsv,
        mediaCsv: rebuilt.mediaCsv,
        observationsCsv: rebuilt.observationsCsv,
        uploadCompleteJson: rebuilt.uploadCompleteJson,
        metadataBundleSha256: rebuilt.metadataBundleSha256,
      });
      return { writes: metadataWrites(rebuilt, layout), metadataBundleSha256: rebuilt.metadataBundleSha256 };
    },
  };

  const done = (async () => {
    try {
      runner.log('info', `resuming ${batch.uploadPrefix}/`);
      await runner.runOnce(plan);
      if (runner.isCancelled()) throw new Error('cancelled');
      if (runner.snap.phase !== 'partial') {
        runner.snap.phase = 'done';
        // Behind the per-file writes, so History never reads a completed batch
        // whose tally is still catching up.
        await runner.completeBatch(batch.id);
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
