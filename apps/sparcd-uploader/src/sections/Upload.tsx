import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfflineBanner, useOnline } from '@sparcd/auth-ui';
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
import { parseShardEndpoints } from '../lib/s3';
import { onFilesReady } from '../lib/processing';
import type { ProcessResponse } from '../lib/processPool';
import { ensureBundle } from '../lib/resume';
import { captureTimeComplete, processingComplete } from '../lib/validation';
import { Note, RunMonitor } from '../components/RunMonitor';
import { UploadCompleteDialog } from '../components/UploadCompleteDialog';
import { MetadataPreview } from '../components/MetadataPreview';
import { CaptureTimeEditor } from '../components/CaptureTimeEditor';

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
  // One browser connection per endpoint — the main one plus each shard. Counted
  // through the same parser the lanes are built from, so the number shown is
  // the number of connections actually opened.
  const shardCount = parseShardEndpoints(shardEndpoints).origins.length;

  // A dry run never touches the network (nothing is written), so it's still
  // usable offline — only a real upload/retry needs to be gated.
  const online = useOnline();

  // Preview is opt-in — building it rebuilds the whole bundle. Unlike on
  // Assign, nothing on this step is still being live-edited, so it just
  // reflects the current files/description/etc. directly, no debounce needed.
  const [previewOpen, setPreviewOpen] = useState(false);

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
        shardEndpoints,
      },
      setSnap,
    );
  }, [pendingResume, s3Config, shardEndpoints]);

  // Let History know which session is running so it can't be discarded mid-run.
  useEffect(() => {
    setActiveRunSessionId(running && snap ? snap.sessionId : null);
    return () => setActiveRunSessionId(null);
  }, [running, snap?.sessionId, setActiveRunSessionId]);

  // Hold a screen wake lock while actively uploading, so OS/display idle-sleep
  // doesn't interrupt it. Best-effort: unsupported browsers (Firefox, as of
  // this writing) and rejected requests (e.g. low battery) just mean no lock —
  // never fatal to the upload itself. The lock is auto-released by the browser
  // whenever the tab is hidden, so it's re-acquired on regaining visibility.
  //
  // Caveats — cases this can't prevent: the tab being minimized/backgrounded
  // (the lock releases the moment it's hidden), the laptop lid closing (a
  // separate sleep trigger the OS honors regardless of any page's wake lock),
  // and Firefox (no Wake Lock API support at all, so no lock is ever held
  // there).
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    // Incremented on every acquire() call. The resolved sentinel is kept only
    // if gen still matches — two visibility events arriving before either
    // request resolves would otherwise orphan the first sentinel.
    let gen = 0;

    const acquire = () => {
      const myGen = ++gen;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled || myGen !== gen) {
            void l.release();
          } else {
            lock = l;
          }
        })
        .catch(() => {
          /* not fatal — e.g. low battery, or acquired while hidden */
        });
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void lock?.release();
      lock = null;
      acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release();
    };
  }, [running]);

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
  // below already lets the user fix it inline, and this effect re-fires
  // (closedRef is per-run, not per-render) once they do.
  useEffect(() => {
    maybeCloseQueue(files);
  }, [files]);

  const retryPending = useRef(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryFailed = useCallback(async () => {
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

      // A run that hit the systemic-failure abort (e.g. many concurrent
      // blobs failing at once when the network drops) never reaches the
      // publish step, so it has no bundle — same gap History's Resume
      // fixes, resolved here from the files already in memory instead of a
      // disk re-hash pass, since they never left the page.
      if (!session.bundle) {
        const resolved = new Map<string, ProcessResponse>(
          files
            .filter((f) => f.processState === 'ready' && f.sha256)
            .map((f) => [
              f.relPath,
              {
                id: f.relPath,
                sha256: f.sha256,
                exifNaive: f.exifNaive,
                exifCamera: f.exifCamera,
                gps: f.gps,
                width: f.width,
                height: f.height,
                mediaKind: f.mediaKind,
                mimeType: f.mimeType,
              },
            ]),
        );
        const result = await ensureBundle(session.batch, session, resolved);
        if (!result.ok) {
          const reasons = result.problems.map((p) => `${p.fileName}: ${p.reason}`).slice(0, 3).join('; ');
          throw new Error(`${result.problems.length} file(s) couldn't be resolved (${reasons})`);
        }
      }

      const finalSession = session.bundle ? session : await loadSession(snap.sessionId);
      if (!finalSession) throw new Error('session record disappeared while resolving it');

      // A resumed run is a plain UploadRun (no notifyReady/close) — stop the
      // now-finished streaming run's methods from being called again.
      streamingRef.current = null;
      runRef.current = resumeUpload(
        {
          config: s3Config,
          session: finalSession,
          attached,
          concurrency: concurrencyControl(),
          shardEndpoints,
        },
        setSnap,
      );
    } catch (e) {
      setRetryError(
        `Couldn't resume this upload (${e instanceof Error ? e.message : String(e)}). Retry again; if it keeps failing, go Back and start the upload over.`,
      );
    } finally {
      retryPending.current = false;
    }
  }, [snap, s3Config, files, shardEndpoints]);

  // Self-heal after an interruption the user might not notice — a run that
  // landed on 'partial' (some files failed after exhausting their own
  // retries) resumes automatically instead of waiting for them to notice and
  // click Retry. Only 'partial' — not the fatal 'error' phase, which usually
  // means credentials/CORS/policy, not a transient blip a blind retry would
  // fix.
  //
  // "Wakes up" on either of two edge-triggered signals, whichever comes
  // first: the tab regaining visibility (covers minimize/lid-close/sleep —
  // the OS resumes and the visibilitychange fires), or the browser's `online`
  // event (covers a network drop that resolves while the tab stayed visible
  // the whole time, e.g. wifi flapping). Both conditions (visible AND online)
  // are re-checked at the moment either fires, so a machine that wakes with
  // wifi still reconnecting won't retry until `online` actually follows.
  useEffect(() => {
    const tryAutoResume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && snap?.phase === 'partial' && !snap.dryRun) {
        void retryFailed();
      }
    };
    document.addEventListener('visibilitychange', tryAutoResume);
    window.addEventListener('online', tryAutoResume);
    return () => {
      document.removeEventListener('visibilitychange', tryAutoResume);
      window.removeEventListener('online', tryAutoResume);
    };
  }, [snap, retryFailed]);

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
  // effect above) — fixed inline below, the same editor Assign uses, so
  // there's no need to leave this step for it.
  const needsCaptureTime = files.some((f) => f.processState === 'ready' && !f.exifNaive);

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      <OfflineBanner message="You're offline — the dry run still works, but a real upload won't until your connection is back." />
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
              Test the upload, nothing is written
            </label>

            {!effectiveDryRun && (
              <Note
                tone="warn"
                message={`If not testing the upload and it fails right away, that's usually a setup issue on the storage side, not something you did wrong. Contact your administrator and give them this collection ID: ${collection.uuid}.`}
              />
            )}
          </>
        )}

        {stillInspecting > 0 && (
          <Note
            tone="mute"
            message={`Still inspecting ${stillInspecting} file${stillInspecting === 1 ? '' : 's'} in the background — uploading proceeds as each one finishes; publishing waits until every file is done.`}
          />
        )}

        {location && collection && slug && (
          <div className="space-y-2">
            <h2 className={sectionLabel}>Preview</h2>
            {previewOpen ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="font-body text-[12px] text-inkSoft hover:text-ink underline underline-offset-4 decoration-rule focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Hide preview
                </button>
                <MetadataPreview
                  location={location}
                  collectionUuid={collection.uuid}
                  bucket={collection.bucket}
                  uploaderSlug={slug}
                  description={description}
                  timeZone={uploadTimeZone}
                  files={files}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="w-full border border-rule bg-paper px-3 py-2.5 text-left font-body text-[13px] text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              >
                Click to preview the generated bundle files (UploadMeta.json, deployments/media/observations CSVs)…
              </button>
            )}
          </div>
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

      {needsCaptureTime && (
        <section className="space-y-2">
          <h2 className={sectionLabel}>Capture time</h2>
          <p className="font-body text-[13px] text-inkSoft">
            Publishing waits until every file below has a capture time.
          </p>
          <CaptureTimeEditor files={files} />
        </section>
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
          ) : (snap?.phase === 'partial' || snap?.phase === 'error') && !snap.dryRun ? (
            <button
              onClick={retryFailed}
              title={!online ? "You're offline" : undefined}
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              {snap.phase === 'error' ? 'Retry' : 'Retry failed files'}
            </button>
          ) : (
            <button
              onClick={start}
              title={!effectiveDryRun && !online ? "You're offline" : undefined}
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              {effectiveDryRun ? 'Start dry run' : 'Start upload'}
            </button>
          )}
        </div>
      </div>

      {snap?.phase === 'done' && !snap.dryRun && !completeDismissed && (
        <UploadCompleteDialog
          doneCount={snap.files.filter((f) => f.state === 'done').length}
          skippedCount={snap.files.filter((f) => f.state === 'skipped').length}
          onClose={() => setCompleteDismissed(true)}
        />
      )}
    </div>
  );
}
