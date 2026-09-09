import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '../store';
import { useDraftStore, type UploadCtx } from '../lib/drafts';
import { performRestore } from '../lib/syncRunner';
import { useCollections } from '../lib/queries';
import { listSnapshots, type SnapshotRef } from '../lib/s3';
import type { SyncResult } from '../lib/sync';

// Upload prefixes are stamped `YYYY.MM.DD.HH.MM.SS_user` — the folder name
// under Uploads/ is the closest thing this data model has to an upload name.
function uploadNameOf(uploadPrefix: string): string {
  const segments = uploadPrefix.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? uploadPrefix;
}

// P5 snapshot/version recovery. Every sync/restore writes an immutable
// pre-change snapshot of the canonical files; this dialog lists the recoverable
// ones for the current upload and restores a chosen snapshot back in place
// through the same conditional-replacement flow the sync uses — dry-run-first,
// conflict-aware, and gated on the dry-run toggle + a Tagger identity exactly
// like a sync, because a live restore writes to S3.

type Phase = 'previewing' | 'preview' | 'running' | 'done';

export function SnapshotsDialog({ ctx, onClose }: { ctx: UploadCtx; onClose: () => void }) {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const collectionKey = useStore((s) => s.selectedCollectionKey);

  const snapshots = useQuery<SnapshotRef[]>({
    queryKey: ['snapshots', connectionId, collectionKey, ctx.uploadPrefix],
    queryFn: () => listSnapshots(cfg!, ctx.bucket, ctx.uploadPrefix),
    enabled: !!cfg && !!ctx.bucket && !!ctx.uploadPrefix,
    staleTime: 30 * 1000,
    retry: 1,
  });

  const [picked, setPicked] = useState<SnapshotRef | null>(null);
  // A live restore must not be dismissable mid-write (it would keep writing
  // invisibly); the RestorePane reports its busy state up so close is blocked.
  const [busy, setBusy] = useState(false);

  return (
    <Backdrop onClose={busy ? undefined : onClose}>
      <div className="w-full max-w-[520px] max-h-[90dvh] overflow-y-auto bg-paper border border-ink shadow-xl">
        <header className="flex items-center justify-between border-b border-rule px-5 h-12">
          <h2 className="font-display text-[18px] text-ink">
            {picked ? 'Restore snapshot' : 'Snapshots'}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="max-md:w-11 max-md:h-11 max-md:grid max-md:place-items-center text-inkMute hover:text-ink text-[18px] leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {picked ? (
          <RestorePane
            ctx={ctx}
            snapshot={picked}
            onBack={() => setPicked(null)}
            onClose={onClose}
            onBusyChange={setBusy}
          />
        ) : (
          <div className="px-5 py-4 space-y-3 text-[14px] text-ink font-body max-h-[60dvh] overflow-y-auto">
            <p className="text-[13px] text-inkSoft">
              Immutable pre-change snapshots of this upload’s canonical files, written before each
              sync. Restoring one writes its versions back in place (after snapshotting the current
              state first).
            </p>

            {snapshots.isLoading && (
              <p className="text-inkMute font-mono text-[13px]">Listing snapshots…</p>
            )}
            {snapshots.isError && (
              <p className="text-warn font-mono text-[13px] border border-warn px-3 py-2">
                {(snapshots.error as Error).message}
              </p>
            )}
            {snapshots.data && snapshots.data.length === 0 && (
              <p className="text-[14px] text-inkMute border border-ruleSoft bg-panel px-4 py-6 text-center">
                No snapshots yet. They are created the first time you sync this upload.
              </p>
            )}
            {snapshots.data && snapshots.data.length > 0 && (
              <ul className="space-y-2">
                {snapshots.data.map((s) => (
                  <li
                    key={s.prefix}
                    className="border border-rule bg-panel px-4 py-3 flex items-center gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[14px] text-ink">{prettyStamp(s.stamp)}</div>
                      <div className="text-[12px] text-inkSoft mt-0.5">
                        by <span className="font-mono">{s.user}</span> · {s.manifest.files.length} files
                      </div>
                    </div>
                    <button
                      onClick={() => setPicked(s)}
                      className="shrink-0 text-[13px] border border-ink px-3 py-1.5 text-ink hover:bg-panelHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      Restore…
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!picked && (
          <footer className="flex items-center justify-end border-t border-rule px-5 py-3">
            <button onClick={onClose} className={btnGhost}>
              Close
            </button>
          </footer>
        )}
      </div>
    </Backdrop>
  );
}

function RestorePane({
  ctx,
  snapshot,
  onBack,
  onClose,
  onBusyChange,
}: {
  ctx: UploadCtx;
  snapshot: SnapshotRef;
  onBack: () => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const cfg = useStore((s) => s.s3Config);
  const user = useStore((s) => s.taggerUser).trim();
  const dryRun = useStore((s) => s.dryRun);
  const setDryRun = useStore((s) => s.setDryRun);
  const setSyncState = useStore((s) => s.setSyncState);
  const connectionId = useStore((s) => s.connectionId);
  const collectionKey = useStore((s) => s.selectedCollectionKey);
  const collections = useCollections(cfg, connectionId);
  const collection = collections.data?.find((c) => c.key === collectionKey);
  const collectionName = collection?.name ?? collection?.bucket ?? ctx.bucket;
  const uploadName = uploadNameOf(ctx.uploadPrefix);
  const discardUpload = useDraftStore((s) => s.discardUpload);
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('previewing');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const args = (dry: boolean) => ({
    cfg: cfg!,
    bucket: ctx.bucket,
    uploadPrefix: ctx.uploadPrefix,
    user,
    snapshotPrefix: snapshot.prefix,
    dryRun: dry,
  });

  // Preview on open — a forced dry-run that diffs the snapshot against the
  // current canonical without touching the bucket.
  useEffect(() => {
    let live = true;
    setSyncState('syncing');
    performRestore(args(true))
      .then((r) => {
        if (!live) return;
        setResult(r);
        setPhase('preview');
        setSyncState(syncStateFor(r, true));
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message);
        setPhase('preview');
        setSyncState('error');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.prefix]);

  const runNow = async () => {
    setPhase('running');
    setError(null);
    setSyncState('syncing');
    try {
      const r = await performRestore(args(dryRun));
      setResult(r);
      setSyncState(syncStateFor(r, dryRun));
      if (r.status === 'synced' && !dryRun) {
        // Leave local drafts as-is: after a restore they diff against the
        // restored base and may still differ, so marking them clean would be
        // wrong. Just refresh the workspace view; the user re-syncs or discards.
        await queryClient.invalidateQueries({ queryKey: ['tagImages', connectionId] });
      }
    } catch (e) {
      setError((e as Error).message);
      setSyncState('error');
    } finally {
      setPhase('done');
    }
  };

  const resolveConflictByDiscard = async () => {
    await discardUpload(ctx);
    await queryClient.invalidateQueries({ queryKey: ['tagImages', connectionId] });
    setSyncState('local-only');
    onClose();
  };

  const busy = phase === 'previewing' || phase === 'running';
  const isConflict = result?.status === 'conflict';
  const isNoop = result?.status === 'noop';
  const canWrite = !!user && !isConflict && !isNoop && !error;

  // Block the dialog's close affordances while busy; release on unmount (back).
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  return (
    <>
      <div className="px-5 py-4 space-y-4 text-[14px] text-ink font-body">
        <p className="text-[13px] text-inkSoft">
          Restoring <span className="font-mono text-ink">{prettyStamp(snapshot.stamp)}</span> by{' '}
          <span className="font-mono">{snapshot.user}</span>.
        </p>

        {phase === 'previewing' && (
          <p className="text-inkMute font-mono text-[13px]">Comparing the snapshot to the current files…</p>
        )}

        {error && <p className="text-warn font-mono text-[13px] border border-warn px-3 py-2">{error}</p>}

        {!user && !error && (
          <p className="text-warn font-mono text-[13px] border border-warn px-3 py-2">
            Set a Tagger identity in Settings first — a restore stamps a fresh audit snapshot path.
          </p>
        )}

        {result && (
          <RestoreResultBody
            result={result}
            dryRun={dryRun}
            live={phase === 'done'}
            collectionName={collectionName}
            uploadName={uploadName}
          />
        )}

        {!isConflict && !isNoop && !error && (
          <label className="flex items-center gap-2.5 border-t border-ruleSoft pt-3">
            <input
              type="checkbox"
              className="w-4 h-4 accent-accent"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={busy}
            />
            <span className="text-[13px]">Dry-run — log the writes, change nothing</span>
          </label>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-rule px-5 py-3">
        {isConflict ? (
          <>
            <button onClick={onClose} className={btnGhost}>
              Keep editing
            </button>
            <button onClick={() => void resolveConflictByDiscard()} className={btnWarn}>
              Discard local & reload
            </button>
          </>
        ) : (
          <>
            <button onClick={onBack} disabled={busy} className={btnGhost}>
              {phase === 'done' && result?.status === 'synced' ? '‹ Snapshots' : 'Cancel'}
            </button>
            <button onClick={() => void runNow()} disabled={busy || !canWrite} className={btnPrimary}>
              {busy ? '…' : dryRun ? 'Run dry-run' : 'Restore now'}
            </button>
          </>
        )}
      </footer>
    </>
  );
}

function RestoreResultBody({
  result,
  dryRun,
  live,
  collectionName,
  uploadName,
}: {
  result: SyncResult;
  dryRun: boolean;
  live: boolean;
  collectionName: string;
  uploadName: string;
}) {
  switch (result.status) {
    case 'noop':
      return <p className="text-inkMute">This snapshot already matches the current canonical files — nothing to restore.</p>;
    case 'conflict':
      return (
        <div className="space-y-2">
          <p className="text-warn font-[600]">Conflict — the upload changed since you loaded it.</p>
          <p className="text-[13px] text-inkSoft">
            <span className="font-mono">{result.role}</span> {result.reason}. Reload the remote
            (discarding local edits) and try the restore again, or keep editing.
          </p>
        </div>
      );
    case 'unsupported':
      return <p className="text-warn font-[600]">{result.message}</p>;
    case 'dry-run':
      return (
        <div className="space-y-2">
          <p className="text-[13px] text-inkSoft font-mono">
            Would restore {result.writes.length} file(s):{' '}
            {result.writes.map((w) => w.role).join(', ') || '—'}.
          </p>
          <p className="text-[12px] text-inkMute font-mono break-all">
            {collectionName} / {uploadName}
          </p>
          {live && <p className="text-accent text-[13px]">Dry-run complete — nothing was written.</p>}
        </div>
      );
    case 'synced':
      return (
        <p className="text-accent text-[13px] font-[600]">
          {dryRun ? 'Dry-run complete.' : 'Restored — canonical files replaced from the snapshot.'}
        </p>
      );
  }
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
      onClick={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      {children}
    </div>
  );
}

// Snapshot stamp is `uuuu-MM-ddTHH-mm-ss`; show it as `uuuu-MM-dd HH:MM:SS`.
function prettyStamp(stamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(stamp);
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : stamp;
}

function syncStateFor(r: SyncResult, dryRun: boolean): ReturnType<typeof useStore.getState>['syncState'] {
  switch (r.status) {
    case 'conflict':
      return 'conflict';
    case 'unsupported':
      return 'error';
    case 'synced':
      return dryRun ? 'dry-run' : 'synced';
    case 'dry-run':
      return 'dry-run';
    case 'noop':
      return 'local-only';
  }
}

const btnGhost =
  'text-[13px] border border-rule px-3 py-2.5 md:py-1.5 min-h-11 md:min-h-0 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const btnPrimary =
  'text-[13px] border border-ink bg-ink text-paper px-3 py-2.5 md:py-1.5 min-h-11 md:min-h-0 hover:bg-inkSoft disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const btnWarn =
  'text-[13px] border border-warn text-warn px-3 py-2.5 md:py-1.5 min-h-11 md:min-h-0 hover:bg-warn hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
