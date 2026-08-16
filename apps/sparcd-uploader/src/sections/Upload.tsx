import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type FileEntry } from '../store';
import { useLocations } from '../lib/useLocations';
import { useCollections } from '../lib/useCollections';
import { sanitizeUploaderUser } from '../lib/normalize';
import { formatBytes } from '../lib/scanFiles';
import { loadSession } from '../lib/db';
import type { ReconcileProblem } from '../lib/resume';
import {
  resumeUpload,
  runStreamingUpload,
  type ConcurrencyControl,
  type StreamingUploadRun,
  type UploadRun,
  type UploadSnapshot,
} from '../lib/upload';
import { onFilesReady } from '../lib/processing';
import { captureTimeComplete, processingComplete } from '../lib/validation';
import { Note, RunMonitor } from '../components/RunMonitor';
import { UploadCompleteDialog } from '../components/UploadCompleteDialog';

const sectionLabel = 'font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-2';

// Read the mode and the manual value at call time, not at render time: the
// getter is what lets a mid-run slider change reach the lane pool.
const concurrencyControl = (): ConcurrencyControl =>
  useStore.getState().concurrencyMode === 'manual'
    ? { mode: 'manual', get: () => useStore.getState().uploadConcurrency }
    : { mode: 'adaptive' };

// What "adaptive" means, on demand — the explanation only matters the first time
// someone wonders, so it stays behind the 'i' rather than sitting in the layout.
function AdaptiveInfo() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="About adaptive concurrency"
        className="shrink-0 min-w-11 min-h-11 sm:min-w-5 sm:min-h-5 grid place-items-center border border-rule text-inkSoft hover:text-ink hover:border-ink [@media(hover:none)]:text-ink [@media(hover:none)]:border-ink text-[11px] font-mono focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        i
      </button>
      {open && (
        <span className="absolute left-0 top-full z-10 mt-1 block w-[min(22rem,calc(100vw-2.5rem))] border border-rule bg-panel px-3 py-2 font-body text-[12px] leading-[1.5] text-inkSoft">
          Adaptive probes different lane counts against measured throughput and keeps whichever is
          fastest. The lane count it has settled on shows here while a run is in flight. To pin a
          fixed number instead, switch to manual in Settings.
        </span>
      )}
    </span>
  );
}

