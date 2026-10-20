import { useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { EMPTY_IMAGE_FILTER, type ImageFilter } from '../lib/imageFilter';

interface Props {
  open: boolean;
  docked: boolean;
  onClose: () => void;
  findRef: RefObject<HTMLInputElement>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  position: number;
  matchCount: number;
  jump: (position: number) => void;
  filter: ImageFilter;
  setFilter: Dispatch<SetStateAction<ImageFilter>>;
  shown: number;
  total: number;
}

// One native dialog stays mounted while its mode changes. showModal makes the
// covered workspace inert; show leaves the rest of Overview keyboard reachable.
export function FindFilterRail({ open, docked, onClose, findRef, query, setQuery,
  position, matchCount, jump, filter, setFilter, shown, total }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const focused = dialog.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    dialog.close();
    if (open) {
      if (docked) dialog.show();
      else dialog.showModal();
      (focused ?? findRef.current)?.focus();
    }
  }, [open, docked, findRef]);

  return <dialog ref={dialogRef} id="image-filter-panel"
    aria-label="Find & filter"
    aria-modal={open && !docked ? true : undefined}
    data-layout={docked ? 'docked' : 'overlay'}
    onCancel={(event) => { event.preventDefault(); if (!docked) onClose(); }}
    onKeyDown={(event) => {
      // Rail keystrokes must not tag or navigate the image behind its controls.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!docked) onClose();
      }
      if (!docked && event.key === 'Tab') {
        const controls = Array.from(dialogRef.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled)'))
          .filter((node) => node.offsetParent !== null &&
            (!(node instanceof HTMLInputElement) || node.type !== 'radio' || node.checked));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}
    className={docked
      ? 'find-filter-rail static m-0 h-full max-h-none w-72 shrink-0 border-0 border-r border-rule bg-panel p-0 text-ink'
      : 'find-filter-rail fixed inset-0 m-auto max-h-[calc(100dvh-1rem)] w-80 max-w-[calc(100%-1rem)] border border-rule bg-panel p-0 text-ink shadow-xl backdrop:bg-black/40'}>
    <div className="max-h-[inherit] h-full overflow-y-auto space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-[14px]">Find &amp; filter</h2>
        <button type="button" onClick={onClose} className="min-h-11 px-2 border border-rule">Close</button>
      </div>
      <label className="block text-[12px] font-mono" htmlFor="find-image">Find image</label>
      <div className="flex w-full items-center gap-1 border border-rule px-1.5 py-0.5">
        <span aria-hidden className="text-[12px] text-inkMute">
          ⌕
        </span>
        <input
          id="find-image" ref={findRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              jump(position + (e.shiftKey ? -1 : 1));
            }
          }}
          aria-label="Find image"
          placeholder="Find image…"
          className="min-w-0 w-full bg-transparent text-[12px] font-mono text-ink placeholder:text-inkMute focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title="Find image by filename (Enter / Shift+Enter to cycle, / to focus)"
        />
        {query.trim() && (
          <>
            <span
              className={`text-[11px] font-mono ${matchCount ? 'text-accent' : 'text-warn'}`}
            >
              {matchCount ? position + 1 : 0}/{matchCount}
            </span>
            <button
              onClick={() => jump(position - 1)}
              disabled={!matchCount}
              className="text-[12px] text-inkSoft hover:text-ink disabled:opacity-40 px-0.5 min-h-11 min-w-11"
              title="Previous match"
              aria-label="Previous match"
            >
              ‹
            </button>
            <button
              onClick={() => jump(position + 1)}
              disabled={!matchCount}
              className="text-[12px] text-inkSoft hover:text-ink disabled:opacity-40 px-0.5 min-h-11 min-w-11"
              title="Next match"
              aria-label="Next match"
            >
              ›
            </button>
            <button
              onClick={() => {
                setQuery('');
                findRef.current?.focus();
              }}
              className="text-[12px] text-inkMute hover:text-ink px-0.5 min-h-11 min-w-11"
              title="Clear"
              aria-label="Clear image search"
            >
              ✕
            </button>
          </>
        )}
      </div>

      <p className="text-[12px] text-inkSoft">Find jumps to a filename match without filtering the images.</p>
      <hr className="border-rule" />
      <label className="block text-[11px] font-mono text-inkSoft">
        Match text
        <input
          value={filter.text}
          onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
          placeholder="Filename, species, or date"
          className="mt-1 w-full border border-rule bg-paper px-2 py-1 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </label>
      {(['scope', 'tagged'] as const).map((group) => (
        <fieldset key={group} className="space-y-1">
          <legend className="text-[12px] font-mono">{group === 'scope' ? 'Search in' : 'Tag state'}</legend>
          {(group === 'scope'
            ? [['all', 'All fields'], ['filename', 'Filename'], ['species', 'Species'], ['date', 'Date']]
            : [['all', 'All images'], ['tagged', 'Tagged only'], ['untagged', 'Untagged only']]
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-9 items-center gap-2 text-[13px]">
              <input type="radio" name={`image-filter-${group}`} value={value}
                checked={filter[group] === value}
                onChange={() => setFilter((f) => ({ ...f, [group]: value }))} />
              {label}
            </label>
          ))}
        </fieldset>
      ))}
      <fieldset>
        <legend className="text-[11px] font-mono text-inkSoft">Capture date</legend>
        <div className="mt-1 grid grid-cols-5 gap-1">
          {(['year', 'month', 'day', 'hour', 'minute'] as const).map((part) => (
            <input
              key={part}
              aria-label={`Capture ${part}`}
              value={filter[part]}
              onChange={(e) =>
                setFilter((f) => ({ ...f, [part]: e.target.value }))
              }
              placeholder={{ year: 'YYYY', month: 'MM', day: 'DD', hour: 'HH', minute: 'MM' }[part]}
              inputMode="numeric"
              className="min-w-0 border border-rule bg-paper px-1 py-1 text-[12px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          ))}
        </div>
      </fieldset>

      <p role="status" aria-live="polite" className="text-[12px] font-mono">Showing {shown} of {total} images</p>
      <button type="button" onClick={() => setFilter(EMPTY_IMAGE_FILTER)} className="min-h-11 px-2 border border-rule">Reset filter</button>
    </div>
  </dialog>;
}
