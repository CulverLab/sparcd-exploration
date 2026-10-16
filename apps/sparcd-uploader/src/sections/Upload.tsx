import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '@sparcd/auth-ui';
import { deleteFlipRecord } from '@sparcd/flip';
import { useStore } from '../store';
import { useLocations } from '../lib/useLocations';
import { findAllowedLocation } from '../lib/allowedLocations';
import { useCollections } from '../lib/useCollections';
import { sanitizeUploaderUser } from '../lib/normalize';
import { formatUploadComments } from '../lib/uploadComments';
import { formatBytes } from '../lib/scanFiles';
import { loadSession, type BatchRecord } from '../lib/db';
import type { ReconcileProblem } from '../lib/resume';
import {
  resumeUpload,
  runStreamingUpload,
  type ConcurrencyControl,
} from '../lib/upload';
import { probeShardClients } from '../lib/s3';
import type { ProcessResponse } from '../lib/processPool';
import { ensureBundle } from '../lib/resume';
import { Note, RunMonitor } from '../components/RunMonitor';
import { UploadCompleteDialog } from '../components/UploadCompleteDialog';

// Every scan path keys files as `<picked folder>/<sub>/<file>`; loose files
// picked on a phone have no folder to name.
function folderOf(paths: string[]): string | null {
  const top = paths[0]?.split('/')[0];
  return top && paths.every((p) => p.startsWith(`${top}/`)) ? top : null;
}

const sectionLabel = 'font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-2';

// Read the mode and the manual value at call time, not at render time: the
// getter is what lets a mid-run slider change reach the lane pool.
const concurrencyControl = (): ConcurrencyControl =>
  useStore.getState().concurrencyMode === 'manual'
    ? { mode: 'manual', get: () => useStore.getState().uploadConcurrency }
    : { mode: 'adaptive' };

const uploadConnectivityStatusId = 'upload-connectivity-status';