export function Upload() {
  const s3Config = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const setStep = useStore((s) => s.setStep);
  const files = useStore((s) => s.files);
  const uploaderUser = useStore((s) => s.uploaderUser);
  const description = useStore((s) => s.uploadDescription);
  const uploadTimeZone = useStore((s) => s.uploadTimeZone);
  const selectedLocationKey = useStore((s) => s.selectedLocationKey);
  const selectedBucket = useStore((s) => s.selectedBucket);
  const dryRun = useStore((s) => s.dryRun);
  const setDryRun = useStore((s) => s.setDryRun);
  const concurrencyMode = useStore((s) => s.concurrencyMode);
  const concurrency = useStore((s) => s.uploadConcurrency);
  const setConcurrency = useStore((s) => s.setUploadConcurrency);
  const verifyAfterPut = useStore((s) => s.verifyAfterPut);
  const setVerifyAfterPut = useStore((s) => s.setVerifyAfterPut);
  const shardEndpoints = useStore((s) => s.shardEndpoints);
  const nextBatch = useStore((s) => s.nextBatch);
  const fileAccessMode = useStore((s) => s.fileAccessMode);
  const dirHandle = useStore((s) => s.dirHandle);
  const pendingResume = useStore((s) => s.pendingResume);
  const setActiveRunSessionId = useStore((s) => s.setActiveRunSessionId);

  const { data: locData } = useLocations(s3Config, connectionId);
  const collections = useCollections(s3Config, connectionId);

  const slug = sanitizeUploaderUser(uploaderUser);
  const location = locData?.locations.find((l) => l.key === selectedLocationKey) ?? null;
  const collection =
    collections.data?.find((c) => c.key === selectedBucket || c.bucket === selectedBucket) ?? null;
  const effectiveDryRun = dryRun;
  // One browser connection per endpoint — the main one plus each shard.
  const shardCount = shardEndpoints.split(/[,\n]/).filter((s) => s.trim()).length;

  const [snap, setSnap] = useState<UploadSnapshot | null>(null);
  const [resumeProblems, setResumeProblems] = useState<ReconcileProblem[]>([]);
  const runRef = useRef<UploadRun | StreamingUploadRun | null>(null);
  // Set only while the current run is a streamed one (started via `start()`,
  // not a resume) — `notifyReady`/`close` don't exist on a plain `UploadRun`.
  const streamingRef = useRef<StreamingUploadRun | null>(null);
  // Guards `close()` firing more than once per run.
  const closedRef = useRef(false);
  // Files reattached by a History handoff; the store's batch is empty then, so
  // Retry has to reuse this map instead of rebuilding one from `files`.
  const attachedRef = useRef<Map<string, File> | null>(null);
  const running =
    snap?.phase === 'preparing' || snap?.phase === 'blobs' || snap?.phase === 'metadata';
  // Dismisses the "upload complete" popup — reset whenever a new run (fresh
  // start or resume) begins, so a later run's completion pops it again.
  const [completeDismissed, setCompleteDismissed] = useState(false);

  // Abandon an in-flight run if the step unmounts. StrictMode's dev remount
  // fires this cleanup too, and a resume starts during mount — so decide a
  // microtask later, by which time a remount has already set `mounted` back to
  // true and the run survives.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const run = runRef.current;
      queueMicrotask(() => {
        if (!mounted.current) run?.cancel();
      });
    };
  }, []);

  // A resume prepared in History lands here. Read the handoff from the live
  // store and clear it immediately: under StrictMode this effect fires twice,
  // and the second pass must find nothing or it starts a duplicate run.
  useEffect(() => {
    const pending = useStore.getState().pendingResume;
    if (!pending || !s3Config) return;
    useStore.getState().setPendingResume(null);
    setResumeProblems(pending.problems);
    setCompleteDismissed(false);
    attachedRef.current = pending.attached;
    runRef.current = resumeUpload(
      {
        config: s3Config,
        session: pending.session,
        attached: pending.attached,
        concurrency: concurrencyControl(),
        verifyAfterPut,
        shardEndpoints,
      },
      setSnap,
    );
  }, [pendingResume, s3Config, verifyAfterPut, shardEndpoints]);

  // Let History know which session is running so it can't be discarded mid-run.
  useEffect(() => {
    setActiveRunSessionId(running && snap ? snap.sessionId : null);
    return () => setActiveRunSessionId(null);
  }, [running, snap?.sessionId, setActiveRunSessionId]);

  const ready = useMemo(() => files.filter((f) => f.processState === 'ready' && f.sha256), [files]);
  const stillInspecting = files.length - ready.length;

  // Shared by the reactive effect below and by `start()` itself — a batch
  // that finishes Inspect before Start is even clicked (easy for a small or
  // fast batch) would otherwise never trigger this: `streamingRef.current`
  // is set via a plain ref mutation, which doesn't cause the `[files]`
  // effect to re-run, and `files` never changes again once nothing's left
  // to process. Checking again right after the run is created closes that
  // gap without waiting on a store change that may never come.
  const maybeCloseQueue = (currentFiles: FileEntry[]) => {
    if (!streamingRef.current || closedRef.current) return;
    if (processingComplete(currentFiles) && captureTimeComplete(currentFiles)) {
      closedRef.current = true;
      streamingRef.current.close(currentFiles);
    }
  };

  const start = () => {
    if (!s3Config || !location || !collection || !slug) return;
    closedRef.current = false;
    setCompleteDismissed(false);
    attachedRef.current = null; // this batch's files are the store's again
    setResumeProblems([]);
    const run = runStreamingUpload(
      {
        config: s3Config,
        dryRun: effectiveDryRun,
        concurrency: concurrencyControl(),
        verifyAfterPut,
        shardEndpoints,
        uploaderUser,
        fileAccessMode,
        dirHandle,
        build: {
          location,
          collectionUuid: collection.uuid,
          bucket: collection.bucket,
          uploaderSlug: slug,
          description,
          timeZone: uploadTimeZone,
          files,
        },
      },
      setSnap,
    );
    runRef.current = run;
    streamingRef.current = run;
    maybeCloseQueue(files);
  };

  // Feed newly-inspected files into the live streaming run as Inspect finds
  // them — processing.ts keeps running in the background regardless of which
  // step is on screen, so this is the only bridge needed between it and a
  // run that started before the batch finished processing.
  useEffect(() => {
    return onFilesReady((results) => {
      if (!streamingRef.current) return;
      const ids = new Set(results.map((r) => r.id));
      const current = useStore.getState().files;
      const arrived = current.filter((f) => ids.has(f.id) && f.processState === 'ready' && f.sha256);
      if (arrived.length > 0) streamingRef.current.notifyReady(arrived);
    });
  }, []);

  // Close the run's queue the moment the batch is fully known — every file
  // processed, and (the same integrity gate Assign used to enforce up front)
  // every ready file has a capture time. If processing finishes but a file
  // still lacks a capture time, this simply doesn't fire yet: the render
  // below already redirects the user back to Assign to fix it, and this
  // effect re-fires (closedRef is per-run, not per-render) once they do.
  useEffect(() => {
    maybeCloseQueue(files);
  }, [files]);

  const retryPending = useRef(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryFailed = async () => {
    // The async gap before resumeUpload's first emit leaves the Retry button
    // mounted — guard so a double-click can't start two concurrent runs.
    if (!snap || !s3Config || retryPending.current) return;
    retryPending.current = true;
    setRetryError(null);
    setCompleteDismissed(false);
    try {
      // Partial wet runs persist before uploading, so the ledger should be
      // present — but the load can still fail (cleared site data, IDB error),
      // and the guard must unlatch or Retry is dead until a reload.
      const session = await loadSession(snap.sessionId);
      if (!session) throw new Error('no saved record for this session');
      const attached = attachedRef.current ?? new Map(files.map((f) => [f.relPath, f.file]));
      // A resumed run is a plain UploadRun (no notifyReady/close) — stop the
      // now-finished streaming run's methods from being called again.
      streamingRef.current = null;
      runRef.current = resumeUpload(
        {
          config: s3Config,
          session,
          attached,
          concurrency: concurrencyControl(),
          verifyAfterPut,
          shardEndpoints,
        },
        setSnap,
      );
    } catch (e) {
      setRetryError(
        `Couldn't load the saved upload record for this batch (${e instanceof Error ? e.message : String(e)}). Retry again; if it keeps failing, go Back and start the upload over.`,
      );
    } finally {
      retryPending.current = false;
    }
  };

  // A resumed run replays a persisted bundle and needs nothing from Assign, so
  // these guards stand down once a run is in flight or handed off.
  if ((!location || !collection || !slug) && !snap && !pendingResume) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Note
          tone="warn"
          message="Missing a deployment, target collection, or uploader identity. Go back to Assign."
        />
        <button
          onClick={() => setStep('assign')}
          className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover"
        >
          Back
        </button>
      </div>
    );
  }

  // Not an early return, unlike the checks above: a run may already be
  // active in the background (processing.ts keeps going regardless of the
  // screen), and swapping out the whole step would hide it. A file missing a
  // capture time only blocks the final publish (see the close-triggering
  // effect above) — the fix (Assign) is one click away, surfaced inline.
  const captureComplete = captureTimeComplete(files);

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      {/* Run configuration. A resume handed off from History replays a persisted
          bundle with no Assign state behind it, so the options collapse away. */}
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
        {collection && (
          <>
            <p className="font-body text-[13px] text-inkSoft">
              {ready.length} file{ready.length === 1 ? '' : 's'} ready
              {stillInspecting > 0 && ` (${stillInspecting} still being inspected)`} ·{' '}
              {formatBytes(ready.reduce((n, f) => n + f.size, 0))} →{' '}
              <span className="font-mono text-ink break-all">
                {collection.bucket}/Collections/{collection.uuid}/Uploads/
              </span>
            </p>

            <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
              <input
                type="checkbox"
                checked={effectiveDryRun}
                disabled={running}
                onChange={(e) => setDryRun(e.target.checked)}
                className="accent-accent"
              />
              Dry run — log every PUT, write nothing
            </label>

            {!effectiveDryRun && (
              <Note
                tone="warn"
                message={`Wet upload uses the connected credentials directly. The bucket must allow this web origin with CORS, and the credentials must permit append-only PUT/HEAD/LIST for ${collection.bucket}.`}
              />
            )}

            <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
              <input
                type="checkbox"
                checked={verifyAfterPut}
                disabled={running}
                onChange={(e) => setVerifyAfterPut(e.target.checked)}
                className="accent-accent"
              />
              HEAD-verify each file after upload
              <span className="font-body text-[12px] text-inkMute">
                — off trusts the PUT response, saving a round-trip per file
              </span>
            </label>
          </>
        )}

        {stillInspecting > 0 && (
          <Note
            tone="mute"
            message={`Still inspecting ${stillInspecting} file${stillInspecting === 1 ? '' : 's'} in the background — uploading proceeds as each one finishes; publishing waits until every file is done.`}
          />
        )}

        {!captureComplete && (
          <Note
            tone="warn"
            message="One or more files still have no capture time — publishing will wait until every ready file has one. Go back to Assign to set it."
          />
        )}

        {/* Concurrency sits outside the config gate: a resume handed off from
            History has no Assign state behind it but still runs lanes. */}
        {(collection || snap || pendingResume) && (
          <div className="space-y-1.5">
            {concurrencyMode === 'adaptive' ? (
              <div className="flex items-center gap-3">
                <span className="font-body text-[13px] text-inkSoft w-28">Concurrency</span>
                <span className="flex items-center gap-2 font-mono text-[13px] text-ink">
                  adaptive
                  <AdaptiveInfo />
                  {running && snap?.lanes ? <span>· {snap.lanes} lanes</span> : null}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <label className="font-body text-[13px] text-inkSoft w-28">Concurrency</label>
                <input
                  type="range"
                  min={4}
                  max={32}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="font-mono text-[13px] text-ink w-8 text-right">{concurrency}</span>
              </div>
            )}
            {concurrencyMode === 'manual' && (
              <p className="font-body text-[12px] text-inkMute">
                Changes apply immediately, mid-run. Switch to adaptive tuning in Settings.
              </p>
            )}
            {shardCount > 0 && (
              <div className="flex items-center gap-3">
                <span className="font-body text-[13px] text-inkSoft w-28">Endpoints</span>
                <span className="font-mono text-[13px] text-ink">
                  {shardCount + 1} connections (main + {shardCount} shard
                  {shardCount === 1 ? '' : 's'})
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {resumeProblems.length > 0 && (
        <div className="border border-warn/40 bg-paper px-3 py-2.5 space-y-1">
          <p className="font-body text-[13px] text-warn">
            {resumeProblems.length} file{resumeProblems.length === 1 ? '' : 's'} could not be
            reconciled and will be skipped:
          </p>
          <ul className="font-mono text-[11px] text-inkSoft max-h-32 overflow-auto">
            {resumeProblems.slice(0, 50).map((p) => (
              <li key={p.localPath} className="truncate" title={`${p.localPath} — ${p.reason}`}>
                {p.fileName} — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Live run */}
      {snap && <RunMonitor snap={snap} />}

      {retryError && <Note tone="warn" message={retryError} />}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ruleSoft pt-5">
        <button
          onClick={() => setStep('assign')}
          disabled={running}
          className={`border border-ink text-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
            running ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          Back
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button
              onClick={() => runRef.current?.cancel()}
              className="border border-warn text-warn px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Cancel
            </button>
          ) : snap?.phase === 'done' && !snap.dryRun ? (
            <button
              onClick={() => {
                setSnap(null);
                nextBatch();
              }}
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Next batch
            </button>
          ) : snap?.phase === 'partial' && !snap.dryRun ? (
            <button
              onClick={retryFailed}
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Retry failed files
            </button>
          ) : snap?.phase === 'error' && !snap.dryRun && snap.sessionId ? (
            // An interrupted wet run has a persisted ledger — resuming skips the
            // blobs that already landed. Starting over uses a fresh prefix and
            // re-uploads everything.
            <>
              <button
                onClick={() => setSnap(null)}
                className="border border-ink text-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Start over
              </button>
              <button
                onClick={retryFailed}
                className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Resume upload
              </button>
            </>
          ) : (
            <button
              onClick={start}
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              {effectiveDryRun ? 'Start dry run' : 'Start upload'}
            </button>
          )}
        </div>
      </div>

      {snap?.phase === 'done' && !snap.dryRun && !completeDismissed && (
        <UploadCompleteDialog
          count={snap.files.length}
          onClose={() => setCompleteDismissed(true)}
        />
      )}
    </div>
  );
}
