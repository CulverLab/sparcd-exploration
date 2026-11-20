import { InspectPreview } from './InspectPreview';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FlipObservation } from '@sparcd/flip';
import { useStore, type FileEntry } from '../store';
import { formatBytes } from '../lib/scanFiles';
import { formatNaive, type NaiveDateTime } from '../lib/exifTime';
import type { CaptureEstimate } from '../lib/estimateCaptureTime';
import { useCaptureEstimates, effectiveTime, methodLine, sourceTag } from '../lib/useCaptureEstimates';
import type { FileValidation, Severity } from '../lib/validation';
import { isAnyMissingRemovalPending, isMissingRemovalPending, missingRemovalVersion, removeMissingOriginal, subscribeMissingRemoval } from '../lib/preparation';

const ROW = 52;
// A batch back from the tagger carries a species line under each filename.
const ROW_TAGGED = 68;

/** The tagger's non-animal label — an empty frame the tagger confirmed. */
const GHOST_SCIENTIFIC_NAME = 'Casper';
// Phones get a 3-track layout (thumb, name, trailing); the full 6-column
// template only kicks in at sm, keeping the desktop grid identical.
const COLS = 'grid-cols-[44px_1fr_auto] sm:grid-cols-[44px_1fr_150px_92px_84px_128px]';

const SEVERITY_DOT: Record<Severity, string> = {
  ok: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-warn',
};

// Display the naive EXIF wall-clock as-written (no zone shift). The chosen
// upload zone affects the stored offset-bearing timestamp, not this raw display.
function shortTime(n?: NaiveDateTime): string {
  if (!n) return '—';
  return formatNaive(n).replace('T', ' ');
}

