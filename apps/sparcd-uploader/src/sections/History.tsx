// Past and in-flight upload sessions, read from the Dexie resume store (P5).
// Completed batches are a record; open batches (no completedAt) offer Resume —
// which restores local file access (durable handle or reselect-and-reconcile)
// and replays the persisted bundle, skipping done blobs and re-uploading the
// rest. Discard drops the local session row only; it never touches remote state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { OfflineBanner, useOnline } from '@sparcd/auth-ui';
import { useStore } from '../store';
import { formatBytes } from '../lib/scanFiles';
import {
  listBatches,
  loadSession,
  discardSession,
  fileStateCounts,
  updateBatch,
  type BatchRecord,
  type LoadedSession,
  type PersistedFileState,
} from '../lib/db';
import {
  restoreFromHandle,
  reconcileReselect,
  reselectFolder,
  type ReconcileProblem,
} from '../lib/resume';
import { scanFileList, supportsDirectoryHandle } from '../lib/scanFiles';
import { resumeUpload } from '../lib/upload';
import { Note, RunMonitor } from '../components/RunMonitor';
import { PublishedUploads } from '../components/PublishedUploads';

type Row = { batch: BatchRecord; counts: Record<PersistedFileState, number> };

const stampOf = (prefix: string) => prefix.slice(prefix.lastIndexOf('/') + 1);

