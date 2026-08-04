// Live view of an upload run, shared by the New-upload Upload step and the
// History resume flow. Driven entirely by an `UploadSnapshot`, so both callers
// render identical progress, byte counts, and the streaming PUT log.

import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatBytes } from '../lib/scanFiles';
import type { FileState, UploadSnapshot } from '../lib/upload';

const STATE_DOT: Record<FileState, string> = {
  inspecting: 'bg-inkMute',
  pending: 'bg-ruleSoft',
  uploading: 'bg-accent',
  verifying: 'bg-accent',
  done: 'bg-ok',
  skipped: 'bg-warn',
  failed: 'bg-warn',
};

const ROW = 40;

const PHASE_LABEL: Record<UploadSnapshot['phase'], string> = {
  idle: 'idle',
  blobs: 'uploading',
  metadata: 'publishing',
  partial: 'partial',
  done: 'done',
  error: 'error',
};

export function Note({ message, tone = 'mute' }: { message: string; tone?: 'mute' | 'warn' }) {
  return (
    <div
      className={`border px-3 py-2.5 font-body text-[13px] ${
        tone === 'warn' ? 'border-warn/40 text-warn bg-paper' : 'border-ruleSoft text-inkSoft bg-paper'
      }`}
    >
      {message}
    </div>
  );
}

function ProgressList({ snap }: { snap: UploadSnapshot }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const files = snap.files;
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  return (
    <div
      ref={parentRef}
      className="max-h-64 sm:max-h-none sm:h-[40dvh] overflow-auto overscroll-contain border border-rule bg-panel"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const f = files[vi.index];
          const pct = f.size > 0 ? Math.min(100, (f.loaded / f.size) * 100) : 100;
          const tail = f.key.slice(f.key.lastIndexOf('/') + 1);
          return (
            <div
              key={f.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 right-0 grid grid-cols-[14px_1fr_auto] sm:grid-cols-[14px_1fr_120px_72px] items-center gap-x-3 gap-y-1 px-3 min-h-[40px] border-b border-ruleSoft"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <span
                className={`w-2 h-2 rounded-full ${STATE_DOT[f.state]}`}
                title={f.error ?? f.state}
                aria-hidden
              />
              <span className="min-w-0 col-span-2 sm:col-span-1">
                <span className="block truncate font-mono text-[12px] text-ink" title={f.key}>
                  {tail}
                </span>
                {f.error && (
                  <span className="block truncate font-body text-[11px] text-warn" title={f.error}>
                    {f.error}
                  </span>
                )}
              </span>
              <span className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 h-1.5 bg-paperHover border border-ruleSoft overflow-hidden">
                <span
                  className={`block h-full ${f.state === 'failed' ? 'bg-warn' : 'bg-accent'}`}
                  style={{ width: `${f.state === 'done' || f.state === 'skipped' ? 100 : pct}%` }}
                />
              </span>
              <span className="col-start-3 row-start-2 sm:col-start-4 sm:row-start-1 font-mono text-[11px] text-inkSoft text-right">
                {f.state === 'uploading' || f.state === 'verifying' ? `${Math.round(pct)}%` : f.state}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LOG_TONE = {
  put: 'text-inkSoft',
  info: 'text-inkSoft',
  warn: 'text-warn',
  error: 'text-warn',
} as const;

function LogPanel({ snap }: { snap: UploadSnapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the newest line in view as the run progresses.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snap.version]);

  const tail = snap.log.slice(-400);
  return (
    <div
      ref={ref}
      className="max-h-48 sm:max-h-none sm:h-[24dvh] overflow-auto overscroll-contain border border-ruleSoft bg-paper px-3 py-2 font-mono text-[11.5px] leading-[1.55]"
    >
      {tail.map((l, i) => (
        <div key={i} className={`break-all ${LOG_TONE[l.kind]}`}>
          {l.kind === 'put' ? '· ' : ''}
          {l.text}
        </div>
      ))}
      {snap.log.length === 0 && <span className="text-inkMute">No activity yet.</span>}
    </div>
  );
}

export function RunMonitor({ snap }: { snap: UploadSnapshot }) {
  const [showLog, setShowLog] = useState(false);
  const counts = snap.files.reduce(
    (a, f) => ((a[f.state] = (a[f.state] ?? 0) + 1), a),
    {} as Record<FileState, number>,
  );
  const failed = counts.failed ?? 0;
  const pct = snap.totalBytes > 0 ? (snap.uploadedBytes / snap.totalBytes) * 100 : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="font-body text-[13px] text-inkSoft">
          <span className="font-mono text-ink uppercase tracking-[0.12em] text-[11px]">
            {PHASE_LABEL[snap.phase]}
          </span>
          {snap.dryRun && <span className="ml-2 text-warn">dry run</span>}
          {' · '}
          <span className="font-mono text-ok">{counts.done ?? 0}</span> done
          {counts.inspecting ? (
            <>
              {' · '}
              <span className="font-mono text-inkMute">{counts.inspecting}</span> inspecting
            </>
          ) : null}
          {counts.skipped ? (
            <>
              {' · '}
              <span className="font-mono text-warn">{counts.skipped}</span> skipped
            </>
          ) : null}
          {counts.failed ? (
            <>
              {' · '}
              <span className="font-mono text-warn">{counts.failed}</span> failed
            </>
          ) : null}
        </p>
        <p className="shrink-0 font-mono text-[12px] text-inkSoft">
          {formatBytes(snap.uploadedBytes)} / {formatBytes(snap.totalBytes)}
        </p>
      </div>

      <div className="h-2 bg-paperHover border border-ruleSoft overflow-hidden">
        <span
          className={`block h-full ${snap.phase === 'error' ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${snap.phase === 'done' ? 100 : pct}%` }}
        />
      </div>

      {snap.phase === 'done' && (
        <Note
          message={
            snap.dryRun
              ? `Dry run complete — ${snap.files.length} files would publish under ${snap.uploadPath}/. Nothing was written.`
              : `Published ${snap.files.length} files under ${snap.uploadPath}/. Bundle hash ${snap.metadataBundleSha256?.slice(0, 16)}…`
          }
        />
      )}
      {snap.phase === 'partial' && (
        <Note
          tone="warn"
          message={`${failed} of ${snap.files.length} files failed to upload — the rest are stored. Metadata was not published, so this upload is not yet visible; retry the failed files to complete it.`}
        />
      )}
      {snap.phase === 'error' && <Note tone="warn" message={snap.error ?? 'Upload failed.'} />}

      <ProgressList snap={snap} />

      <button
        type="button"
        onClick={() => setShowLog((v) => !v)}
        aria-expanded={showLog}
        className="sm:hidden flex w-full items-center justify-between min-h-11 px-3 border border-ruleSoft bg-paper font-mono text-[11px] uppercase tracking-[0.12em] text-inkSoft"
      >
        <span>Activity log</span>
        <span aria-hidden>{showLog ? '−' : '+'}</span>
      </button>
      <div className={`${showLog ? 'block' : 'hidden'} sm:block`}>
        <LogPanel snap={snap} />
      </div>
    </section>
  );
}
