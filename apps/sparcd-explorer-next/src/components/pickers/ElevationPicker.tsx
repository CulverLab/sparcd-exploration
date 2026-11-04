import { elevationSpan, noElevationLocations } from '@/lib/filterLabels';
import { formatElevation, plural } from '@/lib/format';
import { inViewOf, useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow } from './shared';

const STEP = 50;

export function ElevationPicker() {
  const { model, filters, grouping } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const unit = useStore((s) => s.display.elevation);
  const inSites = inViewOf(model, filters).sites.elevation;
  const span = elevationSpan(model, inSites, filters.elevation);
  if (!span) return <p className="fine">No location in view has an elevation.</p>;
  const [lo, hi] = span;
  const [a, b] = filters.elevation ?? span;
  const set = (x: number, y: number) => {
    const [from, to] = x <= y ? [x, y] : [y, x];
    setFilters((f) => ({ ...f, elevation: from <= lo && to >= hi ? null : [from, to] }));
  };
  const leftOut = filters.elevation ? noElevationLocations(model, inSites, grouping.separate) : 0;
  return (
    <>
      <div className="sect">
        <h2 className="pk-title">Elevation</h2>
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
        {leftOut > 0 && <p className="fine">{plural(leftOut, 'location')} with no elevation left out</p>}
      </div>
      <ClearRow onClear={() => setFilters((f) => ({ ...f, elevation: null }))} />
    </>
  );
}