function Thumb({ blob, isVideo }: { blob?: Blob; isVideo: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (url) {
    return <img src={url} alt="" className="w-9 h-9 object-cover border border-ruleSoft" />;
  }
  // Typed placeholder: a film-strip glyph for video, a blank tile otherwise.
  if (isVideo) {
    return (
      <span
        className="w-9 h-9 bg-paperHover border border-ruleSoft grid place-items-center text-inkMute text-[14px]"
        aria-label="video"
      >
        ▦
      </span>
    );
  }
  return <span className="w-9 h-9 bg-paperHover border border-ruleSoft block" aria-hidden />;
}

function StatusCell({ entry, validation }: { entry: FileEntry; validation?: FileValidation }) {
  if (entry.processState === 'queued') return <span className="text-inkMute text-[12px]">Queued</span>;
  if (entry.processState === 'processing')
    return <span className="text-inkSoft text-[12px]">Processing…</span>;

  const v = validation ?? { severity: 'ok' as Severity, issues: [] };
  const label =
    v.severity === 'error' ? 'Needs attention' : v.severity === 'warning' ? 'Warning' : 'OK';
  const title = v.issues.map((i) => i.message).join('; ') || 'Valid';
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-inkSoft" title={title}>
      <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT[v.severity]}`} aria-hidden />
      {label}
    </span>
  );
}

// Read-only: what the tagger identified, before any of it is uploaded. Editing
// happens back in the tagger, never here.
function SpeciesChips({ observations }: { observations: FlipObservation[] }) {
  if (observations.length === 0) {
    return (
      <span className="inline-flex items-center border border-dashed border-ruleSoft px-1.5 text-[11px] font-mono text-inkMute">
        untagged
      </span>
    );
  }
  return (
    <>
      {observations.map((o) => {
        const ghost = o.scientificName === GHOST_SCIENTIFIC_NAME;
        return (
          <span
            key={o.scientificName}
            title={o.scientificName}
            className={`inline-flex items-center gap-1 border px-1.5 text-[11px] font-mono ${
              ghost ? 'border-inkMute text-inkMute' : 'border-ink bg-mark text-ink'
            }`}
          >
            {o.commonName || o.scientificName}
            {!ghost && <span className="text-inkSoft">×{o.count}</span>}
          </span>
        );
      })}
    </>
  );
}

function Row({
  entry,
  validation,
  showTags,
  active,
  estimates,
  timeZone,
  onSelect,
  onRemove,
  previewButtonRef,
  removeDisabled,
  onPreview,
}: {
  entry: FileEntry;
  validation?: FileValidation;
  showTags: boolean;
  active: boolean;
  estimates: Map<string, CaptureEstimate>;
  timeZone: string;
  onSelect: () => void;
  onRemove: () => void;
  previewButtonRef: (element: HTMLButtonElement | null) => void;
  removeDisabled: boolean;
  onPreview: () => void;
}) {
  const dims = entry.width && entry.height ? `${entry.width}×${entry.height}` : '—';
  const isVideo = entry.mediaKind === 'video';
  // A file with no camera time still has one: what the rule estimated, or the
  // override typed over it. The tag says which, so the column is never a lie.
  const { naive, source } = effectiveTime(entry, estimates);
  const how = source
    ? methodLine(entry, estimates.get(entry.id), timeZone)
    : undefined;
  const removalDescriptionId = `remove-original-description-${encodeURIComponent(entry.id)}`;
  return (
    <div
      onClick={onSelect}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onPreview(); }}
      className={`grid ${COLS} items-center gap-3 px-3 h-full border-b border-ruleSoft cursor-default ${
        active ? 'bg-mark' : 'hover:bg-panelHover'
      }`}
    >
      <button ref={previewButtonRef} type="button" aria-label={`Preview ${entry.fileName}`} title="Preview file"
        className="relative min-h-11 min-w-11 grid place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={(e) => { e.stopPropagation(); onPreview(); }}><Thumb blob={entry.thumbnail} isVideo={isVideo} /><span aria-hidden className="absolute bottom-0 right-0 bg-panel text-ink border border-rule text-[12px] px-0.5">↗</span></button>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[13px] text-ink" title={entry.relPath}>
          {entry.fileName}
        </span>
        <span
          className="block truncate font-mono text-[11px] text-inkMute"
          title={entry.sha256 ? `sha256:${entry.sha256}` : undefined}
        >
          <span className="text-inkSoft mr-1.5">{isVideo ? 'VIDEO' : 'JPEG'}</span>
          {entry.exifCamera ?? (entry.sha256 ? `${entry.sha256.slice(0, 12)}…` : entry.relPath)}
        </span>
        <span className="sm:hidden flex items-center gap-1 min-w-0 font-mono text-[11px] text-inkMute" title={how}>
          <span className="shrink-0">{shortTime(naive)}</span>
          {source && (
            <span className="shrink-0 border border-dashed border-rule px-1 text-[10px] uppercase tracking-[0.08em]">
              {sourceTag(source)}
            </span>
          )}
          <span className="truncate">· {dims} · {formatBytes(entry.size)}</span>
        </span>
        {showTags && (
          <span
            className="flex items-center gap-1 overflow-hidden mt-0.5"
            aria-label={`Species on ${entry.fileName}`}
          >
            <SpeciesChips observations={entry.preTags ?? []} />
          </span>
        )}
      </span>
      <span className="hidden sm:block font-mono text-[12px] text-inkSoft truncate" title={how ?? (naive ? formatNaive(naive) : undefined)}>
        {shortTime(naive)}
        {source && (
          <span className="block font-body text-[10px] font-[600] tracking-[0.08em] uppercase text-inkMute border border-dashed border-rule w-fit px-1 mt-0.5">
            {sourceTag(source)}
          </span>
        )}
      </span>
      <span className="hidden sm:block font-mono text-[12px] text-inkSoft text-right">{dims}</span>
      <span className="hidden sm:block font-mono text-[12px] text-inkSoft text-right">{formatBytes(entry.size)}</span>
      <span className="justify-self-start flex items-center gap-2">
        <StatusCell entry={entry} validation={validation} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`${entry.needsOriginal ? 'Remove unavailable or changed original' : 'Remove'} ${entry.fileName}`}
          aria-describedby={entry.needsOriginal ? removalDescriptionId : undefined}
          title={entry.needsOriginal ? 'Remove this missing or changed original from the saved batch' : 'Remove file'}
          disabled={removeDisabled}
          className={`${entry.needsOriginal ? 'sm:inline-flex px-2 w-auto' : 'sm:hidden min-w-11'} shrink-0 min-h-11 grid place-items-center gap-1 text-inkMute hover:text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          {entry.needsOriginal ? <><span aria-hidden>×</span><span className="hidden sm:inline">Remove</span></> : '✕'}
        </button>
        {entry.needsOriginal && <span id={removalDescriptionId} className="sr-only">Removes this file from the recovered batch and saved Tagger handoff. Does not delete the original file.</span>}
      </span>
    </div>
  );
}

