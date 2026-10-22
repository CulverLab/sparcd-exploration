import { useMemo } from 'react';
import { fmtN } from '@/lib/format';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow, toggled, useWithout } from './shared';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export function DatesPicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const without = useWithout('dates');
  const perYear = useMemo(() => {
    const n = new Map<number, [number, number]>();
    for (const i of without.photos) {
      const p = model.photos[i];
      if (p.year === null) continue;
      const c = n.get(p.year) ?? [0, 0];
      c[0]++;
      if (!p.tagged) c[1]++;
      n.set(p.year, c);
    }
    return n;
  }, [model, without]);
  const span = model.dateSpan;
  if (!span) return <p className="fine">No photo in these collections has a readable date.</p>;
  const years: number[] = [];
  for (let y = Number(span.first.slice(0, 4)); y <= Number(span.last.slice(0, 4)); y++) years.push(y);
  const min = span.first.slice(0, 7);
  const max = span.last.slice(0, 7);
  return (
    <>
      <div className="sect">
        <h3>Years</h3>
        <div className="yearchips">
          {years.map((y) => {
            const [photos, untagged] = perYear.get(y) ?? [0, 0];
            return (
              <button
                key={y}
                type="button"
                aria-pressed={filters.years.includes(y)}
                onClick={() => setFilters((f) => ({ ...f, years: toggled(f.years, y, !f.years.includes(y)) }))}
              >
                <b>{y}</b>
                <span>
                  {fmtN(photos)} photos{untagged ? ` · ${fmtN(untagged)} untagged` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="sect">
        <h3>Range</h3>
        <div className="two">
          <label>
            From
            <input
              className="field"
              type="month"
              min={min}
              max={max}
              value={filters.dateFrom?.slice(0, 7) ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value ? `${e.target.value}-01` : null }))}
            />
          </label>
          <label>
            To
            <input
              className="field"
              type="month"
              min={min}
              max={max}
              value={filters.dateTo?.slice(0, 7) ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateTo: e.target.value ? `${e.target.value}-${pad(lastDay(e.target.value))}` : null }))
              }
            />
          </label>
        </div>
      </div>
      {filters.hours && (
        <div className="sect">
          <div className="row fine">
            Hour: {pad(filters.hours[0])}:00 to {pad(filters.hours[1])}:59
            <button type="button" className="linkbtn" onClick={() => setFilters((f) => ({ ...f, hours: null }))}>
              Clear hour
            </button>
          </div>
        </div>
      )}
      <ClearRow
        label="Clear dates"
        onClear={() => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null, years: [], months: [], hours: null }))}
      />
    </>
  );
}
