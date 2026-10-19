import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { applyFilters, clearFilter, type FilterState } from '@/data';
import { fmtN } from '@/lib/format';
import { countByMonth, datesToMonths, monthAxis, monthLabel, monthShade, monthsToDates, yearOf, yearTicks } from '@/lib/months';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { Tip, type TipAt } from './Tip';

// Geometry of the strip, in pixels: a left gutter for the scale, bars between
// `TOP` and `BASE`, year labels under the axis.
const H = 102;
const X0 = 44;
const TOP = 32;
const BASE = 82;

/** Whether a month survives the Dates filter's years, months and range. */
function monthPasses(f: FilterState, m: number, range: [number, number] | null): boolean {
  if (f.years.length && !f.years.includes(yearOf(m))) return false;
  if (f.months.length && !f.months.includes((m % 12) + 1)) return false;
  return !range || (m >= range[0] && m <= range[1]);
}

/**
 * Photos per month across the opened data, under every filter but Dates, so
 * the time context stays in sight while dates are picked. Drag or click to
 * set Dates; arrows move a cursor and Enter or Space picks.
 */
export function EffortStrip() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
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
  const counts = useMemo(() => countByMonth(model, applyFilters(model, clearFilter(filters, 'dates')).photos), [model, filters]);
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
  const clearDates = () => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }));
  /** A click picks one month; a second click on the same month lets it go. */
  const pick = (m: number) => {
    if (range && range[0] === m && range[1] === m) clearDates();
    else setMonths(m, m);
  };

  const tipFor = (m: number, x: number, y: number) => {
    const [photos, untagged] = counts.get(m) ?? [0, 0];
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
        if (anchor === at) clearDates();
        else setMonths(anchor, at);
        setAnchor(null);
      }
      setCursor(at);
    } else if (e.key === 'Escape' && anchor !== null) {
      e.preventDefault();
      setAnchor(null);
    }
  };

  const [cp, cu] = counts.get(at) ?? [0, 0];
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
          aria-valuetext={`${monthLabel(at)}: ${fmtN(cp)} photos, ${fmtN(cu)} untagged${anchor !== null ? `; range from ${monthLabel(anchor)}` : ''}`}
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
          {[...counts].map(([m, [photos, untagged]]) => {
            const h = Math.max(2, ((BASE - TOP) * photos) / max);
            const uh = untagged ? Math.max(2, (h * untagged) / photos) : 0;
            const x = xOf(m) + 0.5;
            const w = Math.max(1, cw - 1);
            return (
              <g key={m} data-month={m}>
                <rect
                  x={x}
                  y={BASE - h}
                  width={w}
                  height={h}
                  style={{ fill: `color-mix(in srgb, var(--accent) ${Math.round(monthShade(photos, max) * 100)}%, var(--accentSoft))` }}
                />
                {uh > 0 && <rect className="untag" x={x} y={BASE - uh} width={w} height={uh} />}
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
          {yearTicks(axis).map((t) => {
            const x = Math.round(xOf(t.month)) + 0.5;
            const fits = x + 34 <= W;
            return (
              <g key={t.month}>
                <line className="axis" x1={x} x2={x} y1={BASE} y2={BASE + 7} />
                <text className="year" x={fits ? x + 3 : W - 1} y={BASE + 17} textAnchor={fits ? 'start' : 'end'}>
                  {t.year}
                </text>
              </g>
            );
          })}
        </svg>
        {bracketEnd !== null && (
          <button
            ref={clearRef}
            type="button"
            className="selclear onstrip"
            style={{ left: 10 + Math.min(Math.max(bracketEnd - clearW, X0), W - clearW), top: 1 }}
            aria-label="Clear dates"
            onClick={clearDates}
          >
            <b aria-hidden="true">×</b>Clear
          </button>
        )}
      </div>
      <Tip at={tip} />
    </section>
  );
}