function UploadConnectivityStatus({
  online,
  offlineOverride,
  onAllowOfflineUpload,
}: {
  online: boolean;
  offlineOverride: boolean;
  onAllowOfflineUpload: () => void;
}) {
  const message = online
    ? 'Online — network detected; real uploads can be attempted'
    : offlineOverride
      ? 'Offline — trying a real upload; the browser signal may be stale'
      : 'Offline — real uploads paused; dry runs remain available';

  return (
    <div
      id={uploadConnectivityStatusId}
      aria-live="polite"
      aria-atomic="true"
      className={`flex items-center gap-2 border px-3 py-2.5 font-body text-[13px] ${
        online ? 'border-ruleSoft bg-panel text-inkSoft' : 'border-warn/40 bg-paper text-warn'
      }`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${online ? 'bg-accent' : 'bg-warn'}`} />
      <span>{message}</span>
      {!online && !offlineOverride && (
        <button
          type="button"
          onClick={onAllowOfflineUpload}
          aria-describedby={uploadConnectivityStatusId}
          className="ml-auto shrink-0 border border-warn px-2 py-1 font-[600] text-[12px] text-warn hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          Try real upload anyway
        </button>
      )}
    </div>
  );
}

export function Upload() {
  const previewUploadDate = useStore((s) => s.uploadCommentDate);
  const s3Config = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const setStep = useStore((s) => s.setStep);
  const files = useStore((s) => s.files);
  const uploaderUser = useStore((s) => s.uploaderUser);
  const mountainRange = useStore((s) => s.mountainRange);
  const dateCollected = useStore((s) => s.dateCollected);
  const description = useStore((s) => s.uploadDescription);
  const uploadTimeZone = useStore((s) => s.uploadTimeZone);
  const selectedLocationId = useStore((s) => s.selectedLocationId);
  const selectedBucket = useStore((s) => s.selectedBucket);
  const dryRun = useStore((s) => s.dryRun);
  const setDryRun = useStore((s) => s.setDryRun);
  const nextBatch = useStore((s) => s.nextBatch);
  const flipId = useStore((s) => s.flipId);
  const fileAccessMode = useStore((s) => s.fileAccessMode);
  const dirHandle = useStore((s) => s.dirHandle);
  const pendingResume = useStore((s) => s.pendingResume);
  const attachedFiles = useStore((s) => s.attachedFiles);

  const { data: locData } = useLocations(s3Config, connectionId, selectedBucket);
  const collections = useCollections(s3Config, connectionId);

  const slug = sanitizeUploaderUser(uploaderUser);
  const location = findAllowedLocation(locData?.locations ?? [], selectedLocationId);
  const collection =
    collections.data?.find((c) => c.key === selectedBucket || c.bucket === selectedBucket) ?? null;
  const effectiveDryRun = dryRun;

  // Warms the shard connection pool ahead of a real run — probeShardClients
  // caches per connection, so a run started now already has whichever shards
  // are up instead of discovering them from scratch at the first PUT.
  useEffect(() => {
    if (!s3Config || effectiveDryRun) return;
    probeShardClients(s3Config);
  }, [s3Config, effectiveDryRun]);
  const [showComments, setShowComments] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // A dry run never touches the network (nothing is written), so it's still
  // usable offline — only a real upload/retry needs to be gated.
  const online = useOnline();
  const [offlineOverride, setOfflineOverride] = useState(false);
  useEffect(() => {
    if (online) setOfflineOverride(false);
  }, [online]);
  const realUploadAllowed = online || offlineOverride;


  // Run and snapshot live in the store so they survive section navigation —
  // unmounting this component stops rendering the run, not running it. This is
  // the only step that runs anything, resumes included, so every snapshot here
  // is ours.
  const snap = useStore((s) => s.activeSnap);
  const activeRun = useStore((s) => s.activeRun);
  const activeRunReserved = useStore((s) => s.activeRunReserved);
  const beginActiveRun = useStore((s) => s.beginActiveRun);
  const setActiveRun = useStore((s) => s.setActiveRun);
  const setActiveSnap = useStore((s) => s.setActiveSnap);
  const clearActiveRun = useStore((s) => s.clearActiveRun);
  const [resumeProblems, setResumeProblems] = useState<ReconcileProblem[]>([]);
  // Files reattached by a History handoff; the store's batch is empty then, so
  // Retry has to reuse this map instead of rebuilding one from `files`.
  const attachedRef = useRef<Map<string, File> | null>(null);
  const running =
    snap?.phase === 'preparing' || snap?.phase === 'blobs' || snap?.phase === 'metadata';
  const anyRunActive = activeRunReserved;
  // Dismisses the "upload complete" popup — reset whenever a new run (fresh
  // start or resume) begins, so a later run's completion pops it again.
  const [completeDismissed, setCompleteDismissed] = useState(false);

  // A resume prepared in History lands here. Read the handoff from the live
  // store and clear it immediately: under StrictMode this effect fires twice,
  // and the second pass must find nothing or it starts a duplicate run. The run
  // goes into the store like any other, so leaving this step only stops
  // rendering it.
  useEffect(() => {
    const pending = useStore.getState().pendingResume;
    if (!pending || !s3Config) return;
    useStore.getState().setPendingResume(null);
    setResumeProblems(pending.problems);
    setCompleteDismissed(false);
    attachedRef.current = pending.attached;
    const generation = pending.generation;
    useStore.getState().setAttachedFiles(pending.attached);
    const run = resumeUpload(
      {
        config: s3Config,
        session: pending.session,
        attached: pending.attached,
        concurrency: concurrencyControl(),
      },
      (next) => setActiveSnap(next, generation),
    );
    setActiveRun(run, generation);
  }, [pendingResume, s3Config, setActiveRun, setActiveSnap]);



  const ready = useMemo(() => files.filter((f) => f.processState === 'ready' && f.sha256), [files]);
  const stillInspecting = files.length - ready.length;
  const folder = useMemo(() => folderOf(files.map((f) => f.relPath)), [files]);

  // A run resumed from History goes to its saved destination, whatever Assign
  // holds now, so the summary has to name that one.
  const resumedSessionId = attachedFiles ? snap?.sessionId : undefined;
  const [resumedBatch, setResumedBatch] = useState<BatchRecord | null>(null);
  useEffect(() => {
    setResumedBatch(null);
    if (!resumedSessionId) return;
    let live = true;
    void loadSession(resumedSessionId).then((s) => {
      if (live) setResumedBatch(s?.batch ?? null);
    });
    return () => {
      live = false;
    };
  }, [resumedSessionId]);
  // A resume may render before the asynchronous session read completes. Keep
  // the saved session's destination as the only source of truth during that
  // gap; falling back to Assign here can briefly name a different batch.
  const savedBatch = resumedBatch ?? pendingResume?.session.batch ?? null;
  const isResumed = Boolean(attachedFiles || pendingResume || resumedSessionId);
  // Resume never borrows metadata from the current wizard, including while
  // its saved record is loading or when legacy fields are unavailable.
  const summaryTimeZone = isResumed ? savedBatch?.uploadTimeZone : uploadTimeZone;
  const summaryMountainRange = isResumed ? savedBatch?.requiredComments?.mountainRange : mountainRange;
  const summaryDateCollected = isResumed ? savedBatch?.requiredComments?.dateCollected : dateCollected;
  const summaryComments = isResumed ? savedBatch?.description : description;
  const dest = savedBatch
    ? {
        collectionName:
          collections.data?.find(
            (c) => c.bucket === savedBatch.targetBucket && c.uuid === savedBatch.collectionUuid,
          )?.name ?? savedBatch.targetBucket,
        collectionUuid: savedBatch.collectionUuid,
        location: savedBatch.location,
        folder: folderOf([...(attachedFiles?.keys() ?? [])]),
      }
    : isResumed
      ? null
      : collection && {
        collectionName: collection.name ?? '(unnamed)',
        collectionUuid: collection.uuid,
        location,
        folder,
      };

  const start = () => {
    if (!s3Config || !location || !collection || !slug || !mountainRange.trim() || !dateCollected) return;
    setCompleteDismissed(false);
    attachedRef.current = null; // this batch's files are the store's again
    setResumeProblems([]);
    const generation = beginActiveRun();
    if (generation === null) return;
    const run = runStreamingUpload(
      {
        config: s3Config,
        dryRun: effectiveDryRun,
        concurrency: concurrencyControl(),
        uploaderUser,
        fileAccessMode,
        dirHandle,
        build: {
          location,
          collectionUuid: collection.uuid,
          bucket: collection.bucket,
          uploaderSlug: slug,
          description,
          requiredComments: { mountainRange, dateCollected, previewUploadDate: previewUploadDate ?? undefined },
          timeZone: uploadTimeZone,
          files,
        },
      },
      (next) => setActiveSnap(next, generation),
    );
    setActiveRun(run, generation, run);
    // If inspection finished before Start was clicked, no later store update
    // will close the queue. The store owns the run; close it immediately here.
    useStore.getState().closeStreamingQueue(files);
  };

  // The hand-off record exists to get a batch to the tagger and its tags back;
  // once those tags are published it is dead weight holding paths, hashes,
  // thumbnails and possibly a live folder handle. Only a real publish clears it
  // — a dry run wrote nothing, and "Start over" is not the user saying they are
  // finished with the tags.
  useEffect(() => {
    if (!flipId || snap?.phase !== 'done' || snap.dryRun) return;
    void deleteFlipRecord(flipId);
  }, [flipId, snap?.phase, snap?.dryRun]);

  const retryPending = useRef(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryFailed = useCallback(async () => {
    // The async gap before resumeUpload's first emit leaves the Retry button
    // mounted — guard so a double-click can't start two concurrent runs.
    if (!snap || !s3Config || retryPending.current) return;
    const expectedConnectionId = connectionId;
    const connectionIsCurrent = () => {
      const state = useStore.getState();
      return !!state.s3Config && state.connectionId === expectedConnectionId;
    };
    retryPending.current = true;
    setRetryError(null);
    setCompleteDismissed(false);
    try {
      // Partial wet runs persist before uploading, so the ledger should be
      // present — but the load can still fail (cleared site data, IDB error),
      // and the guard must unlatch or Retry is dead until a reload.
      const session = await loadSession(snap.sessionId);
      if (!connectionIsCurrent()) return;
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
                exifTimestampSource: f.exifTimestampSource,
                exifCamera: f.exifCamera,
                gps: f.gps,
                width: f.width,
                height: f.height,
                mediaKind: f.mediaKind,
                mimeType: f.mimeType,
              },
            ]),
        );
        const attached = new Map(files.map((f) => [f.relPath, f.file]));
        const result = await ensureBundle(session.batch, session, resolved, attached);
        if (!connectionIsCurrent()) return;
        if (!result.ok) {
          const reasons = result.problems.map((p) => `${p.fileName}: ${p.reason}`).slice(0, 3).join('; ');
          throw new Error(`${result.problems.length} file(s) couldn't be resolved (${reasons})`);
        }
      }

      const finalSession = session.bundle ? session : await loadSession(snap.sessionId);
      if (!connectionIsCurrent()) return;
      if (!finalSession) throw new Error('session record disappeared while resolving it');

      const config = useStore.getState().s3Config;
      if (!config || !connectionIsCurrent()) return;
      const generation = beginActiveRun();
      if (generation === null) return;
      const run = resumeUpload(
        {
          config,
          session: finalSession,
          attached,
          concurrency: concurrencyControl(),
        },
        (next) => setActiveSnap(next, generation),
      );
      setActiveRun(run, generation);
    } catch (e) {
      setRetryError(
        `Couldn't resume this upload (${e instanceof Error ? e.message : String(e)}). Retry again; if it keeps failing, go Back and start the upload over.`,
      );
    } finally {
      retryPending.current = false;
    }
  }, [snap, s3Config, connectionId, files, beginActiveRun, setActiveRun, setActiveSnap]);

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

  // Estimating and overriding belongs to Assign; this step only states what
  // the batch will publish so nobody is surprised by the deployment flag.
  const noCameraTime = files.filter(
    (f) => f.processState === 'ready' && (!f.exifNaive || f.exifTimestampSource === 'exif-modify'),
  ).length;

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      <UploadConnectivityStatus
        online={online}
        offlineOverride={offlineOverride}
        onAllowOfflineUpload={() => setOfflineOverride(true)}
      />
      {!isResumed && location && mountainRange.trim() && dateCollected && (
        <div className="border border-ruleSoft p-3 break-words">
          <h3 className={sectionLabel}>Generated upload comment</h3>
          <p aria-label="Generated upload comment" className="font-body text-[13px] text-inkSoft">
            {formatUploadComments({
              required: { mountainRange, dateCollected, previewUploadDate: previewUploadDate ?? undefined }, siteName: location.name,
              imageCount: files.length, uploadDate: new Date(), comments: '',
            })}
          </p>
        </div>
      )}
      {/* Run configuration. A resume handed off from History replays a persisted
          bundle with no Assign state behind it, so the options collapse away. */}
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
        {dest && (
          <>
            {!isResumed && (
              <p className="font-body text-[13px] text-inkSoft">
                {ready.length} file{ready.length === 1 ? '' : 's'} ready
                {stillInspecting > 0 && ` (${stillInspecting} still being inspected)`} ·{' '}
                {formatBytes(ready.reduce((n, f) => n + f.size, 0))}
              </p>
            )}

            <dl className="space-y-1.5 font-body text-[13px]">
              <div className="flex items-baseline gap-3">
                <dt className="text-inkSoft w-28 shrink-0">Collection</dt>
                <dd className="text-ink min-w-0 break-words">
                  {dest.collectionName} <span className="font-mono text-inkMute">({dest.collectionUuid})</span>
                </dd>
              </div>
              {dest.location && (
                <div className="flex items-baseline gap-3">
                  <dt className="text-inkSoft w-28 shrink-0">Location</dt>
                  <dd className="min-w-0">
                    <span className="block break-words text-ink">{dest.location.name}</span>
                    <span className="block break-all font-mono text-[12px] text-inkMute">
                      {dest.location.id}
                    </span>
                  </dd>
                </div>
              )}
              {dest.folder && (
                <div className="flex items-baseline gap-3">
                  <dt className="text-inkSoft w-28 shrink-0">Source folder</dt>
                  <dd className="font-mono text-ink min-w-0 break-all">{dest.folder}</dd>
                </div>
              )}
              {summaryTimeZone && (
                <div className="flex items-baseline gap-3">
                  <dt className="text-inkSoft w-28 shrink-0">Timezone</dt>
                  <dd className="text-ink min-w-0">{summaryTimeZone}</dd>
                </div>
              )}
              {summaryMountainRange?.trim() && (
                <div className="flex items-baseline gap-3">
                  <dt className="text-inkSoft w-28 shrink-0">Mountain range</dt>
                  <dd className="text-ink min-w-0 break-words">{summaryMountainRange}</dd>
                </div>
              )}
              {summaryDateCollected && (
                <div className="flex items-baseline gap-3">
                  <dt className="text-inkSoft w-28 shrink-0">Date collected</dt>
                  <dd className="text-ink min-w-0">{summaryDateCollected}</dd>
                </div>
              )}
            </dl>

            {summaryComments?.trim() && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowComments((v) => !v)}
                  aria-expanded={showComments}
                  className="inline-flex items-center gap-1.5 font-body text-[13px] text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden>{showComments ? '▾' : '▸'}</span>
                  Comments
                </button>
                {showComments && (
                  <p className="font-body text-[13px] text-inkSoft mt-1.5 whitespace-pre-wrap break-words">{summaryComments}</p>
                )}
              </div>
            )}

            {!isResumed && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  aria-expanded={showAdvanced}
                  className="inline-flex items-center gap-1.5 font-body text-[13px] text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden>{showAdvanced ? '▾' : '▸'}</span>
                  Advanced
                </button>
                {showAdvanced && (
                  <label className="flex items-center gap-2.5 font-body text-[14px] text-ink mt-1.5">
                    <input
                      type="checkbox"
                      checked={effectiveDryRun}
                      disabled={anyRunActive}
                      onChange={(e) => setDryRun(e.target.checked)}
                      className="accent-accent"
                    />
                    Test the upload, nothing is written
                  </label>
                )}
              </div>
            )}

            {snap && (snap.phase === 'error' || snap.phase === 'partial') && !snap.dryRun && (
              <Note
                tone="warn"
                message={`Upload failed. If it keeps happening, ask your administrator to check: the bucket's CORS policy must allow this web origin for PUT, HEAD, and OPTIONS requests, and the credentials need PUT, HEAD, and LIST permissions on the upload prefix. Collection ID: ${dest.collectionUuid}.`}
              />
            )}
          </>
        )}
        {isResumed && !dest && (
          <p className="font-body text-[13px] text-inkSoft">Loading the saved upload destination…</p>
        )}

        {stillInspecting > 0 && (
          <Note
            tone="mute"
            message={`Still inspecting ${stillInspecting} file${stillInspecting === 1 ? '' : 's'} in the background — uploading proceeds as each one finishes; publishing waits until every file is done.`}
          />
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

      {noCameraTime > 0 && (
        <p className="font-mono text-[12px] text-inkSoft">
          {noCameraTime} files without a camera capture time · reviewed in Assign · timestamp_issues → true
        </p>
      )}

      {/* Live run */}
      {snap && <RunMonitor snap={snap} />}

      {retryError && <Note tone="warn" message={retryError} />}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ruleSoft pt-5">
        <button
          onClick={() => setStep('assign')}
          disabled={anyRunActive}
          className={`border border-ink text-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
            anyRunActive ? 'opacity-40 cursor-not-allowed' : ''
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
          ) : anyRunActive ? (
            <button
              disabled
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] opacity-40 cursor-not-allowed"
            >
              {effectiveDryRun ? 'Start dry run' : 'Start upload'}
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
          ) : (snap?.phase === 'partial' || snap?.phase === 'error') && !snap.dryRun ? (
            <button
              onClick={retryFailed}
              disabled={!realUploadAllowed}
              title={!realUploadAllowed ? "You're offline — reconnect or choose Try real upload anyway" : undefined}
              aria-describedby={!realUploadAllowed ? uploadConnectivityStatusId : undefined}
              className={`bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${!realUploadAllowed ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              {snap.phase === 'error' ? 'Resume upload' : 'Retry failed files'}
            </button>
          ) : (
            <button
              onClick={start}
              disabled={!effectiveDryRun && !realUploadAllowed}
              title={!effectiveDryRun && !realUploadAllowed ? "You're offline — reconnect or choose Try real upload anyway" : undefined}
              aria-describedby={!effectiveDryRun && !realUploadAllowed ? uploadConnectivityStatusId : undefined}
              className={`bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${!effectiveDryRun && !realUploadAllowed ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              {effectiveDryRun ? 'Start dry run' : 'Start upload'}
            </button>
          )}
        </div>
      </div>

      {snap?.phase === 'done' && !snap.dryRun && !completeDismissed && (
        <UploadCompleteDialog
          doneCount={snap.files.filter((f) => f.state === 'done').length}
          collectionId={snap.collectionUuid}
          onClose={() => setCompleteDismissed(true)}
        />
      )}
    </div>
  );
}
