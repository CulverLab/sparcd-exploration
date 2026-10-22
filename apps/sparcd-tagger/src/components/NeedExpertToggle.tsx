import { useId } from 'react';

/** Shared Overview/Focus action. The question mark remains legible without color. */
export function NeedExpertToggle({ pressed, disabled, onClick, selectionCount = 0, nextState, align = 'left' }: {
  pressed: boolean | 'mixed';
  disabled: boolean;
  onClick: () => void;
  selectionCount?: number;
  nextState?: boolean;
  align?: 'left' | 'right';
}) {
  const id = useId();
  return (
    <span className="relative inline-flex shrink-0 group">
      <button
        type="button"
        data-need-expert-toggle
        aria-label="Toggle needing an expert's opinion"
        aria-describedby={`${id}-tip${selectionCount ? ` ${id}-selection` : ''}`}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={`min-h-11 min-w-11 grid place-items-center rounded border font-mono text-[17px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
          pressed === true
            ? 'border-warn bg-warn/15 text-warn'
            : pressed === 'mixed'
              ? 'border-accent bg-mark text-ink'
              : 'border-rule text-inkSoft hover:border-ink hover:text-ink'
        }`}
      >
        <span aria-hidden="true">{pressed === 'mixed' ? '±?' : '?'}</span>
      </button>
      <span
        id={`${id}-tip`}
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-[110] mt-1 w-max max-w-[calc(100vw-1rem)] border border-rule bg-panel px-2 py-1 text-[11px] font-mono text-ink shadow-lg group-hover:visible group-focus-within:visible ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        Toggle needing an expert's opinion
      </span>
      {selectionCount > 0 && (
        <span id={`${id}-selection`} className="sr-only">
          Applies to {selectionCount} selected {selectionCount === 1 ? 'image' : 'images'}.
          {pressed === 'mixed' ? ' Selected statuses are mixed.' : ''}
          {' '}Activating will {nextState ? 'mark' : 'clear'} all selected images, based on the focused image's current status.
        </span>
      )}
    </span>
  );
}
