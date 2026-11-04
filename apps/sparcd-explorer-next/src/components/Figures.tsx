import { useMemo } from 'react';
import { NO_FILTERS, applyFilters, summarize } from '@/data';
import { fmtN, monthName } from '@/lib/format';
import { useView } from '@/lib/useView';

const span = (a: string | null, b: string | null) => (a && b ? (monthName(a) === monthName(b) ? monthName(a) : `${monthName(a)} – ${monthName(b)}`) : '—');

/** What the filters leave, in four large figures, each "of" the unfiltered total while a filter is on. */
export function Figures() {
  const { model, filters, result, grouping, active } = useView();
  const sum = useMemo(() => summarize(model, result, grouping), [model, result, grouping]);
  const hideMissing = filters.missing === 'hide';
  const total = useMemo(
    () => summarize(model, applyFilters(model, { ...NO_FILTERS, missing: hideMissing ? 'hide' : 'show' }), grouping),
    [model, hideMissing, grouping],
  );
  const of = (v: string) => (active ? `of ${v}` : '');
  const pct = sum.photos ? Math.round((sum.tagged / sum.photos) * 100) : 0;
  const figs: [string, string, string, string][] = [
    ['ph', 'Photos', fmtN(sum.photos), [`${pct}% tagged`, of(fmtN(result.total))].filter(Boolean).join(' · ')],
    ['sp', 'Species', fmtN(sum.species), of(fmtN(total.species))],
    ['lo', 'Locations', fmtN(sum.locations), of(fmtN(total.locations))],
    ['da', 'Dates', span(sum.firstDate, sum.lastDate), of(span(total.firstDate, total.lastDate))],
  ];
  return (
    <section id="figures" aria-label="What the filters leave">
      <div className="summary">
        {figs.map(([k, label, v, o]) => (
          <div key={k} className={`fig ${k}`}>
            <span className="v">{v}</span>
            <span className="k">{label}</span>
            <span className="of">{o}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
