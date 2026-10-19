import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FilterState } from '@/data';
import {
  chartData,
  hourBar,
  linear,
  monthBar,
  niceTicks,
  speciesBar,
  toggleHour,
  toggleMonth,
  toggleSpecies,
  type BarState,
} from '@/lib/charts';
import { fmtN } from '@/lib/format';
import { monthAxis, monthLabel, yearOf, type MonthAxis } from '@/lib/months';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';

const pad = (n: number) => String(n).padStart(2, '0');

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, Math.max(280, width)] as const;
}

/** One bar: a button that toggles its filter, by click or Enter / Space. */
function Bar({
  label,
  state,
  onToggle,
  data,
  children,
}: {
  label: string;
  state: BarState;
  onToggle: () => void;
  data: Record<string, string | number>;
  children: ReactNode;
}) {
  return (
    <g
      className="row"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={state === 'on'}
      data-state={state ?? undefined}
      {...data}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onToggle();
      }}
    >
      {children}
    </g>
  );
}

const barClass = (state: BarState) => (state ? `bar ${state}` : 'bar');

function SpeciesChart({ rows, filters, onPick }: { rows: { key: string; name: string; n: number }[]; filters: FilterState; onPick: (key: string) => void }) {
  const [ref, W] = useWidth();
  const rowH = 22;
  const lab = Math.min(150, W * 0.36);
  const H = rows.length * rowH + 26;
  const ticks = niceTicks(Math.max(0, ...rows.map((r) => r.n)));
  const x = linear(ticks[ticks.length - 1], W - lab - 50);
  return (
    <div ref={ref}>
      {rows.length === 0 ? (
        <p className="fine">No detections in view.</p>
      ) : (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Detections by species">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={lab + x(t)} x2={lab + x(t)} y1={0} y2={H - 20} />
              <text className="mono" x={lab + x(t)} y={H - 6} textAnchor="middle">
                {fmtN(t)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = i * rowH;
            const state = speciesBar(filters, r.key);
            return (
              <Bar key={r.key} label={`${r.name}: ${fmtN(r.n)} detections`} state={state} onToggle={() => onPick(r.key)} data={{ 'data-species': r.key }}>
                <rect className="hit" x={0} y={y} width={W} height={rowH} />
                <text x={lab - 8} y={y + rowH / 2 + 4} textAnchor="end">
                  {r.name}
                </text>
                <rect className={barClass(state)} x={lab} y={y + 4} width={Math.max(1, x(r.n))} height={rowH - 8} />
                <text className="mono" x={lab + x(r.n) + 5} y={y + rowH / 2 + 4}>
                  {fmtN(r.n)}
                </text>
              </Bar>
            );
          })}
          <line className="axis" x1={lab} x2={lab} y1={0} y2={H - 20} />
        </svg>
      )}
    </div>
  );
}

function HourChart({ hours, filters, onPick }: { hours: number[]; filters: FilterState; onPick: (hour: number) => void }) {
  const [ref, W] = useWidth();
  const H = 248;
  const left = 44;
  const top = 18;
  const base = H - 30;
  const ticks = niceTicks(Math.max(0, ...hours));
  const h = linear(ticks[ticks.length - 1], base - top);
  const bw = (W - left - 8) / 24;
  return (
    <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Detections by hour of day">
        {/* Night: 19:00 to 06:00 on the camera's clock. */}
        <rect className="night" x={left} y={0} width={bw * 6} height={base} />
        <rect className="night" x={left + bw * 19} y={0} width={bw * 5} height={base} />
        <text className="mono" x={left + 4} y={12}>
          night
        </text>
        <text className="mono" x={W - 12} y={12} textAnchor="end">
          night
        </text>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={left} x2={W - 8} y1={base - h(t)} y2={base - h(t)} />
            <text className="mono" x={left - 6} y={base - h(t) + 4} textAnchor="end">
              {fmtN(t)}
            </text>
          </g>
        ))}
        {hours.map((n, hour) => {
          const x = left + hour * bw;
          const state = hourBar(filters, hour);
          return (
            <Bar key={hour} label={`${pad(hour)}:00, ${fmtN(n)} detections`} state={state} onToggle={() => onPick(hour)} data={{ 'data-hour': hour }}>
              <rect className="hit" x={x} y={0} width={bw} height={base} />
              <rect className={barClass(state)} x={x + 1.5} y={base - h(n)} width={Math.max(1, bw - 3)} height={h(n)} />
            </Bar>
          );
        })}
        {hours.map((_, hour) =>
          hour % 3 === 0 ? (
            <text key={hour} className="mono" x={left + hour * bw + bw / 2} y={base + 16} textAnchor="middle">
              {pad(hour)}
            </text>
          ) : null,
        )}
        <line className="axis" x1={left} x2={W - 8} y1={base} y2={base} />
      </svg>
    </div>
  );
}

