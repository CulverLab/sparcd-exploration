import { useMemo, useState } from 'react';
import { fmtN } from '@/lib/format';
import { datesOffered, enterDate, toggleYear } from '@/lib/months';
import { inViewOf, useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow, useWithout } from './shared';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A month field. A year typed digit by digit reads 0002, then 0020: it stays
 * in the field until it is a whole month, so a From after To only swaps on
 * what was meant.
 */
function MonthField({ label, value, min, max, onEnter }: { label: string; value: string; min?: string; max?: string; onEnter: (month: string) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <label>
      {label}
      <input
        className="field"
        type="month"
        min={min}
        max={max}
        value={typing ?? value}
        onChange={(e) => {
          const month = e.target.value;
          if (month && !/^[1-9]\d{3}-\d{2}$/.test(month)) return setTyping(month);
          setTyping(null);
          onEnter(month);
        }}
        onBlur={() => setTyping(null)}
      />
    </label>
  );
}

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
  if (!model.dateSpan) return <p className="fine">No photo in these collections has a readable date.</p>;
  const { years: offered, min, max } = datesOffered(inViewOf(model, filters).dates, filters);
  const years: number[] = [];
  for (let y = Number(model.dateSpan.first.slice(0, 4)); y <= Number(model.dateSpan.last.slice(0, 4)); y++) years.push(y);
  return (
    <>
      <div className="sect">
        <h2 className="pk-title">Dates</h2>
      </div>
      <div className="sect">
        <h3>Years</h3>
        {offered.length === 0 && <p className="fine">No dated photos in view.</p>}
        {/* Every year keeps its place; one with no photos under the other filters can't be picked. */}
        <div className="yearchips" role="group" aria-label="Years">
          {years.map((y) => {
            const [photos, untagged] = perYear.get(y) ?? [0, 0];
            return (
              <button
                key={y}
                type="button"
                aria-pressed={filters.years.includes(y)}
                disabled={!offered.includes(y)}
                onClick={() => setFilters((f) => toggleYear(f, y))}
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
          <MonthField label="From" min={min} max={max} value={filters.dateFrom?.slice(0, 7) ?? ''} onEnter={(month) => setFilters((f) => enterDate(f, 'from', month))} />
          <MonthField label="To" min={min} max={max} value={filters.dateTo?.slice(0, 7) ?? ''} onEnter={(month) => setFilters((f) => enterDate(f, 'to', month))} />
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
