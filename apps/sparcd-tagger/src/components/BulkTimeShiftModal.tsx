// Selection time-shift modal. Applies a signed y/mo/d/h/m/s delta to a snapshotted
// selection, relative to the time each image shows now. It does NOT introduce a
// new correction input: on apply, each selected image's new absolute
// corrected timestamp is frozen into its per-image `timeOverride`, so resolution
// and sync stay byte-identical to a hand-edited per-image override. The preview
// anchors on the earliest-selected image; the same delta is applied uniformly.

import { useEffect, useRef, useState } from 'react';
import { shiftTimestamp } from '@sparcd/camtrap';
import type { TimeOffsetRecord } from '../lib/db';
import { ZERO_OFFSET_RECORD, formatOffsetDelta, offsetActive } from '../lib/timeshift';
import { Spinner } from './TimeShiftModal';

type Field = keyof TimeOffsetRecord;

const FIELDS: { key: Field; label: string }[] = [
  { key: 'years', label: 'Year' },
  { key: 'months', label: 'Month' },
  { key: 'days', label: 'Day' },
  { key: 'hours', label: 'Hour' },
  { key: 'minutes', label: 'Min' },
  { key: 'seconds', label: 'Sec' },
];

export function BulkTimeShiftModal({
  count,
  requestedCount,
  anchorTimestamp,
  onApply,
  onClose,
}: {
  count: number;
  requestedCount: number;
  anchorTimestamp: string; // earliest applicable current time, the preview anchor
  onApply: (delta: TimeOffsetRecord) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TimeOffsetRecord>(ZERO_OFFSET_RECORD);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const active = offsetActive(draft);
  const skipped = requestedCount - count;
  const corrected = anchorTimestamp ? shiftTimestamp(anchorTimestamp, draft) : '';

  const bump = (key: Field, by: number) => setDraft((d) => ({ ...d, [key]: d[key] + by }));

  const apply = () => {
    if (!active) return;
    onApply(draft);
    onClose();
  };

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="selection-time-shift-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-[680px] max-h-[90dvh] overflow-y-auto bg-paper border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h2 id="selection-time-shift-title" className="font-display text-[18px] font-[600] text-ink">
            Time shift · selection
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            className="w-11 h-11 grid place-items-center md:w-7 md:h-7 border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          <p className="text-[13px] text-inkSoft font-body max-w-[600px] mb-4">
            Offset only{' '}
            <strong className="text-ink">
              {skipped > 0
                ? `${count.toLocaleString()} of ${requestedCount.toLocaleString()} selected frames`
                : `${count.toLocaleString()} selected frame${count === 1 ? '' : 's'}`}
            </strong>{' '}
            — e.g. one camera in a mixed upload was on the wrong clock. The shift is applied relative
            to each frame's current time and stored as a{' '}
            <strong className="text-ink">per-image correction</strong>; it stacks on top of any
            whole-upload offset already in effect.
          </p>

          <span className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft">
            Offset
          </span>
          <div className="mt-2 flex items-end gap-2 flex-wrap">
            {FIELDS.map((f, i) => (
              <div key={f.key} className="flex items-end gap-2">
                {i === 3 && <span className="self-stretch w-px bg-ruleSoft mx-1" aria-hidden />}
                <Spinner
                  label={f.label}
                  value={draft[f.key]}
                  onUp={() => bump(f.key, 1)}
                  onDown={() => bump(f.key, -1)}
                />
              </div>
            ))}
          </div>

          <div className="mt-5 border border-rule bg-panel px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft">
                Preview · earliest selected
              </span>
              <span
                className={`font-mono text-[11.5px] font-[600] ${active ? 'text-accent' : 'text-inkMute'}`}
              >
                {formatOffsetDelta(draft)}
              </span>
            </div>
            {anchorTimestamp ? (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div>
                  <div className="text-[10px] font-[600] tracking-[0.12em] uppercase text-inkSoft mb-1">
                    Original
                  </div>
                  <div className="font-mono text-[15px] text-inkSoft line-through decoration-rule break-all">
                    {anchorTimestamp}
                  </div>
                </div>
                <div className="text-center font-mono text-[16px] text-accent">→</div>
                <div>
                  <div className="text-[10px] font-[600] tracking-[0.12em] uppercase text-accent mb-1">
                    Corrected
                  </div>
                  <div className="font-mono text-[15px] font-[600] text-ink break-all">{corrected}</div>
                </div>
              </div>
            ) : (
              <div className="font-mono text-[13px] text-inkMute">No timestamped frame to preview.</div>
            )}
          </div>

          <p className="mt-3 font-mono text-[11.5px] text-inkSoft">
            {skipped > 0 && <><span className="text-inkMute">note</span> {skipped.toLocaleString()} selected frame{skipped === 1 ? '' : 's'} without a capture time {skipped === 1 ? 'is' : 'are'} skipped. </>}
            Clear a frame's correction from its Focus view.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-rule px-5 py-3">
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!active}
            className="text-[13px] border border-ink bg-ink text-paper px-3 py-1.5 hover:bg-inkSoft disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {`Apply to ${count.toLocaleString()} selected frame${count === 1 ? '' : 's'} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
