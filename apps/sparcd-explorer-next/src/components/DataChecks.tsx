import { useMemo, useState, type RefObject } from 'react';
import { NO_FILTERS, dataChecks, onlyLocations } from '@/data';
import { describeCheck, type CheckTarget } from '@/lib/checkText';
import { checkForUploads } from '@/lib/opening';
import { useStore } from '@/store';
import { Popover } from './Popover';

export function useDataChecks() {
  const model = useStore((s) => s.model)!;
  return useMemo(() => dataChecks(model).map((c) => describeCheck(model, c)), [model]);
}

/** Show what a check is about: its locations alone, with Undo. */
export function useShowTarget() {
  const model = useStore((s) => s.model)!;
  const withUndo = useStore((s) => s.withUndo);
  return (t: CheckTarget) => {
    withUndo(t.message, (s) => ({
      filters: { ...NO_FILTERS, locations: onlyLocations(model, t.locations), photoTag: t.view === 'photos' ? 'all' : s.filters.photoTag },
      separate: t.separate ?? s.separate,
      view: t.view ?? s.view,
    }));
    document.getElementById('table')?.scrollIntoView({ block: 'start' });
  };
}

export function DataChecksPanel({ anchor, onClose }: { anchor: RefObject<HTMLElement>; onClose: (refocus: boolean) => void }) {
  const checks = useDataChecks();
  const separate = useStore((s) => s.separate);
  const setSeparate = useStore((s) => s.setSeparate);
  const show = useShowTarget();
  const [listed, setListed] = useState<number | null>(null);
  return (
    <Popover anchor={anchor} label="Data checks" onClose={onClose}>
      <div className="sect">
        <h3>Data checks</h3>
        {checks.length ? (
          <ul className="dqlist">
            {checks.map((c, i) => (
              <li key={i}>
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
      </div>
    </Popover>
  );
}
