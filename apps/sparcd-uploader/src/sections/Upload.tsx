import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type FileEntry } from '../store';
import { useLocations } from '../lib/useLocations';
import { useCollections } from '../lib/useCollections';
import { sanitizeUploaderUser } from '../lib/normalize';
import { formatBytes } from '../lib/scanFiles';
import { loadSession } from '../lib/db';
import {
  resumeUpload,
  runStreamingUpload,
  type StreamingUploadRun,
} from '../lib/upload';
import { onFilesReady } from '../lib/processing';
import { captureTimeComplete, processingComplete } from '../lib/validation';
import { Note, RunMonitor } from '../components/RunMonitor';
import { UploadCompleteDialog } from '../components/UploadCompleteDialog';

const sectionLabel = 'font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-2';

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
  const concurrency = useStore((s) => s.uploadConcurrency);
  const setConcurrency = useStore((s) => s.setUploadConcurrency);
  const nextBatch = useStore((s) => s.nextBatch);
  const fileAccessMode = useStore((s) => s.fileAccessMode);
  const dirHandle = useStore((s) => s.dirHandle);

  const { data: locData } = useLocations(s3Config, connectionId);
  const collections = useCollections(s3Config, connectionId);

  const slug = sanitizeUploaderUser(uploaderUser);
  const location = locData?.locations.find((l) => l.key === selectedLocationKey) ?? null;
  const collection =
    collections.data?.find((c) => c.key === selectedBucket || c.bucket === selectedBucket) ?? null;
  const effectiveDryRun = dryRun;

  // Run and snapshot live in the store so they survive section navigation —
  // unmounting this component stops rendering the run, not running it. Filter
  // activeSnap by source so History resume snapshots don't appear here.
  const snap = useStore((s) => s.activeRunSource === 'upload' ? s.activeSnap : null);
  const activeRun = useStore((s) => s.activeRun);
  const setActiveRun = useStore((s) => s.setActiveRun);
  const setActiveSnap = useStore((s) => s.setActiveSnap);
  const clearActiveRun = useStore((s) => s.clearActiveRun);
  // Set only while the current run is a streamed one (started via `start()`,
  // not a resume) — `notifyReady`/`close` don't exist on a plain `UploadRun`.
  const streamingRef = useRef<StreamingUploadRun | null>(null);
  // Guards `close()` firing more than once per run.
  const closedRef = useRef(false);
  const running = snap?.phase === 'blobs' || snap?.phase === 'metadata';
  // Dismisses the "upload complete" popup — reset whenever a new run (fresh
  // start or resume) begins, so a later run's completion pops it again.
  const [completeDismissed, setCompleteDismissed] = useState(false);

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
    const run = runStreamingUpload(
      {
        config: s3Config,
        dryRun: effectiveDryRun,
        concurrency,
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
      setActiveSnap,
    );
    setActiveRun(run, 'upload');
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
      const attached = new Map(files.map((f) => [f.relPath, f.file]));
      // A resumed run is a plain UploadRun (no notifyReady/close) — stop the
      // now-finished streaming run's methods from being called again.
      streamingRef.current = null;
      const run = resumeUpload({ config: s3Config, session, attached, concurrency }, setActiveSnap);
      setActiveRun(run, 'upload');
    } catch (e) {
      setRetryError(
        `Couldn't load the saved upload record for this batch (${e instanceof Error ? e.message : String(e)}). Retry again; if it keeps failing, go Back and start the upload over.`,
      );
    } finally {
      retryPending.current = false;
    }
  };

  if (!location || !collection || !slug) {
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
      {/* Run configuration */}
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
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

        <div className="flex items-center gap-3">
          <label className="font-body text-[13px] text-inkSoft w-28">Concurrency</label>
          <input
            type="range"
            min={4}
            max={16}
            value={concurrency}
            disabled={running}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="font-mono text-[13px] text-ink w-8 text-right">{concurrency}</span>
        </div>
      </section>

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
              onClick={() => activeRun?.cancel()}
              className="border border-warn text-warn px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Cancel
            </button>
          ) : snap?.phase === 'done' && !snap.dryRun ? (
            <button
              onClick={() => {
                clearActiveRun();
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
