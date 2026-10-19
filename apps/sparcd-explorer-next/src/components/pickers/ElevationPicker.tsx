import { formatElevation } from '@/lib/format';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow } from './shared';

const STEP = 50;

export function ElevationPicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const unit = useStore((s) => s.display.elevation);
  const known = model.sites.flatMap((s) => (s.elevation === null ? [] : [s.elevation]));
  if (!known.length) return <p className="fine">No location in these collections has an elevation.</p>;
  const lo = Math.floor(Math.min(...known) / STEP) * STEP;
  const hi = Math.ceil(Math.max(...known) / STEP) * STEP;
  const [a, b] = filters.elevation ?? [lo, hi];
  const set = (x: number, y: number) => {
    const [from, to] = x <= y ? [x, y] : [y, x];
    setFilters((f) => ({ ...f, elevation: from <= lo && to >= hi ? null : [from, to] }));
  };
  return (
    <>
      <div className="sect">
        <h3>Elevation</h3>
        <label htmlFor="elev-lo" className="row justify-between">
          <span>Lowest</span>
          <span className="mono">{formatElevation(a, unit)}</span>
        </label>
        <input id="elev-lo" type="range" className="accent-accent" min={lo} max={hi} step={STEP} value={a} onChange={(e) => set(Number(e.target.value), b)} />
        <label htmlFor="elev-hi" className="row justify-between">
          <span>Highest</span>
          <span className="mono">{formatElevation(b, unit)}</span>
        </label>
        <input id="elev-hi" type="range" className="accent-accent" min={lo} max={hi} step={STEP} value={b} onChange={(e) => set(a, Number(e.target.value))} />
        <p className="fine">
          Spans {formatElevation(lo, unit)} to {formatElevation(hi, unit)}
        </p>
      </div>
      <ClearRow onClear={() => setFilters((f) => ({ ...f, elevation: null }))} />
    </>
  );
}