export function FileList({ severityFilter = null, onEmptyRemovalFocus }: { severityFilter?: Severity | null; onEmptyRemovalFocus?: () => void }) {
  const allFiles = useStore((s) => s.files);
  const validations = useStore((s) => s.validations);
  const removeFile = useStore((s) => s.removeFile);
  useSyncExternalStore(subscribeMissingRemoval, missingRemovalVersion);
  const showTags = useStore((s) => s.flipId !== null);
  const parentRef = useRef<HTMLDivElement>(null);
  const previewButtons = useRef(new Map<string, HTMLButtonElement>());
  const removalFocus = useRef<{ removedId: string; fileId?: string; fallback: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const preview = allFiles.find((f) => f.id === previewId);
  useEffect(() => { if (previewId && !preview) setPreviewId(null); }, [previewId, preview]);
  function openPreview(id: string) {
    const focused = document.activeElement as HTMLElement;
    opener.current = parentRef.current?.contains(focused) ? focused : parentRef.current;
    setPreviewId(id);
  }

  const estimates = useCaptureEstimates();
  const timeZone = useStore((s) => s.uploadTimeZone);

  const files = useMemo(
    () =>
      severityFilter
        ? allFiles.filter((f) => validations[f.id]?.severity === severityFilter)
        : allFiles,
    [allFiles, validations, severityFilter],
  );
  const displayedFiles = files.filter(file => !isMissingRemovalPending(file.id));
  const removeDisabled = isAnyMissingRemovalPending();

  const row = showTags ? ROW_TAGGED : ROW;
  const virtualizer = useVirtualizer({
    count: displayedFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => row,
    overscan: 12,
  });

  useEffect(() => {
    if (active < displayedFiles.length) virtualizer.scrollToIndex(active, { align: 'auto' });
  }, [active, displayedFiles.length, virtualizer]);

  useEffect(() => {
    if (active >= displayedFiles.length && displayedFiles.length > 0) setActive(displayedFiles.length - 1);
  }, [displayedFiles.length, active]);

  useEffect(() => {
    const pending = removalFocus.current;
    if (!pending) return;
    if (displayedFiles.some(file => file.id === pending.removedId)) return;
    if (pending.fileId) previewButtons.current.get(pending.fileId)?.focus();
    else if (pending.fallback) onEmptyRemovalFocus?.();
    removalFocus.current = null;
  }, [displayedFiles, onEmptyRemovalFocus]);

  function removeOriginalAndRestoreFocus(file: FileEntry, index: number): void {
    const next = displayedFiles[index + 1] ?? displayedFiles[index - 1];
    const nextIndex = index + 1 < displayedFiles.length ? index : index - 1;
    removalFocus.current = { removedId: file.id, fileId: next?.id, fallback: !next };
    if (next) setActive(Math.max(0, nextIndex));
    void removeMissingOriginal(file.id).catch(() => {
      // Before the intent is durable the row remains present; leave focus on
      // its Remove control so the user can retry without hunting for it.
      if (!isMissingRemovalPending(file.id)) removalFocus.current = null;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (previewId || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && displayedFiles[active]) { e.preventDefault(); openPreview(displayedFiles[active].id); }
    else if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, displayedFiles.length - 1));
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'd' && displayedFiles.length > 0 && !removeDisabled) {
      e.preventDefault();
      const activeFile = displayedFiles[active];
      if (activeFile.needsOriginal) removeOriginalAndRestoreFocus(activeFile, active);
      else removeFile(activeFile.id);
    }
  }

  return (
    <div className="border border-rule bg-panel">
      {preview && <InspectPreview key={preview.id} entry={preview} onClose={() => setPreviewId(null)} opener={opener.current} fallback={parentRef.current} />}
      <p className="px-3 py-2 text-[12px] text-inkSoft">Select a thumbnail to preview, double-click a file, or press Enter in the file list.</p>
      <div className="overflow-x-auto">
        <div
          className={`grid ${COLS} items-center gap-3 px-3 h-9 border-b border-rule font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft`}
        >
          <span aria-hidden />
          <span>File</span>
          <span className="hidden sm:block">Timestamp</span>
          <span className="hidden sm:block text-right">Pixels</span>
          <span className="hidden sm:block text-right">Size</span>
          <span>Status</span>
        </div>

        <div
          ref={parentRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="Scanned files. Enter previews, J and K move, D removes the active file."
          className="h-[60dvh] overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2"
        >
          {displayedFiles.length === 0 && severityFilter && (
            <p className="px-3 py-3 font-body text-[13px] text-inkMute">
              No files match this filter.
            </p>
          )}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const f = displayedFiles[vi.index];
              return (
                <div
                  key={f.id}
                  className="absolute left-0 right-0"
                  style={{ height: row, transform: `translateY(${vi.start}px)` }}
                >
                  <Row
                    entry={f}
                    validation={validations[f.id]}
                    showTags={showTags}
                    active={vi.index === active}
                    estimates={estimates}
                    timeZone={timeZone}
                    onSelect={() => setActive(vi.index)}
                    previewButtonRef={(element) => {
                      if (element) previewButtons.current.set(f.id, element);
                      else previewButtons.current.delete(f.id);
                    }}
                    removeDisabled={removeDisabled}
                    onRemove={() => f.needsOriginal ? removeOriginalAndRestoreFocus(f, vi.index) : removeFile(f.id)}
                    onPreview={() => openPreview(f.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
