import { useState } from 'react';
import { isNeutral, type Adjustments } from '../lib/adjustments';

const FIELDS: { key: keyof Adjustments; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'hue', label: 'Hue' },
  { key: 'saturation', label: 'Saturation' },
];

export function ImageAdjustments({
  value,
  onChange,
  onReset,
  containerHovered = false,
}: {
  value: Adjustments;
  onChange: (next: Adjustments) => void;
  onReset: () => void;
  containerHovered?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const neutral = isNeutral(value);
  const ctrlBg = containerHovered || open ? 'bg-gray-200/40' : 'bg-transparent';

  return (
    <div className="flex flex-col items-start gap-2">
      {open && (
        <div className="w-56 bg-paperHover border border-rule shadow-sm p-3 flex flex-col gap-2.5">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="flex items-center justify-between">
                <span className="uppercase tracking-[0.16em] text-[11px] text-inkSoft">
                  {f.label}
                </span>
                <span className="font-mono text-[11px] text-inkMute">{value[f.key]}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={value[f.key]}
                onChange={(e) => onChange({ ...value, [f.key]: Number(e.target.value) })}
                className="w-full accent-accent py-2 sm:py-0"
                aria-label={f.label}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={onReset}
            disabled={neutral}
            className="self-end text-[12px] font-mono border border-rule px-3 py-2.5 min-h-[44px] sm:px-2 sm:py-0.5 sm:min-h-0 text-inkSoft hover:text-ink hover:border-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Reset
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        className={`text-[12px] font-mono border border-rule ${ctrlBg} px-3 py-2.5 min-h-[44px] sm:px-2 sm:py-0.5 sm:min-h-0 text-inkSoft hover:text-ink hover:border-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        title="View-only image adjustments (does not change the file)"
      >
        Adjust {open ? '▴' : '▾'}
        {!neutral && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-accent align-middle" />}
      </button>
    </div>
  );
}
