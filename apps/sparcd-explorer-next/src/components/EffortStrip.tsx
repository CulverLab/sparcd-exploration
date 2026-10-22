import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { activeFilters, applyFilters, clearFilter, photosForTag } from '@/data';
import { matchLegend } from '@/lib/filterLabels';
import { fmtN } from '@/lib/format';
import { axisTicks, barFill, countByMonth, datesToMonths, monthAxis, monthLabel, monthPasses, monthsToDates } from '@/lib/months';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { SelClear } from './SelClear';
import { Tip, type TipAt } from './Tip';

// Geometry of the strip, in pixels: a left gutter for the scale, bars between
// `TOP` and `BASE`, year labels under the axis.
const H = 102;
const X0 = 44;
const TOP = 32;
const BASE = 82;

/**
 * Camera effort per month across the opened data: every filter but Dates,
 * species and the tag switch, so the time context stays in sight while dates
 * are picked. What a species filter or the tag switch keeps is drawn as an
 * inner bar. Drag or click to set Dates; arrows move a cursor and Enter or
 * Space picks.
 */
export function EffortStrip() {
  const { model, filters, result } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const clear = useStore((s) => s.clearFilter);
  const tagShown = useStore((s) => s.view === 'photos');
  const legend = matchLegend(model, filters, tagShown);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [tip, setTip] = useState<TipAt | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current!;
    // The strip's side padding is 10px each way.
    const measure = () => setWidth(el.clientWidth - 20);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const axis = useMemo(() => monthAxis(model), [model]);
  // Without a Dates filter that is the page's own result; with one, the strip's own.
  const dated = activeFilters(filters).includes('dates');
  const effort = useMemo(() => (dated ? applyFilters(model, clearFilter(filters, 'dates')) : result), [dated, model, filters, result]);
  // Switching to Photos changes what the inner bars show only under the Tagged switch.
  const inner = legend ? (tagShown ? filters.photoTag : 'all') : null;
  const counts = useMemo(
    () => countByMonth(model, effort.effort, inner ? photosForTag(model, effort.photos, inner) : []),
    [model, effort, inner],
  );
  const max = Math.max(1, ...[...counts.values()].map((c) => c[0]));
  const range = axis && datesToMonths(filters.dateFrom, filters.dateTo, axis);

  if (!axis) {
    return (
      <section className="panel" aria-label="Camera effort">
        <div className="bandhead">
          <h2>Camera effort</h2>
        </div>
        <div ref={wrap} className="strip">
          <p className="fine">No photo here has a readable date.</p>
        </div>
      </section>
    );
  }

  const W = Math.max(260, width);
  const cw = (W - X0 - 4) / axis.count;
  const last = axis.first + axis.count - 1;
  const xOf = (m: number) => X0 + (m - axis.first) * cw;
  const at = cursor ?? range?.[0] ?? last;

  const monthAt = (clientX: number): number | null => {
    const x = clientX - svg.current!.getBoundingClientRect().left;
    if (x < X0) return null;
    return Math.min(last, Math.max(axis.first, axis.first + Math.floor((x - X0) / cw)));
  };

  const setMonths = (a: number, b: number) =>
    setFilters((f) => ({ ...f, ...monthsToDates(a, b), years: [], months: [] }));
  /** Lets the picked months go, as a second click on one does; "× Clear" clears all of Dates. */
  const clearMonths = () => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }));
  /** A click picks one month; a second click on the same month lets it go. */
  const pick = (m: number) => {
    if (range && range[0] === m && range[1] === m) clearMonths();
    else setMonths(m, m);
  };

  const tipFor = (m: number, x: number, y: number) => {
    const [photos, untagged, match] = counts.get(m) ?? [0, 0, 0];
    setTip({
      x,
      y,
      content: (
        <>
          <b>{monthLabel(m)}</b>
          <table>
            <tbody>
              <tr>
                <td>Photos</td>
                <td className="n">{fmtN(photos)}</td>
              </tr>
              <tr>
                <td>Tagged</td>
                <td className="n">{fmtN(photos - untagged)}</td>
              </tr>
              <tr>
                <td>Untagged</td>
                <td className="n">{fmtN(untagged)}</td>
              </tr>
              {legend && (
                <tr>
                  <td>{legend}</td>
                  <td className="n">{fmtN(match)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ),
    });
  };
  const tipAtCursor = (m: number) => {
    const r = svg.current!.getBoundingClientRect();
    tipFor(m, r.left + xOf(m) + cw / 2, r.top + TOP);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const m = monthAt(e.clientX);
    if (m === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ a: m, b: m });
    setTip(null);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const m = monthAt(e.clientX);
    if (drag) {
      if (m !== null && m !== drag.b) setDrag({ ...drag, b: m });
      return;
    }
    if (m === null) setTip(null);
    else tipFor(m, e.clientX, e.clientY);
  };
  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    setCursor(drag.b);
    setAnchor(null);
    if (drag.a !== drag.b) setMonths(drag.a, drag.b);
    else pick(drag.a);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -12, PageUp: 12 };
    let next: number | null = null;
    if (e.key in step) next = at + step[e.key];
    else if (e.key === 'Home') next = axis.first;
    else if (e.key === 'End') next = last;
    if (next !== null) {
      e.preventDefault();
      next = Math.min(last, Math.max(axis.first, next));
      setCursor(next);
      tipAtCursor(next);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // The first press picks the month and starts a range; a press on
      // another month ends the range there, on the same month lets it go.
      if (anchor === null) {
        setMonths(at, at);
        setAnchor(at);
      } else {
        if (anchor === at) clearMonths();
        else setMonths(anchor, at);
        setAnchor(null);
      }
      setCursor(at);
    } else if (e.key === 'Escape' && anchor !== null) {
      e.preventDefault();
      setAnchor(null);
    }
  };

  const [cp, cu, cm] = counts.get(at) ?? [0, 0, 0];
  const shown = drag ? ([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] as [number, number]) : range;
  const bracketEnd = range && !drag ? xOf(range[1] + 1) : null;
  const clearW = clearRef.current?.offsetWidth ?? 72;

  return (
    <section className="panel" aria-label="Camera effort">
      <div className="bandhead">
        <h2>Camera effort</h2>
        <span className="tl-legend" aria-hidden="true">
          <span>
            <i className="sw ramp" />
            Photos per month
          </span>
          <span>
            <i className="sw untag" />
            Untagged
          </span>
          {legend && (
            <span>
              <i className="sw match" />
              {legend}
            </span>
          )}
        </span>
      </div>
      <div ref={wrap} className="strip">
        <svg
          ref={svg}
          className="effort"
          width={W}
          height={H}
          tabIndex={0}
          role="slider"
          aria-label="Photos per month"
          aria-valuemin={0}
          aria-valuemax={axis.count - 1}
          aria-valuenow={at - axis.first}
          aria-valuetext={`${monthLabel(at)}: ${fmtN(cp)} photos, ${fmtN(cu)} untagged${legend ? `, ${legend} ${fmtN(cm)}` : ''}${
            anchor !== null ? `; range from ${monthLabel(anchor)}` : ''
          }`}
          onPointerDown={onPointerDown}
          // A click never takes focus, so the keyboard cursor shows only for the keyboard.
          onMouseDown={(e) => e.preventDefault()}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => setTip(null)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setAnchor(null);
            setTip(null);
          }}
        >
          <line className="grid" x1={X0} x2={W} y1={TOP + 0.5} y2={TOP + 0.5} />
          <text className="scale" x={X0 - 6} y={TOP + 1}>
            {fmtN(max)}
          </text>
          <text className="scale" x={X0 - 6} y={BASE - 1}>
            0
          </text>
          {[...counts].map(([m, [photos, untagged, match]]) => {
            const h = Math.max(2, ((BASE - TOP) * photos) / max);
            const uh = untagged ? Math.max(2, (h * untagged) / photos) : 0;
            const mh = match ? Math.max(2, ((BASE - TOP) * match) / max) : 0;
            const x = xOf(m) + 0.5;
            const w = Math.max(1, cw - 1);
            // Inside the month's bar, narrower where there is room to show both.
            const mw = w >= 5 ? Math.max(2, Math.round(w * 0.5)) : w;
            return (
              <g key={m} data-month={m} data-match={legend ? match : undefined}>
                <rect x={x} y={BASE - h} width={w} height={h} style={{ fill: barFill(photos, max, Boolean(legend)) }} />
                {uh > 0 && <rect className="untag" x={x} y={BASE - uh} width={w} height={uh} />}
                {mh > 0 && <rect className="match" x={x + (w - mw) / 2} y={BASE - mh} width={mw} height={mh} />}
              </g>
            );
          })}
          {Array.from({ length: axis.count }, (_, i) => axis.first + i)
            .filter((m) => !monthPasses(filters, m, range))
            .map((m) => (
              <rect key={m} className="dim" x={xOf(m)} y={TOP - 2} width={cw} height={BASE - TOP + 2} />
            ))}
          {shown && (
            <g className={drag ? 'bracket live' : 'bracket'} data-from={shown[0]} data-to={shown[1]}>
              <rect x={xOf(shown[0])} y={TOP - 6} width={xOf(shown[1] + 1) - xOf(shown[0])} height={BASE - TOP + 6} />
              <rect className="edge" x={xOf(shown[0])} y={TOP - 6} width={2} height={BASE - TOP + 6} />
              <rect className="edge" x={xOf(shown[1] + 1) - 2} y={TOP - 6} width={2} height={BASE - TOP + 6} />
            </g>
          )}
          {focused && (
            <rect className="cursor" x={xOf(at) - 1} y={TOP - 4} width={Math.max(3, cw) + 2} height={BASE - TOP + 6} />
          )}
          <line className="axis" x1={X0} x2={W} y1={BASE + 0.5} y2={BASE + 0.5} />
          {axisTicks(axis, W - X0 - 4).map((t) => {
            const x = Math.round(X0 + t.x) + 0.5;
            return (
              <g key={t.month}>
                <line className="axis" x1={x} x2={x} y1={BASE} y2={BASE + 7} />
                <text className="year" x={t.anchor === 'start' ? x + 3 : W - 1} y={BASE + 17} textAnchor={t.anchor}>
                  {t.year}
                </text>
              </g>
            );
          })}
        </svg>
        {bracketEnd !== null && (
          <SelClear
            ref={clearRef}
            className="onstrip"
            style={{ left: 10 + Math.min(Math.max(bracketEnd - clearW, X0), W - clearW), top: 1 }}
            label="Clear dates"
            onClick={() => clear('dates')}
          />
        )}
      </div>
      <Tip at={tip} />
    </section>
  );
}
