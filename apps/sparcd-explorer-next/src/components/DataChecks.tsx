import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { dataChecks, onlyLocations, resetFilters } from '@/data';
import { describeCheck, type CheckTarget } from '@/lib/checkText';
import { clockNote } from '@/lib/openingText';
import { checkFiles, checkForUploads } from '@/lib/opening';
import { useStore } from '@/store';
import { Popover } from './Popover';

export function useDataChecks() {
  const model = useStore((s) => s.model)!;
  const unchecked = useStore((s) => s.filesUnchecked);
  return useMemo(() => dataChecks(model, unchecked).map((c) => describeCheck(model, c)), [model, unchecked]);
}

/** Show what a check is about: its locations alone, with Undo. */
export function useShowTarget() {
  const model = useStore((s) => s.model)!;
  const withUndo = useStore((s) => s.withUndo);
  return (t: CheckTarget) => {
    withUndo(t.message, (s) => {
      const clear = resetFilters(s.filters).state;
      return {
        filters: { ...clear, locations: onlyLocations(model, t.locations), photoTag: t.view === 'photos' ? 'all' : clear.photoTag },
        separate: t.separate ?? s.separate,
        view: t.view ?? s.view,
      };
    });
    document.getElementById('table')?.scrollIntoView({ block: 'start' });
  };
}

/** Show the photos whose files are missing, alone, in Photos, with Undo. */
export function useShowMissing() {
  const withUndo = useStore((s) => s.withUndo);
  return () => {
    withUndo('Showing photos whose files are missing', (s) => ({
      ...s,
      filters: { ...resetFilters(s.filters).state, missing: 'only', photoTag: 'all' },
      view: 'photos',
    }));
    document.getElementById('table')?.scrollIntoView({ block: 'start' });
  };
}

export function DataChecksPanel({
  anchor,
  onClose,
  focus,
}: {
  anchor: RefObject<HTMLElement>;
  onClose: (refocus: boolean) => void;
  /** The check to land on, by its key, as a location's flag asks. */
  focus?: string;
}) {
  const checks = useDataChecks();
  const focused = useRef<HTMLLIElement>(null);
  // After the panel's own first focus: the check asked for, its action in reach.
  useEffect(() => {
    const li = focused.current;
    if (!li) return;
    const box = li.closest<HTMLElement>('.pop');
    if (box) box.scrollTop = Math.max(0, li.offsetTop - box.clientHeight / 3);
    li.querySelector('button')?.focus({ preventScroll: true });
  }, []);
  const separate = useStore((s) => s.separate);
  const setSeparate = useStore((s) => s.setSeparate);
  const missing = useStore((s) => s.filters.missing);
  const setFilters = useStore((s) => s.setFilters);
  const show = useShowTarget();
  const showMissing = useShowMissing();
  const anyMissing = checks.some((c) => c.action.kind === 'missing-files');
  const [listed, setListed] = useState<number | null>(null);
  const clock = clockNote(useStore((s) => s.clockOffset));
  return (
    <Popover anchor={anchor} label="Data checks" onClose={onClose}>
      <div className="sect">
        <h3>Data checks</h3>
        {checks.length ? (
          <ul className="dqlist">
            {checks.map((c, i) => (
              <li key={i} ref={c.key && c.key === focus ? focused : undefined} className={c.key && c.key === focus ? 'focus' : undefined}>
                <span>{c.text}</span>
                {listed === i && c.details && <span className="mono text-[11.5px]">{c.details.join(', ')}</span>}
                <button
                  type="button"
                  className="btn sm"
                  aria-expanded={c.action.kind === 'list' ? listed === i : undefined}
                  onClick={() => {
                    if (c.action.kind === 'list') return setListed(listed === i ? null : i);
                    onClose(false);
                    if (c.action.kind === 'retry') void checkForUploads();
                    else if (c.action.kind === 'retry-files') void checkFiles();
                    else if (c.action.kind === 'missing-files') showMissing();
                    else show(c.action.target);
                  }}
                >
                  {c.action.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fine">No problems found.</p>
        )}
        {clock && <p className="fine">{clock}</p>}
      </div>
      <div className="sect">
        <div className="row">
          <span id="separate-label" className="text-[13px] font-[500]">
            Show each location ID separately
          </span>
          <div className="flex-1" />
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={separate}
            aria-labelledby="separate-label"
            onClick={() => setSeparate(!separate)}
          />
        </div>
        {anyMissing && (
          <div className="row">
            <span id="missing-label" className="text-[13px] font-[500]">
              Include photos whose files are missing
            </span>
            <div className="flex-1" />
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={missing !== 'hide'}
              aria-labelledby="missing-label"
              onClick={() => setFilters((f) => ({ ...f, missing: f.missing === 'hide' ? 'show' : 'hide' }))}
            />
          </div>
        )}
      </div>
    </Popover>
  );
}
