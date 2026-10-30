import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NO_FILTERS, applyFilters, summarize, toggleCollection, type FilterResult, type Model } from '@/data';
import { fmtN, monthName, plural } from '@/lib/format';
import { ACTIVE_DAYS_HELP } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { Popover, usePopover } from './Popover';
import { SelClear } from './SelClear';
import { useCollectionCounts } from './pickers/CollectionsPicker';

type Counts = { photos: number; locations: Set<string> }[];

function countsOf(model: Model, result: FilterResult, separate: boolean): Counts {
  const counts = model.collections.map(() => ({ photos: 0, locations: new Set<string>() }));
  for (const i of result.photos) {
    const p = model.photos[i];
    const site = model.sites[p.site];
    counts[p.collection].photos++;
    counts[p.collection].locations.add(separate ? site.key : site.groupKey);
  }
  return counts;
}

const countText = (c: Counts[number]) => `${plural(c.photos, 'photo')} · ${plural(c.locations.size, 'location')}`;

type Mode = 'line' | 'column' | 'phone';

/**
 * Each collection's name filters to it, with its counts. As many as fit on
 * the line, or two beside the figures on short screens, then "+ N more" for
 * the full list. How many is worked out from the unfiltered counts, on load
 * and when the band's width changes, so filtering never changes it.
 */