function Badge({ batch }: { batch: BatchRecord }) {
  const done = !!batch.completedAt;
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border ${
        done ? 'border-ok/50 text-ok' : 'border-warn/50 text-warn'
      }`}
    >
      {done ? 'complete' : 'open'}
    </span>
  );
}

export function History() {
  const s3Config = useStore((s) => s.s3Config);
  const concurrency = useStore((s) => s.uploadConcurrency);

  // Run and snapshot live in the store so they survive section navigation.
  // Filter activeSnap by source so New-Upload snapshots don't appear here.
  const snap = useStore((s) => s.activeRunSource === 'history' ? s.activeSnap : null);
  const setActiveRun = useStore((s) => s.setActiveRun);
  const setActiveSnap = useStore((s) => s.setActiveSnap);
  const clearActiveRun = useStore((s) => s.clearActiveRun);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [active, setActive] = useState<string | null>(null); // sessionId being resumed
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<ReconcileProblem[]>([]);
  const reselectRef = useRef<HTMLInputElement>(null);
  const pendingReselect = useRef<BatchRecord | null>(null);

  const refresh = useCallback(async () => {
    const batches = await listBatches();
    const withCounts = await Promise.all(
      batches.map(async (batch) => ({ batch, counts: await fileStateCounts(batch.id) })),
    );
    setRows(withCounts);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = snap?.phase === 'blobs' || snap?.phase === 'metadata';
  const online = useOnline();

  const launch = useCallback(
    async (
      batch: BatchRecord,
      session: LoadedSession,
      attached: Map<string, File>,
      probs: ReconcileProblem[],
    ) => {
      const missingRequired = session.files.filter((f) => f.state !== 'done' && !attached.has(f.localPath));
      if (missingRequired.length > 0) {
        setProblems([
          ...probs,
          ...missingRequired.map((f) => ({
            localPath: f.localPath,
            fileName: f.fileName,
            reason: 'required for resume but not reattached',
          })),
        ]);
        setMessage(
          `${missingRequired.length} pending or failed source file${
            missingRequired.length === 1 ? '' : 's'
          } could not be reattached. Reselect the original folder before resuming.`,
        );
        return;
      }
      setProblems(probs);
      setActive(batch.id);
      setMessage(null);
      const run = resumeUpload(
        { config: s3Config!, session, attached, concurrency },
        (s) => {
          setActiveSnap(s);
          if (s.phase === 'done' || s.phase === 'error') void refresh();
        },
      );
      setActiveRun(run, 'history');
    },
    [s3Config, concurrency, refresh],
  );

  const beginResume = useCallback(
    async (batch: BatchRecord) => {
      setProblems([]);
      setActiveSnap(null);
      if (!s3Config) {
        setMessage('Connect to a storage endpoint before resuming.');
        return;
      }
      // The first await below must be the actual gated call — permission
      // request, directory picker, or the hidden <input>'s `.click()` —
      // not this session load. Firefox/Safari require those to fire within
      // the click's transient user-activation window; an unrelated await
      // ahead of them (even a fast IndexedDB read) silently breaks it: no
      // prompt, no error, nothing happens. Kick the load off in parallel
      // instead and only consume it once the gated step has resolved.
      const sessionPromise = loadSession(batch.id);

      // Durable handle: revalidate permission inside this click gesture, then
      // re-hash against the recorded files — a same-size in-place edit between
      // sessions would otherwise slip through, so mismatches surface as problems.
      if (batch.fileAccessMode === 'persistent-handle' && batch.dirHandle) {
        const restore = await restoreFromHandle(
          batch,
          sessionPromise.then((s) => s?.files ?? []),
        );
        const session = await sessionPromise;
        if (!session) {
          setMessage('Session record is missing.');
          return;
        }
        if (restore.ok) {
          await launch(batch, session, restore.attached, restore.problems);
          return;
        }
        setMessage(restore.reason);
        // fall through to reselect
      }

      // Reselect path.
      if (supportsDirectoryHandle) {
        const picked = await reselectFolder();
        if (!picked) return; // user dismissed
        const session = await sessionPromise;
        if (!session) {
          setMessage('Session record is missing.');
          return;
        }
        const { attached, problems: probs } = await reconcileReselect(session.files, picked.scanned);
        // Opportunistically upgrade the session to a durable handle for next time.
        if (picked.handle) {
          await updateBatch(batch.id, { dirHandle: picked.handle, fileAccessMode: 'persistent-handle' });
        }
        await launch(batch, session, attached, probs);
      } else {
        // No durable picker — fall back to a transient <input webkitdirectory>,
        // fired synchronously here for the same reason. `onReselectInput`
        // loads its own session once files actually arrive.
        pendingReselect.current = batch;
        reselectRef.current?.click();
      }
    },
    [s3Config, launch],
  );

  const onReselectInput = useCallback(
    async (list: File[] | null) => {
      const batch = pendingReselect.current;
      pendingReselect.current = null;
      if (!batch || !list || list.length === 0) return;
      const session = await loadSession(batch.id);
      if (!session) {
        setMessage('Session record is missing.');
        return;
      }
      const { attached, problems: probs } = await reconcileReselect(session.files, scanFileList(list));
      await launch(batch, session, attached, probs);
    },
    [launch],
  );

  const discard = useCallback(
    async (sessionId: string) => {
      if (active === sessionId) {
        useStore.getState().activeRun?.cancel();
        setActive(null);
        clearActiveRun();
      }
      await discardSession(sessionId);
      await refresh();
    },
    [active, clearActiveRun, refresh],
  );

  if (rows === null) {
    return (
      <div className="px-6 py-6 max-w-2xl mx-auto">
        <p className="font-body text-[14px] text-inkSoft">Loading sessions…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-6 max-w-2xl mx-auto space-y-8">
        <div className="border border-ruleSoft bg-panel px-6 py-12 text-center">
          <p className="font-display text-[18px] text-ink mb-1">No uploads yet</p>
          <p className="font-body text-[14px] text-inkSoft">
            Normal uploads are tracked here for resume — date, collection, deployment, file count, and
            status. Dry runs write nothing, so they are not recorded.
          </p>
        </div>
        <PublishedUploads />
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto space-y-5">
      <OfflineBanner message="You're offline — Resume won't work until your connection is back." />
      <input
        ref={reselectRef}
        type="file"
        // @ts-expect-error — non-standard folder picker, widely supported
        webkitdirectory=""
        directory=""
        multiple
        hidden
        onChange={(e) => {
          // Snapshot before clearing: FileList is live, and `onReselectInput`
          // is async — its first `await` (loadSession) yields back here
          // before it touches the list, so clearing `.value` synchronously
          // right after would empty the same FileList out from under it,
          // making every file look missing. Array.from freezes it first.
          void onReselectInput(e.target.files ? Array.from(e.target.files) : null);
          e.target.value = '';
        }}
      />

      {message && <Note tone="warn" message={message} />}

      {problems.length > 0 && (
        <div className="border border-warn/40 bg-paper px-3 py-2.5 space-y-1">
          <p className="font-body text-[13px] text-warn">
            {problems.length} file{problems.length === 1 ? '' : 's'} could not be reconciled:
          </p>
          <ul className="font-mono text-[11px] text-inkSoft max-h-32 overflow-auto">
            {problems.slice(0, 50).map((p) => (
              <li key={p.localPath} className="truncate" title={`${p.localPath} — ${p.reason}`}>
                {p.fileName} — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {active && snap && (
        <div className="space-y-3 border border-rule bg-panel p-4">
          <div className="flex items-center justify-between">
            <p className="font-body text-[13px] text-inkSoft">
              Resuming <span className="font-mono text-ink">{stampOf(snap.uploadPath ?? '')}</span>
            </p>
            {running ? (
              <button
                onClick={() => useStore.getState().activeRun?.cancel()}
                className="border border-warn text-warn px-3 py-1 text-[13px] font-body hover:bg-paperHover"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={() => {
                  setActive(null);
                  clearActiveRun();
                }}
                className="border border-ink text-ink px-3 py-1 text-[13px] font-body hover:bg-paperHover"
              >
                Dismiss
              </button>
            )}
          </div>
          <RunMonitor snap={snap} />
        </div>
      )}

      <ul className="space-y-3">
        {rows.map(({ batch, counts }) => {
          const isActive = active === batch.id;
          const total = batch.totalFiles;
          return (
            <li key={batch.id} className="border border-ruleSoft bg-panel px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] text-ink truncate" title={batch.uploadPrefix}>
                    {stampOf(batch.uploadPrefix)}
                  </p>
                  <p className="font-body text-[12px] text-inkSoft truncate">
                    {batch.targetBucket} · {new Date(batch.startedAt).toLocaleString()}
                  </p>
                </div>
                <Badge batch={batch} />
              </div>

              <p className="font-body text-[12px] text-inkSoft">
                <span className="font-mono text-ink">{total}</span> files ·{' '}
                <span className="font-mono text-ink">{formatBytes(batch.totalBytes)}</span> ·{' '}
                <span className="font-mono text-ok">{counts.done}</span> done
                {counts.failed > 0 && (
                  <>
                    {' · '}
                    <span className="font-mono text-warn">{counts.failed}</span> failed
                  </>
                )}
              </p>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                {!batch.completedAt && (
                  <button
                    disabled={running}
                    title={!online ? "You're offline" : undefined}
                    onClick={() => void beginResume(batch)}
                    className={`bg-ink text-paper border border-ink min-h-[44px] sm:min-h-0 px-4 sm:px-3 py-1 text-[13px] font-body font-[600] hover:opacity-90 ${
                      running ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    {isActive ? 'Resuming…' : 'Resume'}
                  </button>
                )}
                <button
                  disabled={running && isActive}
                  onClick={() => void discard(batch.id)}
                  className="border border-ink text-ink min-h-[44px] sm:min-h-0 px-4 sm:px-3 py-1 text-[13px] font-body hover:bg-paperHover"
                >
                  Discard
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="pt-3 border-t border-ruleSoft">
        <PublishedUploads />
      </div>
    </div>
  );
}