function MonthChart({ months, axis, filters, onPick }: { months: number[]; axis: MonthAxis; filters: FilterState; onPick: (m: number) => void }) {
  const [ref, W] = useWidth();
  const H = 220;
  const left = 44;
  const base = H - 34;
  const ticks = niceTicks(Math.max(0, ...months));
  const h = linear(ticks[ticks.length - 1], base - 8);
  const mw = (W - left - 8) / axis.count;
  return (
    <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Detections per month">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={left} x2={W - 8} y1={base - h(t)} y2={base - h(t)} />
            <text className="mono" x={left - 6} y={base - h(t) + 4} textAnchor="end">
              {fmtN(t)}
            </text>
          </g>
        ))}
        {months.map((n, i) => {
          const m = axis.first + i;
          const x = left + i * mw;
          const state = monthBar(filters, m, axis);
          return (
            <Bar key={m} label={`${monthLabel(m)}, ${fmtN(n)} detections`} state={state} onToggle={() => onPick(m)} data={{ 'data-month': m }}>
              <rect className="hit" x={x} y={0} width={mw} height={base} />
              <rect className={barClass(state)} x={x + 0.5} y={base - h(n)} width={Math.max(1, mw - 1.5)} height={h(n)} />
            </Bar>
          );
        })}
        {months.map((_, i) => {
          const m = axis.first + i;
          if (i !== 0 && m % 12 !== 0) return null;
          const x = left + i * mw;
          return (
            <g key={m}>
              <line className="axis" x1={x} x2={x} y1={base} y2={base + 18} />
              <text className="yearlab" x={x + 3} y={base + 16}>
                {yearOf(m)}
              </text>
            </g>
          );
        })}
        <line className="axis" x1={left} x2={W - 8} y1={base} y2={base} />
      </svg>
    </div>
  );
}

/** Three fixed charts of the detections in view. A bar is a shortcut to its filter. */
export function Charts() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const axis = useMemo(() => monthAxis(model), [model]);
  const data = useMemo(() => chartData(model, filters, axis), [model, filters, axis]);
  const species = data.species.map((s) => ({ key: model.species[s.species].key, name: model.species[s.species].name, n: s.detections }));
  return (
    <div className="charts">
      <figure className="chart">
        <h3>Detections by species</h3>
        <p>Common names</p>
        <SpeciesChart rows={species} filters={filters} onPick={(key) => setFilters((f) => toggleSpecies(f, key))} />
      </figure>
      <figure className="chart">
        <h3>Activity by hour of day</h3>
        <p>Camera clock time. Shaded hours are night.</p>
        <HourChart hours={data.hours} filters={filters} onPick={(hour) => setFilters((f) => toggleHour(f, hour))} />
      </figure>
      <figure className="chart wide">
        <h3>Detections per month</h3>
        {axis ? (
          <>
            <p>
              {monthLabel(axis.first)} to {monthLabel(axis.first + axis.count - 1)}
            </p>
            <MonthChart months={data.months} axis={axis} filters={filters} onPick={(m) => setFilters((f) => toggleMonth(f, m))} />
          </>
        ) : (
          <p>No photo here has a readable date.</p>
        )}
      </figure>
    </div>
  );
}