function ByCollection() {
  const { model, filters, grouping } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const clear = useStore((s) => s.clearFilter);
  const counts = useCollectionCounts();
  const { hidden } = filters.collections;
  const el = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const pop = usePopover();
  const n = model.collections.length;
  const [fit, setFit] = useState<{ mode: Mode; shown: number }>({ mode: 'line', shown: Math.min(2, n) });
  // The largest counts each collection can show: every photo, missing files included.
  const widest = useMemo(() => countsOf(model, applyFilters(model, { ...NO_FILTERS, missing: 'show' }), grouping.separate), [model, grouping]);

  useLayoutEffect(() => {
    const box = el.current!;
    const work = () => {
      const mode: Mode = innerWidth < 760 ? 'phone' : getComputedStyle(box).display === 'grid' ? 'column' : 'line';
      let shown = mode === 'phone' && n > 2 ? 1 : Math.min(2, n);
      if (mode === 'line') {
        const m = measure.current!;
        const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
        const widths = [...m.children].map((x) => x.getBoundingClientRect().width);
        // The label, each name with its counts, then "+ N more" and × Clear.
        let used = widths[0] + gap + widths[n + 2];
        shown = 0;
        for (let i = 0; i < n; i++) {
          used += widths[i + 1] + gap;
          if (used + (i + 1 < n ? widths[n + 1] + gap : 0) > box.clientWidth + 0.5) break;
          shown = i + 1;
        }
      }
      setFit((f) => (f.mode === mode && f.shown === shown ? f : { mode, shown }));
    };
    work();
    const observer = new ResizeObserver(work);
    observer.observe(box);
    return () => observer.disconnect();
  }, [model, widest, n]);

  const pick = (key: string) => setFilters((f) => toggleCollection(model, f, key));
  const isOn = (key: string) => hidden.length > 0 && !hidden.includes(key);
  const clearButton = (
    <SelClear
      className="inline"
      style={{ visibility: hidden.length ? 'visible' : 'hidden' }}
      label="Clear collection selection"
      onClick={() => {
        el.current?.querySelector<HTMLElement>('.bc-item button')?.focus({ preventScroll: true });
        clear('collections');
      }}
    />
  );
  const shown = Math.min(fit.shown, n);
  const items = model.collections.slice(0, shown).map((c, i) => (
    <span key={c.key} className={isOn(c.key) ? 'bc-item on' : 'bc-item'}>
      <button type="button" className="linkbtn" aria-pressed={isOn(c.key)} onClick={() => pick(c.key)}>
        {c.name}
      </button>
      <span className="bc-n">{countText(counts[i])}</span>
    </span>
  ));
  const more =
    shown < n ? (
      <button ref={pop.anchor} type="button" className="bc-more" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>
        + {n - shown} more
      </button>
    ) : null;
  const label = <span className="bc-k">By collection</span>;
  return (
    <div ref={el} className="bycoll" role="group" aria-label="By collection">
      {fit.mode === 'column' ? (
        <>
          {label}
          {more}
          {clearButton}
          {items}
        </>
      ) : fit.mode === 'phone' ? (
        <>
          {label}
          {clearButton}
          {items}
          {more}
        </>
      ) : (
        <>
          {label}
          {items}
          {more}
          {clearButton}
        </>
      )}
      <div ref={measure} className="bycoll measure" aria-hidden="true">
        {label}
        {model.collections.map((c, i) => (
          <span key={c.key} className="bc-item on">
            <span className="linkbtn">{c.name}</span>
            <span className="bc-n">{countText(widest[i])}</span>
          </span>
        ))}
        <span className="bc-more">+ {n} more</span>
        <span className="selclear inline">
          <b>×</b>Clear
        </span>
      </div>
      {pop.open && (
        <Popover anchor={pop.anchor} label="By collection" className="bcpop" onClose={pop.close}>
          <div className="bcpop-head">
            <h3>By collection</h3>
            <SelClear
              className="inline"
              style={{ visibility: hidden.length ? 'visible' : 'hidden' }}
              label="Clear collection selection"
              onClick={() => clear('collections')}
            />
          </div>
          <ul className="bclist">
            {model.collections.map((c, i) => (
              <li key={c.key} className={isOn(c.key) ? 'on' : undefined}>
                <button type="button" className="linkbtn" aria-pressed={isOn(c.key)} onClick={() => pick(c.key)}>
                  {c.name}
                </button>
                <span className="bc-n">{countText(counts[i])}</span>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  );
}

const span = (a: string | null, b: string | null) => (a && b ? (monthName(a) === monthName(b) ? monthName(a) : `${monthName(a)} – ${monthName(b)}`) : '—');

/** What the filters leave, in large figures, each "of" the unfiltered total while a filter is on. */
export function Figures() {
  const { model, filters, result, grouping, multi, active } = useView();
  const sum = useMemo(() => summarize(model, result, grouping), [model, result, grouping]);
  const hideMissing = filters.missing === 'hide';
  const total = useMemo(
    () => summarize(model, applyFilters(model, { ...NO_FILTERS, missing: hideMissing ? 'hide' : 'show' }), grouping),
    [model, hideMissing, grouping],
  );
  const of = (v: string) => (active ? `of ${v}` : '');
  const pct = sum.photos ? Math.round((sum.tagged / sum.photos) * 100) : 0;
  const figs: [string, string, string, string][] = [
    ['ph', 'Photos', fmtN(sum.photos), of(fmtN(result.total))],
    ['de', 'Detections', fmtN(sum.detections), of(fmtN(total.detections))],
    ['an', 'Animals counted', fmtN(sum.animals), of(fmtN(total.animals))],
    ['sp', 'Species', fmtN(sum.species), of(fmtN(total.species))],
    ['lo', 'Locations', fmtN(sum.locations), of(fmtN(total.locations))],
    ['ad', 'Active days', fmtN(sum.activeDays), of(fmtN(total.activeDays))],
    ['da', 'Dates', span(sum.firstDate, sum.lastDate), of(span(total.firstDate, total.lastDate))],
  ];
  return (
    <section className="summary" id="figures" aria-label="What the filters leave">
      {figs.map(([k, label, v, o]) => (
        <div key={k} className={`fig ${k}`}>
          <span className="v" title={k === 'da' && sum.firstDate ? `${sum.firstDate} to ${sum.lastDate}` : undefined}>
            {v}
          </span>
          <span className="k">
            {label}
            {k === 'ad' && (
              <span className="qmark" tabIndex={0} aria-describedby="ad-help">
                ?
                <span className="qtip" id="ad-help" role="tooltip">
                  {ACTIVE_DAYS_HELP}
                </span>
              </span>
            )}
          </span>
          {k === 'ph' && <span className="of">{pct}% tagged</span>}
          <span className="of" title={o || undefined}>
            {o}
          </span>
        </div>
      ))}
      {multi && <ByCollection />}
    </section>
  );
}
