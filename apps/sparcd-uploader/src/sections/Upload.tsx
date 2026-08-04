import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useLocations } from '../lib/useLocations';
import { useCollections } from '../lib/useCollections';
import { sanitizeUploaderUser } from '../lib/normalize';
import { formatBytes } from '../lib/scanFiles';
import { loadSession } from '../lib/db';
import { resumeUpload, runUpload, type UploadRun, type UploadSnapshot } from '../lib/upload';
import { captureTimeComplete } from '../lib/validation';
import { Note, RunMonitor } from '../components/RunMonitor';

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
  const setUploadRunning = useStore((s) => s.setUploadRunning);

  const { data: locData } = useLocations(s3Config, connectionId);
  const collections = useCollections(s3Config, connectionId);

  const slug = sanitizeUploaderUser(uploaderUser);
  const location = locData?.locations.find((l) => l.key === selectedLocationKey) ?? null;
  const collection =
    collections.data?.find((c) => c.key === selectedBucket || c.bucket === selectedBucket) ?? null;
  const effectiveDryRun = dryRun;

  const [snap, setSnap] = useState<UploadSnapshot | null>(null);
  const runRef = useRef<UploadRun | null>(null);
  const running = snap?.phase === 'blobs' || snap?.phase === 'metadata';

  // Mirror into the store so the idle-logout timer (which lives outside this
  // component's tree) can see "an upload is in flight" and postpone itself.
  // Reset on unmount too — the run is cancelled below, so nothing should be
  // left reporting "busy" once this step is no longer even mounted.
  useEffect(() => {
    setUploadRunning(running);
    return () => setUploadRunning(false);
  }, [running, setUploadRunning]);

  // Abandon an in-flight run if the step unmounts.
  useEffect(() => () => runRef.current?.cancel(), []);

  const ready = useMemo(() => files.filter((f) => f.processState === 'ready' && f.sha256), [files]);

  const start = () => {
    if (!s3Config || !location || !collection || !slug || !captureTimeComplete(files)) return;
    const run = runUpload(
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
      setSnap,
    );
    runRef.current = run;
  };

  const retryPending = useRef(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryFailed = async () => {
    // The async gap before resumeUpload's first emit leaves the Retry button
    // mounted — guard so a double-click can't start two concurrent runs.
    if (!snap || !s3Config || retryPending.current) return;
    retryPending.current = true;
    setRetryError(null);
    try {
      // Partial wet runs persist before uploading, so the ledger should be
      // present — but the load can still fail (cleared site data, IDB error),
      // and the guard must unlatch or Retry is dead until a reload.
      const session = await loadSession(snap.sessionId);
      if (!session) throw new Error('no saved record for this session');
      const attached = new Map(files.map((f) => [f.relPath, f.file]));
      runRef.current = resumeUpload({ config: s3Config, session, attached, concurrency }, setSnap);
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

  if (!captureTimeComplete(files)) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Note
          tone="warn"
          message="One or more files still have no capture time. Go back to Assign to set them."
        />
        <button
          onClick={() => setStep('assign')}
          className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover"
        >
          Back to Assign
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      {/* Run configuration */}
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
        <p className="font-body text-[13px] text-inkSoft">
          {ready.length} file{ready.length === 1 ? '' : 's'} ·{' '}
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
    </div>
  );
}
