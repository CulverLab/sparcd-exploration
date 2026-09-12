// Upload-level time-shift modal (design §08). Edits the signed y/mo/d/h/m/s
// offset applied to every image in the upload, with a live original→corrected
// preview. Non-destructive: the original EXIF/`media.csv` timestamps are never
// rewritten locally; the offset is stored on the `uploads` record and only
// emitted into `media.csv` col 4 at sync. The date math is `@sparcd/camtrap`'s
// Java-matching `shiftTimestamp`.

import { useState } from 'react';
import { shiftTimestamp } from '@sparcd/camtrap';
import type { TimeOffsetRecord } from '../lib/db';
import { ZERO_OFFSET_RECORD, formatOffsetDelta, offsetActive } from '../lib/timeshift';
import { formatDateTime } from '../lib/formatting';
import { useStore } from '../store';

type Field = keyof TimeOffsetRecord;

const FIELDS: { key: Field; label: string }[] = [
  { key: 'years', label: 'Year' },
  { key: 'months', label: 'Month' },
  { key: 'days', label: 'Day' },
  { key: 'hours', label: 'Hour' },
  { key: 'minutes', label: 'Min' },
  { key: 'seconds', label: 'Sec' },
];

export function TimeShiftModal({
  offset,
  sampleTimestamp,
  totalFrames,
  onApply,
  onClose,
}: {
  offset: TimeOffsetRecord | null;
  sampleTimestamp: string; // a representative base capture time for the preview
  totalFrames: number;
  onApply: (offset: TimeOffsetRecord | null) => void;
  onClose: () => void;
}) {
  const dateFormat = useStore((s) => s.dateFormat);
  const timeFormat = useStore((s) => s.timeFormat);
  const [draft, setDraft] = useState<TimeOffsetRecord>(offset ?? ZERO_OFFSET_RECORD);
  const active = offsetActive(draft);
  const corrected = sampleTimestamp ? shiftTimestamp(sampleTimestamp, draft) : '';

  const bump = (key: Field, by: number) => setDraft((d) => ({ ...d, [key]: d[key] + by }));

  const apply = () => {
    onApply(active ? draft : null); // applying a zero offset clears it
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Time shift"
    >
      <div
        className="w-full max-w-[680px] max-h-[90dvh] overflow-y-auto bg-paper border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h2 className="font-display text-[18px] font-[600] text-ink">Time shift · whole upload</h2>
          <button
            onClick={onClose}
            className="w-11 h-11 grid place-items-center md:w-7 md:h-7 border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          <p className="text-[13px] text-inkSoft font-body max-w-[600px] mb-4">
            Camera clocks drift — wrong timezone, DST, dead RTC battery. Shift every frame in this
            upload by a signed offset. This is a{' '}
            <strong className="text-ink">non-destructive correction</strong>: the original capture
            time is preserved; the shift is stored alongside it and drives the displayed and synced
            time.
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

          {/* live before → after preview */}
          <div className="mt-5 border border-rule bg-panel px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft">
                Preview
              </span>
              <span
                className={`font-mono text-[11.5px] font-[600] ${active ? 'text-accent' : 'text-inkMute'}`}
              >
                {formatOffsetDelta(draft)}
              </span>
            </div>
            {sampleTimestamp ? (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div>
                  <div className="text-[10px] font-[600] tracking-[0.12em] uppercase text-inkSoft mb-1">
                    Original
                  </div>
                  <div className="font-mono text-[15px] text-inkSoft line-through decoration-rule break-all">
                    {formatDateTime(sampleTimestamp, dateFormat, timeFormat)}
                  </div>
                </div>
                <div className="text-center font-mono text-[16px] text-accent">→</div>
                <div>
                  <div className="text-[10px] font-[600] tracking-[0.12em] uppercase text-accent mb-1">
                    Corrected
                  </div>
                  <div className="font-mono text-[15px] font-[600] text-ink break-all">
                    {formatDateTime(corrected, dateFormat, timeFormat)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="font-mono text-[13px] text-inkMute">
                No sample timestamp on this upload to preview.
              </div>
            )}
          </div>

          <p className="mt-3 font-mono text-[11.5px] text-inkSoft">
            <span className="text-inkMute">note</span> Per-image overrides set in Focus stack on top
            of this upload offset.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-rule px-5 py-3">
          <button
            onClick={() => setDraft(ZERO_OFFSET_RECORD)}
            disabled={!active}
            className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Clear shift
          </button>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="text-[13px] border border-ink bg-ink text-paper px-3 py-1.5 hover:bg-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Apply to all {totalFrames.toLocaleString()} frames →
          </button>
        </div>
      </div>
    </div>
  );
}

export function Spinner({
  label,
  value,
  onUp,
  onDown,
}: {
  label: string;
  value: number;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-body text-[10px] font-[600] tracking-[0.1em] uppercase text-inkSoft">
        {label}
      </span>
      <div className="flex flex-col border border-ink">
        <button
          onClick={onUp}
          aria-label={`Increase ${label}`}
          className="w-[52px] h-11 md:h-6 border-b border-rule font-mono text-[11px] text-inkSoft hover:bg-panelHover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent -outline-offset-1"
        >
          ▲
        </button>
        <span
          className={`w-[52px] h-8 grid place-items-center font-mono text-[15px] font-[600] ${
            value !== 0 ? 'bg-mark text-ink' : 'text-inkMute'
          }`}
        >
          {value > 0 ? `+${value}` : value}
        </span>
        <button
          onClick={onDown}
          aria-label={`Decrease ${label}`}
          className="w-[52px] h-11 md:h-6 border-t border-rule font-mono text-[11px] text-inkSoft hover:bg-panelHover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent -outline-offset-1"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
