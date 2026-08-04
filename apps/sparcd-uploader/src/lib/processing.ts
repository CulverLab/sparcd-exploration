// Drives the worker pool from a module scope, not a component, so processing
// keeps running while the user switches sections or scrolls. `ensure` is
// idempotent per batch token: a new batch cancels the prior run and starts a
// fresh one; re-entering the inspect step with the same batch is a no-op.

import { processBatch, type ProcessRun, type ProcessResponse } from './processPool';
import { posterFor } from './videoPoster';
import { useStore } from '../store';

let run: ProcessRun | null = null;
let runningToken = -1;
let flushTimer: number | null = null;
let startedBuffer: string[] = [];
let resultBuffer: ProcessResponse[] = [];

function clearFlushTimer(): void {
  if (flushTimer !== null) window.clearInterval(flushTimer);
  flushTimer = null;
}

function clearBuffers(): void {
  startedBuffer = [];
  resultBuffer = [];
}

// Lets a streamed upload run subscribe to "these files just finished Inspect
// successfully" without diffing the store itself — flush() already owns that
// exact moment (see below). Multiple listeners are supported so a resumed
// stream-during-inspect run can subscribe independently of any prior one.
type ReadyListener = (results: ProcessResponse[]) => void;
const readyListeners = new Set<ReadyListener>();

export function onFilesReady(listener: ReadyListener): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

// Video poster capture runs on the main thread (needs a <video> element, no
// worker API for it), so it's lane-limited like the worker pool rather than
// fired unbounded per flush — a batch heavy on videos would otherwise pile up
// many concurrent <video>/canvas decodes competing with rendering.
const POSTER_CONCURRENCY = 2;
let posterQueue: { id: string; file: File }[] = [];
let posterActive = 0;

function clearPosterQueue(): void {
  posterQueue = [];
  // In-flight decodes (posterActive) finish on their own and are harmless —
  // setThumbnail on a stale id is a no-op once that file is out of the batch.
}

function pumpPosterQueue(): void {
  while (posterActive < POSTER_CONCURRENCY && posterQueue.length > 0) {
    const next = posterQueue.shift()!;
    posterActive++;
    void posterFor(next.file)
      .then((poster) => {
        if (poster) useStore.getState().setThumbnail(next.id, poster);
      })
      .finally(() => {
        posterActive--;
        pumpPosterQueue();
      });
  }
}

function kickVideoPosters(results: ProcessResponse[]): void {
  // Videos can't be decoded in the worker; grab a poster frame on the main
  // thread once the worker reports a video ready. Best-effort — a failure just
  // leaves the typed placeholder tile in the file list.
  for (const r of results) {
    if (!r.error && r.mediaKind === 'video' && !r.thumbnail) {
      const entry = useStore.getState().files.find((f) => f.id === r.id);
      if (entry) posterQueue.push({ id: r.id, file: entry.file });
    }
  }
  pumpPosterQueue();
}

function flush(token: number): void {
  if (startedBuffer.length === 0 && resultBuffer.length === 0) return;

  const started = startedBuffer;
  const results = resultBuffer;
  clearBuffers();

  // A stale token means the batch was reset and no new run replaced this timer
  // (a new run clears it in ensureProcessing) — stop it instead of ticking forever.
  if (useStore.getState().batchToken !== token) {
    clearFlushTimer();
    return;
  }

  // A streamed upload run relies on this call and the listener notification
  // below happening in the same synchronous tick: it enqueues a file the
  // instant onFilesReady fires, and separately watches the store to decide
  // when to close its queue (once every file has settled). If those two
  // ever moved apart — an `await` between them, say — a file could show as
  // `ready` in the store (and be counted by the close-triggering effect)
  // before it was ever actually enqueued. Keep them adjacent.
  useStore.getState().applyProgress(started, results);
  kickVideoPosters(results);

  const ready = results.filter((r) => !r.error);
  if (ready.length > 0) for (const listener of readyListeners) listener(ready);
}

export function ensureProcessing(): void {
  const { batchToken, files } = useStore.getState();
  if (runningToken === batchToken) return;

  run?.cancel();
  clearFlushTimer();
  clearBuffers();
  clearPosterQueue();
  runningToken = batchToken;

  const queued = files.filter((f) => f.processState === 'queued');
  if (queued.length === 0) {
    run = null;
    useStore.getState().setProcessing(false);
    return;
  }

  const { setProcessing } = useStore.getState();
  setProcessing(true);
  flushTimer = window.setInterval(() => flush(batchToken), 200);

  run = processBatch(
    queued.map((f) => ({ id: f.id, file: f.file, fileKind: f.mediaKind })),
    (id) => startedBuffer.push(id),
    (r) => resultBuffer.push(r),
  );
  run.done.then(() => {
    // Only drain if this is still the active run (a newer batch may have taken over).
    if (useStore.getState().batchToken === batchToken) {
      clearFlushTimer();
      flush(batchToken);
      useStore.getState().revalidate();
      useStore.getState().setProcessing(false);
    }
  });
}
