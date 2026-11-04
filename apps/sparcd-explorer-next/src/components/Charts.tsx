import { useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { isoDate, toggleSpecies, type FilterState } from '@/data';
import { DRAWING_WIDTH, chartPng, hourCsv, imageLabelWidth, monthCsv, speciesCsv, type SpeciesBar } from '@/lib/chartExport';
import {
  chartData,
  hourBar,
  linear,
  monthBar,
  niceTicks,
  speciesBar,
  toggleHour,
  toggleMonth,
  type BarState,
} from '@/lib/charts';
import { csvFileName } from '@/lib/csv';
import { saveBlob } from '@/lib/download';
import { filterWords } from '@/lib/filterLabels';
import { fmtN } from '@/lib/format';
import { monthAxis, monthLabel, yearOf, type MonthAxis } from '@/lib/months';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';

const pad = (n: number) => String(n).padStart(2, '0');

export function useWidth() {
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

/** One bar: a button that toggles its filter, by click or Enter / Space. Without `onToggle`, a plain drawing. */
function Bar({
  label,
  state,
  onToggle,
  data,
  children,
}: {
  label: string;
  state: BarState;
  onToggle?: () => void;
  data: Record<string, string | number>;
  children: ReactNode;
}) {
  if (!onToggle) {
    return (
      <g className="row" {...data}>
        <title>{label}</title>
        {children}
      </g>
    );
  }
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

type Picking<T> = { filters?: FilterState; onPick?: (value: T) => void };

/** Detections per species, most first. Pure: its size and numbers come in; without `onPick`, a plain drawing. */
function SpeciesDrawing({ width: W, rows, labelWidth, filters, onPick }: { width: number; rows: SpeciesBar[]; labelWidth?: number } & Picking<string>) {
  const rowH = 22;
  const lab = labelWidth ?? Math.min(150, W * 0.36);
  const H = rows.length * rowH + 26;
  const ticks = niceTicks(Math.max(0, ...rows.map((r) => r.n)));
  const x = linear(ticks[ticks.length - 1], W - lab - 50);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role={onPick ? 'group' : 'img'} aria-label="Detections by species">
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
        const state = filters ? speciesBar(filters, r.key) : null;
        return (
          <Bar key={r.key} label={`${r.name}: ${fmtN(r.n)} detections`} state={state} onToggle={onPick && (() => onPick(r.key))} data={{ 'data-species': r.key }}>
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
  );
}

function SpeciesChart({ rows, filters, onPick }: { rows: SpeciesBar[]; filters: FilterState; onPick: (key: string) => void }) {
  const [ref, W] = useWidth();
  return <div ref={ref}>{rows.length === 0 ? <p className="fine">No detections in view.</p> : <SpeciesDrawing width={W} rows={rows} filters={filters} onPick={onPick} />}</div>;
}

/** Detections per camera-clock hour, night shaded. Pure, as `SpeciesDrawing` is. */
function HourDrawing({ width: W, hours, filters, onPick }: { width: number; hours: number[] } & Picking<number>) {
  const H = 248;
  const left = 44;
  const top = 18;
  const base = H - 30;
  const ticks = niceTicks(Math.max(0, ...hours));
  const h = linear(ticks[ticks.length - 1], base - top);
  const bw = (W - left - 8) / 24;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role={onPick ? 'group' : 'img'} aria-label="Detections by hour of day">
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
        const state = filters ? hourBar(filters, hour) : null;
        return (
          <Bar key={hour} label={`${pad(hour)}:00, ${fmtN(n)} detections`} state={state} onToggle={onPick && (() => onPick(hour))} data={{ 'data-hour': hour }}>
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
  );
}

/** The hour chart at the width it is given by the page. With `onPick`, a bar toggles its hour. */
export function HourChart({ hours, filters, onPick }: { hours: number[] } & Picking<number>) {
  const [ref, W] = useWidth();
  return (
    <div ref={ref}>
      <HourDrawing width={W} hours={hours} filters={filters} onPick={onPick} />
    </div>
  );
}

/** Detections per month along the shared axis. Pure, as `SpeciesDrawing` is. */
function MonthDrawing({ width: W, months, axis, filters, onPick }: { width: number; months: number[]; axis: MonthAxis } & Picking<number>) {
  const H = 220;
  const left = 44;
  const base = H - 34;
  const ticks = niceTicks(Math.max(0, ...months));
  const h = linear(ticks[ticks.length - 1], base - 8);
  const mw = (W - left - 8) / axis.count;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role={onPick ? 'group' : 'img'} aria-label="Detections per month">
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
        const state = filters ? monthBar(filters, m, axis) : null;
        return (
          <Bar key={m} label={`${monthLabel(m)}, ${fmtN(n)} detections`} state={state} onToggle={onPick && (() => onPick(m))} data={{ 'data-month': m }}>
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
  );
}

function MonthChart({ months, axis, filters, onPick }: { months: number[]; axis: MonthAxis; filters: FilterState; onPick: (m: number) => void }) {
  const [ref, W] = useWidth();
  return (
    <div ref={ref}>
      <MonthDrawing width={W} months={months} axis={axis} filters={filters} onPick={onPick} />
    </div>
  );
}

/** A chart's title and subtitle, with its two ways to save what it shows. */
function ChartHead({ title, subtitle, disabled, onImage, onData }: { title: string; subtitle: string; disabled: boolean; onImage: () => void; onData: () => void }) {
  return (
    <div className="charthead">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="chartsave">
        <button type="button" className="btn quiet" disabled={disabled} aria-label={`Save image of ${title}`} onClick={onImage}>
          Save image
        </button>
        <button type="button" className="btn quiet" disabled={disabled} aria-label={`Save data of ${title}`} onClick={onData}>
          Save data
        </button>
      </div>
    </div>
  );
}

const anyOf = (counts: number[]) => counts.some((n) => n > 0);

/** Three fixed charts of the detections in view. A bar is a shortcut to its filter. */
export function Charts() {
  const { model, filters, result, grouping } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const showToast = useStore((s) => s.showToast);
  const unit = useStore((s) => s.display.elevation);
  const axis = useMemo(() => monthAxis(model), [model]);
  const data = useMemo(() => chartData(model, result.detections, axis), [model, result, axis]);
  const species: SpeciesBar[] = data.species.map((s) => {
    const { key, name, scientificName } = model.species[s.species];
    return { key, name, scientificName, n: s.detections };
  });
  const names = model.collections.map((c) => c.name);

  const saveData = (chart: string, csv: string) =>
    saveBlob(csvFileName(names, `${chart}-chart`, new Date()), new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const saveImage = (chart: string, drawing: ReactElement, title: string, subtitle: string) => {
    const now = new Date();
    const footer = [names.join(', '), filterWords(model, filters, unit, grouping.separate), `Saved ${isoDate(now)}`].join(' · ');
    chartPng(drawing, { title, subtitle, footer })
      .then((png) => saveBlob(csvFileName(names, `${chart}-chart`, now, 'png'), png))
      .catch(() => showToast('This chart could not be saved as an image'));
  };

  const speciesTitle = 'Detections by species';
  const speciesSub = 'Common names';
  const hourTitle = 'Activity by hour of day';
  const hourSub = 'Camera clock time. Shaded hours are night.';
  const monthTitle = 'Detections per month';
  const monthSub = axis ? `${monthLabel(axis.first)} to ${monthLabel(axis.first + axis.count - 1)}` : 'No photo here has a readable date.';
  return (
    <div className="charts">
      <figure className="chart">
        <ChartHead
          title={speciesTitle}
          subtitle={speciesSub}
          disabled={species.length === 0}
          onImage={() =>
            saveImage('species', <SpeciesDrawing width={DRAWING_WIDTH} rows={species} labelWidth={imageLabelWidth(species.map((s) => s.name))} />, speciesTitle, speciesSub)
          }
          onData={() => saveData('species', speciesCsv(species))}
        />
        <SpeciesChart rows={species} filters={filters} onPick={(key) => setFilters((f) => toggleSpecies(model, f, key))} />
      </figure>
      <figure className="chart">
        <ChartHead
          title={hourTitle}
          subtitle={hourSub}
          disabled={!anyOf(data.hours)}
          onImage={() => saveImage('hour', <HourDrawing width={DRAWING_WIDTH} hours={data.hours} />, hourTitle, hourSub)}
          onData={() => saveData('hour', hourCsv(data.hours))}
        />
        <HourChart hours={data.hours} filters={filters} onPick={(hour) => setFilters((f) => toggleHour(f, hour))} />
      </figure>
      <figure className="chart wide">
        <ChartHead
          title={monthTitle}
          subtitle={monthSub}
          disabled={!axis || !anyOf(data.months)}
          onImage={() => saveImage('month', <MonthDrawing width={DRAWING_WIDTH} months={data.months} axis={axis!} />, monthTitle, monthSub)}
          onData={() => saveData('month', monthCsv(data.months, axis!))}
        />
        {axis && <MonthChart months={data.months} axis={axis} filters={filters} onPick={(m) => setFilters((f) => toggleMonth(f, m))} />}
      </figure>
    </div>
  );
}
