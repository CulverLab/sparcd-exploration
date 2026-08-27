// Live view of an upload run, rendered by the New-upload Upload step for both
// fresh runs and resumes handed off from History. Driven entirely by an
// `UploadSnapshot`: progress, byte counts, and the streaming PUT log.

import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatBytes } from '../lib/scanFiles';
import type { FileState, UploadSnapshot } from '../lib/upload';

// Skipped is a satisfied state (verified already uploaded), not a warning —
// only failed earns the warn color.
const STATE_DOT: Record<FileState, string> = {
  inspecting: 'bg-inkMute',
  pending: 'bg-ruleSoft',
  uploading: 'bg-accent',
  done: 'bg-ok',
  skipped: 'bg-inkMute',
  failed: 'bg-warn',
};

const ROW = 40;

const PHASE_LABEL: Record<UploadSnapshot['phase'], string> = {
  idle: 'idle',
  preparing: 'preparing',
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

  // Follow the run, but don't fight a user who scrolled up to look at
  // something: only advance once every file currently on screen has settled
  // (done/skipped/failed), then center the next not-yet-settled file so
  // there's room to watch it either way.
  useEffect(() => {
    const isSettled = (f: (typeof files)[number]) =>
      f.state === 'done' || f.state === 'skipped' || f.state === 'failed';
    const activeIndex = files.findIndex((f) => !isSettled(f));
    if (activeIndex < 0) return;
    const visible = virtualizer.range;
    if (!visible) return;
    for (let i = visible.startIndex; i <= visible.endIndex; i++) {
      if (!isSettled(files[i])) return;
    }
    virtualizer.scrollToIndex(activeIndex, { align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.version]);

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
                {f.state === 'uploading' ? `${Math.round(pct)}%` : f.state}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
}

const fmtRate = (bytesPerSec: number): string =>
  `${formatBytes(bytesPerSec)}/s (${(bytesPerSec * 8 / 1e6).toFixed(bytesPerSec * 8 < 10e6 ? 1 : 0)} Mbps)`;

// ETA reads best coarse: second-precision at hours-out just spins digits.
function fmtEta(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `~${Math.max(5, Math.round(s / 5) * 5)}s left`;
  const m = s / 60;
  if (m < 90) return `~${Math.round(m)} min left`;
  return `~${Math.floor(m / 60)}h ${Math.round((m % 60) / 5) * 5}m left`;
}

// Files ≤ 8 MiB report bytes only on completion (no streaming progress from
// fetch), so the byte counter moves in whole-file steps. A ~20 s window keeps
// the rate honest across those jumps.
const RATE_WINDOW_MS = 20_000;

/**
 * Live speed / elapsed / ETA for a wet run. Rate comes from a rolling window of
 * (time, transferred bytes) samples taken on every snapshot emit; a 1 s ticker
 * keeps elapsed and ETA counting between emits, so the estimate is always
 * current — a stall shows up as a sinking rate and a growing ETA, not a frozen
 * number. Skipped bytes are excluded from the rate: a resume credits them
 * instantly, which would read as a burst of speed nobody transferred. ETA still
 * measures the whole remainder — skipped files are already complete, so
 * remaining-to-transfer over transfer-rate is the honest estimate.
 */
function Telemetry({ snap }: { snap: UploadSnapshot }) {
  const samples = useRef<{ t: number; b: number }[]>([]);
  const startedAt = useRef<number | null>(null);
  const finishedAt = useRef<number | null>(null);
  const [, force] = useState(0);

  const running = snap.phase === 'blobs' || snap.phase === 'metadata';
  const settled = snap.phase === 'done' || snap.phase === 'partial' || snap.phase === 'error';
  const transferred = snap.uploadedBytes - snap.skippedBytes;

  // New session → fresh clock and window.
  useEffect(() => {
    samples.current = [];
    startedAt.current = null;
    finishedAt.current = null;
  }, [snap.sessionId]);

  useEffect(() => {
    if (running && startedAt.current === null) {
      startedAt.current = Date.now();
      finishedAt.current = null;
    }
    if (settled && startedAt.current !== null && finishedAt.current === null) {
      finishedAt.current = Date.now();
      force((n) => n + 1);
    }
  }, [running, settled]);

  // Sample the byte counter on every snapshot emit.
  useEffect(() => {
    if (!running) return;
    const now = Date.now();
    samples.current.push({ t: now, b: transferred });
    const cutoff = now - RATE_WINDOW_MS;
    while (samples.current.length > 2 && samples.current[1].t < cutoff) samples.current.shift();
  }, [snap.version, running, transferred]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (snap.dryRun || startedAt.current === null) return null;

  const now = finishedAt.current ?? Date.now();
  const elapsedMs = now - startedAt.current;
  const avgRate = elapsedMs > 500 ? transferred / (elapsedMs / 1000) : 0;

  if (settled) {
    return (
      <p className="font-mono text-[12px] text-inkSoft">
        {formatBytes(transferred)} in {fmtDuration(elapsedMs)}
        {avgRate > 0 && <> · avg {fmtRate(avgRate)}</>}
      </p>
    );
  }

  const oldest = samples.current.find((s) => s.t >= now - RATE_WINDOW_MS) ?? samples.current[0];
  const windowSec = oldest ? (now - oldest.t) / 1000 : 0;
  const rate = oldest && windowSec > 0.5 ? (transferred - oldest.b) / windowSec : 0;
  const remaining = Math.max(0, snap.totalBytes - snap.uploadedBytes);
  const etaMs = rate > 0 ? (remaining / rate) * 1000 : null;

  return (
    <p className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[12px] text-inkSoft">
      <span>{rate > 0 ? fmtRate(rate) : 'measuring…'}</span>
      <span>elapsed {fmtDuration(elapsedMs)}</span>
      {snap.lanes ? <span>· {snap.lanes} lanes</span> : null}
      <span className="text-ink">{etaMs !== null ? fmtEta(etaMs) : 'estimating…'}</span>
    </p>
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
          {counts.uploading ? (
            <>
              {' · '}
              <span className="font-mono text-accent">{counts.uploading}</span>{' '}
              in flight
            </>
          ) : null}
          {counts.skipped ? (
            <>
              {' · '}
              <span className="font-mono text-inkSoft">{counts.skipped}</span> skipped
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

      <Telemetry snap={snap} />

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
