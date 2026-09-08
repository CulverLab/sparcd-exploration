import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useStore } from '../store';
import { useDraftStore, type UploadCtx } from '../lib/drafts';
import { performSync } from '../lib/syncRunner';
import { useCollections } from '../lib/queries';
import type { SyncResult } from '../lib/sync';
import type { TagImage } from '../lib/workspace';
import type { DraftRecord } from '../lib/db';

// Upload prefixes are stamped `YYYY.MM.DD.HH.MM.SS_user` — the folder name
// under Uploads/ is the closest thing this data model has to an upload name.
function uploadNameOf(uploadPrefix: string): string {
  const segments = uploadPrefix.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? uploadPrefix;
}

// The Sync action: the tagger's only path that writes to S3. It previews the
// diff against the canonical base (a dry-run, so the preview itself writes
// nothing), surfaces a conflict before any write, and — only when dry-run is
// turned off — replaces the canonical `media.csv` / `observations.csv` /
// `UploadMeta.json` in place after an immutable snapshot.

type Phase = 'previewing' | 'preview' | 'running' | 'done';

export function SyncDialog({
  ctx,
  images,
  drafts,
  onClose,
}: {
  ctx: UploadCtx;
  images: TagImage[];
  drafts: Record<string, DraftRecord>;
  onClose: () => void;
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
  const markUploadSynced = useDraftStore((s) => s.markUploadSynced);
  const setTimeOffset = useDraftStore((s) => s.setTimeOffset);
  const discardUpload = useDraftStore((s) => s.discardUpload);
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('previewing');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const args = () => ({
    cfg: cfg!,
    bucket: ctx.bucket,
    uploadPrefix: ctx.uploadPrefix,
    user,
    images,
    drafts,
  });

  // Preview on open — a forced dry-run that computes the diff and detects a
  // conflict without touching the bucket.
  useEffect(() => {
    let live = true;
    setSyncState('syncing');
    performSync({ ...args(), dryRun: true })
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
  }, []);

  const runSyncNow = async () => {
    setPhase('running');
    setError(null);
    setSyncState('syncing');
    try {
      const r = await performSync({ ...args(), dryRun });
      setResult(r);
      setSyncState(syncStateFor(r, dryRun));
      if (r.status === 'synced' && !dryRun) {
        // Clear dirty only on the drafts actually written — questionable-only
        // drafts (no canonical target) stay surfaced as unsaved.
        await markUploadSynced(ctx, r.syncedMediaIds ?? []);
        // The offset was baked into media.csv (performSync cleared it in Dexie);
        // reset the in-memory value too so the active-offset indicator clears.
        setTimeOffset(ctx, null);
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

  return (
    <Backdrop onClose={busy ? undefined : onClose}>
      <div className="w-full max-w-[480px] max-h-[calc(100dvh-2rem)] overflow-y-auto bg-paper border border-ink shadow-xl">
        <header className="flex items-center justify-between border-b border-rule px-5 h-12">
          <h2 className="font-display text-[18px] text-ink">Sync to S3</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="max-md:w-11 max-md:h-11 max-md:grid max-md:place-items-center text-inkMute hover:text-ink text-[18px] leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4 space-y-4 text-[14px] text-ink font-body">
          {phase === 'previewing' && <p className="text-inkMute font-mono text-[13px]">Checking the canonical base…</p>}

          {error && (
            <p className="text-warn font-mono text-[13px] border border-warn px-3 py-2">{error}</p>
          )}

          {!user && !error && (
            <p className="text-warn font-mono text-[13px] border border-warn px-3 py-2">
              Set a Tagger identity in Settings first — it stamps the audit snapshot path and the
              mandatory edit comment.
            </p>
          )}

          {result && (
            <ResultBody
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
              <button onClick={onClose} disabled={busy} className={btnGhost}>
                {phase === 'done' && result?.status === 'synced' ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={() => void runSyncNow()}
                disabled={busy || !canWrite}
                className={btnPrimary}
              >
                {busy ? '…' : dryRun ? 'Run dry-run' : 'Sync now'}
              </button>
            </>
          )}
        </footer>
      </div>
    </Backdrop>
  );
}

function ResultBody({
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
      return <p className="text-inkMute">No local edits to sync — everything matches the canonical files.</p>;
    case 'conflict':
      return (
        <div className="space-y-2">
          <p className="text-warn font-[600]">Conflict — the upload changed since you loaded it.</p>
          <p className="text-[13px] text-inkSoft">
            <span className="font-mono">{result.role}</span> {result.reason}. Your local edits are
            safe. Reload the remote (discarding local edits) and re-tag, or keep editing and export.
          </p>
        </div>
      );
    case 'unsupported':
      return <p className="text-warn font-[600]">{result.message}</p>;
    case 'dry-run':
      return (
        <div className="space-y-2">
          <SummaryGrid summary={result.summary} />
          <p className="text-[13px] text-inkSoft font-mono">
            Would write {result.writes.length} file(s):{' '}
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
        <div className="space-y-2">
          <SummaryGrid summary={result.summary} />
          <p className="text-accent text-[13px] font-[600]">
            {dryRun ? 'Dry-run complete.' : 'Synced — canonical files replaced.'}
          </p>
        </div>
      );
  }
}

function SummaryGrid({
  summary,
}: {
  summary: { additions: number; modifications: number; removals: number; timeCorrections: number };
}) {
  const cells: [string, number][] = [
    ['Added', summary.additions],
    ['Changed', summary.modifications],
    ['Removed', summary.removals],
    ['Time-corrected', summary.timeCorrections],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cells.map(([label, n]) => (
        <div key={label} className="border border-rule px-2 py-1.5 text-center">
          <div className="font-mono text-[18px] text-ink leading-none">{n}</div>
          <div className="text-[11px] text-inkMute mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
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
