import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  NO_FILTERS,
  applyFilters,
  camtrapPackage,
  canShowExactSites,
  collectionsTable,
  csvFiles,
  exportFileName,
  isoDate,
  locationRows,
  precisionWords,
  slug,
  sortedLocations,
  speciesTable,
  spreadsheetTables,
  summarize,
  xlsxBlob,
  zipBlob,
  type ExportOptions,
  type FilterResult,
  type Model,
  type ReportFacts,
} from '@/data';
import { hourCounts, linear, niceTicks } from '@/lib/charts';
import { saveBlob } from '@/lib/download';
import { filterWords, matchLegend } from '@/lib/filterLabels';
import { fmtN, formatElevation, formatPosition } from '@/lib/format';
import { countByMonth, monthLabel, yearOf } from '@/lib/months';
import { ACTIVE_DAYS_HELP } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { HourChart, useWidth } from './Charts';
import { useDataChecks } from './DataChecks';
import { ReportMap } from './ReportMap';

const SECTIONS = [
  ['summary', 'Summary'],
  ['map', 'Map'],
  ['effort', 'Camera effort'],
  ['species', 'Species'],
  ['locations', 'Locations'],
  ['hours', 'Activity by hour'],
  ['bycoll', 'By collection'],
  ['checks', 'Data checks'],
] as const;
type Section = (typeof SECTIONS)[number][0];

/** What the last report included, for the next one this session. */
let included: Record<Section, boolean> = Object.fromEntries(SECTIONS.map(([k]) => [k, true])) as Record<Section, boolean>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

type Format = 'xlsx' | 'csv' | 'dp';

/** Photos per month, tagged and untagged, with the photos a species filter keeps drawn inside. */
function EffortChart({ model, result, match }: { model: Model; result: FilterResult; match: string | null }) {
  const [ref, W] = useWidth();
  const counts = useMemo(() => countByMonth(model, result.effort, match ? result.photos : []), [model, result, match]);
  if (!counts.size) return <p className="r-none">No photos in view.</p>;
  const months = [...counts.keys()];
  const first = Math.min(...months);
  const n = Math.max(...months) - first + 1;
  const H = 180;
  const left = 44;
  const top = 8;
  const base = H - 22;
  const bw = (W - left - 6) / n;
  const ticks = niceTicks(Math.max(...[...counts.values()].map((c) => c[0])), 4);
  const h = linear(ticks[ticks.length - 1], base - top);
  return (
    <div ref={ref} className="r-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Photos per month, tagged and untagged">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={left} x2={W - 6} y1={base - h(t)} y2={base - h(t)} />
            <text className="mono" x={left - 6} y={base - h(t) + 3.5} textAnchor="end">
              {fmtN(t)}
            </text>
          </g>
        ))}
        {[...counts].map(([m, [photos, untagged, matched]]) => {
          const x = left + (m - first) * bw;
          const w = Math.max(0.8, bw - (bw > 4 ? 1 : 0));
          const tagged = photos - untagged;
          const mw = w >= 5 ? Math.max(2, w * 0.5) : w;
          return (
            <g key={m} data-month={m}>
              <title>{`${monthLabel(m)}: ${fmtN(photos)} photos, ${fmtN(untagged)} untagged${match ? `, ${match} ${fmtN(matched)}` : ''}`}</title>
              {tagged > 0 && <rect className="bar" x={x} y={base - h(tagged)} width={w} height={h(tagged)} />}
              {untagged > 0 && <rect className="untag" x={x} y={base - h(photos)} width={w} height={h(untagged)} />}
              {matched > 0 && <rect className="match" x={x + (w - mw) / 2} y={base - h(matched)} width={mw} height={h(matched)} />}
            </g>
          );
        })}
        <line className="axis" x1={left} x2={W - 6} y1={base} y2={base} />
        {Array.from({ length: n }, (_, i) => first + i)
          .filter((m) => m === first || m % 12 === 0)
          .map((m) => {
            const x = left + (m - first) * bw;
            const room = m % 12 === 0 || (12 - (first % 12)) * bw >= 36 || n < 12;
            return (
              <g key={m}>
                <line className="axis" x1={x} x2={x} y1={base} y2={base + 5} />
                {room && x + 30 <= W && (
                  <text className="mono" x={x + 3} y={H - 6}>
                    {yearOf(m)}
                  </text>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}

/** Column heads as [label, numeric, may wrap]. */
type Head = [string, boolean?, boolean?];

function ReportTable({ head, rows, className }: { head: Head[]; rows: (string | number)[][]; className?: string }) {
  if (!rows.length) return <p className="r-none">Nothing in view.</p>;
  return (
    <div className="r-scroll">
      <table className={className ? `rt ${className}` : 'rt'}>
        <thead>
          <tr>
            {head.map(([h, n]) => (
              <th key={h} className={n ? 'n' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={head[j][1] ? 'n' : head[j][2] ? 'w' : undefined}>
                  {typeof v === 'number' ? fmtN(v) : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dash = (v: string | number | null) => (v === null || v === '' ? '—' : v);

/**
 * A printable report of what is in view, over the page, which stays where it
 * was. Print or save as PDF prints only the report; the downloads hold the
 * same rows, never with coordinates more exact than the page shows.
 */
export function ReportSheet({ onClose }: { onClose: () => void }) {
  const { model, filters, result, grouping, multi } = useView();
  const display = useStore((s) => s.display);
  const config = useStore((s) => s.config)!;
  const loaded = useStore((s) => s.loaded);
  const mapMode = useStore((s) => s.mapMode);
  const checks = useDataChecks();
  const [inc, setInc] = useState(included);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const prepared = useMemo(() => new Date(), []);

  const names = model.collections.map((c) => c.name);
  const words = filterWords(model, filters, display.elevation, grouping.separate);
  const coordinates = precisionWords(display.coords, display.precision);
  const opts: ExportOptions = { ...display, separate: grouping.separate };
  const facts: ReportFacts = {
    collections: names.join(', '),
    filters: words,
    prepared: isoDate(prepared),
    preparedBy: config.accessKey,
    coordinates,
  };
  const sum = useMemo(() => summarize(model, result, grouping), [model, result, grouping]);
  const allLocations = useMemo(() => summarize(model, applyFilters(model, NO_FILTERS), grouping).locations, [model, grouping]);
  const species = useMemo(() => speciesTable(model, result, opts), [model, result, grouping]);
  const locations = useMemo(() => sortedLocations(model, locationRows(model, result, grouping)), [model, result, grouping]);
  const byCollection = useMemo(() => collectionsTable(model, result, opts, filters.collections), [model, result, grouping, filters.collections]);
  const hours = useMemo(() => hourCounts(model, result.detections), [model, result]);
  const unplaced = useMemo(() => locations.filter((l) => l.noLocation).reduce((n, l) => n + l.photos, 0), [locations]);
  // A species filter's photos are drawn inside the effort bars, as on the page.
  const speciesMatch = matchLegend(model, filters, false);
  const sitesShown = mapMode === 'sites' && canShowExactSites(config.endpoint);

  // The page underneath keeps its place and doesn't scroll; closing hands focus back.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const y = scrollY;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    html.classList.add('report-open');
    sheet.current!.focus({ preventScroll: true });
    return () => {
      html.style.overflow = before;
      html.classList.remove('report-open');
      if (scrollY !== y) scrollTo(0, y);
    };
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (menuOpen.current) {
        setMenu(false);
        more.current?.focus();
      } else closeRef.current();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuOpen.current && !menuRef.current?.contains(t) && !more.current?.contains(t)) setMenu(false);
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down);
    };
  }, []);
  useEffect(() => {
    if (menu) menuRef.current?.querySelector('button')?.focus();
  }, [menu]);

  // Tab stays inside the report.
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...sheet.current!.querySelectorAll<HTMLElement>('button:not([disabled]), input')].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const toggle = (k: Section, on: boolean) => {
    included = { ...inc, [k]: on };
    setInc(included);
  };

  const download = async (format: Format) => {
    setMenu(false);
    setBusy(format);
    setProblem(null);
    try {
      if (format === 'xlsx') {
        saveBlob(exportFileName(names, 'report.xlsx', prepared), await xlsxBlob(spreadsheetTables(model, result, opts, facts, filters.collections)));
      } else if (format === 'csv') {
        saveBlob(exportFileName(names, 'csv.zip', prepared), await zipBlob(csvFiles(model, result, opts)));
      } else {
        const name = exportFileName(names, 'camtrap-dp.zip', prepared);
        const files = camtrapPackage(model, loaded, result, display.precision, {
          name: slug(name.replace(/\.zip$/, '')),
          title: names.join(' + '),
          created: prepared.toISOString(),
          contributor: config.accessKey,
          filters: words,
        });
        saveBlob(name, await zipBlob(files));
      }
    } catch {
      setProblem("That file couldn't be made. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const shown = SECTIONS.filter(([k]) => k !== 'bycoll' || multi);
  const section = (k: Section, title: string, body: React.ReactNode) =>
    (k !== 'bycoll' || multi) && (
      <section className="r-sec" data-sec={k} hidden={!inc[k]} aria-label={title}>
        <h2>{title}</h2>
        {body}
      </section>
    );
  const pct = sum.photos ? Math.round((sum.tagged / sum.photos) * 100) : 0;

  return createPortal(
    <div
      ref={sheet}
      id="report"
      className="report"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      tabIndex={-1}
      onKeyDown={trap}
    >
      <div className="rep-bar">
        <div className="rep-top">
          <h2 id="report-title">Report preview</h2>
          <div className="rep-acts">
            <button type="button" className="btn primary" onClick={() => window.print()}>
              Print or save as PDF
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void download('xlsx')}>
              {busy === 'xlsx' ? 'Preparing…' : 'Download spreadsheet'}
            </button>
            <span className="rep-more">
              <button
                ref={more}
                type="button"
                className="btn"
                aria-haspopup="menu"
                aria-expanded={menu}
                disabled={busy !== null}
                onClick={() => setMenu(!menu)}
              >
                {busy === 'csv' || busy === 'dp' ? 'Preparing…' : 'More formats'} <span className="caret" />
              </button>
              {menu && (
                <div ref={menuRef} className="rep-menu menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void download('csv')}>
                    CSV files (.zip)
                  </button>
                  <button type="button" role="menuitem" onClick={() => void download('dp')}>
                    Camtrap DP package (.zip)
                  </button>
                </div>
              )}
            </span>
          </div>
          <button type="button" className="btn rep-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="rep-inc" role="group" aria-label="Include">
          <span className="label" aria-hidden="true">
            Include:
          </span>
          {shown.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={inc[k]} onChange={(e) => toggle(k, e.target.checked)} />
              {label}
            </label>
          ))}
          <span className="rep-status" role="status">
            {problem}
          </span>
        </div>
      </div>
      <div className="desk">
        <article className="sheet" aria-label="Report">
          <header className="r-head">
            <h1>Camera-trap report</h1>
            <p className="r-colls">{names.join(' + ')}</p>
            <p className="r-filters">{words}</p>
            <p className="r-meta">
              Prepared {longDate(prepared)} by {config.accessKey} · {coordinates} · Elevation in {display.elevation === 'ft' ? 'feet' : 'metres'}
            </p>
          </header>
          {section(
            'summary',
            'Summary',
            <dl className="r-stats">
              <div>
                <dt>Locations</dt>
                <dd>
                  {fmtN(sum.locations)} <small>of {fmtN(allLocations)}</small>
                </dd>
              </div>
              <div>
                <dt>Photos</dt>
                <dd>
                  {fmtN(sum.photos)} <small>{pct}% tagged</small>
                </dd>
              </div>
              <div>
                <dt>Detections</dt>
                <dd>{fmtN(sum.detections)}</dd>
              </div>
              <div>
                <dt>Species</dt>
                <dd>{fmtN(sum.species)}</dd>
              </div>
              <div>
                <dt>Animals counted</dt>
                <dd>{fmtN(sum.animals)}</dd>
              </div>
              <div>
                <dt title={ACTIVE_DAYS_HELP}>Active days</dt>
                <dd>{fmtN(sum.activeDays)}</dd>
              </div>
              <div className="wide">
                <dt>Dates</dt>
                <dd className="span">{sum.firstDate ? `${sum.firstDate} to ${sum.lastDate}` : '—'}</dd>
              </div>
            </dl>,
          )}
          {section(
            'map',
            'Map',
            <figure className="r-map">
              <ReportMap
                model={model}
                result={result}
                separate={grouping.separate}
                precision={display.precision}
                sites={sitesShown}
                area={filters.area}
              />
              <figcaption className="r-cap">
                {sitesShown ? 'Dots sized by detections in view.' : 'Hexes shaded by detections in view; their size follows the coordinate precision.'}{' '}
                No basemap.
                {unplaced > 0 && ` ${fmtN(unplaced)} ${unplaced === 1 ? 'photo has' : 'photos have'} no location and ${unplaced === 1 ? 'is' : 'are'} not on the map.`}
              </figcaption>
            </figure>,
          )}
          {section(
            'effort',
            'Camera effort',
            <>
              <p className="r-cap">Photos per month</p>
              <EffortChart model={model} result={result} match={speciesMatch} />
              <p className="r-legend">
                <span>
                  <i className="t" />
                  Tagged
                </span>
                <span>
                  <i className="u" />
                  Untagged
                </span>
                {speciesMatch && (
                  <span>
                    <i className="m" />
                    {speciesMatch}
                  </span>
                )}
              </p>
            </>,
          )}
          {section(
            'species',
            'Species',
            <ReportTable
              className="sp"
              head={[['Common name'], ['Scientific name'], ['Detections', true], ['Animals counted', true], ['Locations', true], ['First seen'], ['Last seen']]}
              rows={species.rows.map(([common, sci, dets, animals, , locs, first, last]) => [
                dash(common),
                dash(sci),
                dets as number,
                animals as number,
                locs as number,
                dash(first),
                dash(last),
              ])}
            />,
          )}
          {section(
            'locations',
            'Locations',
            <ReportTable
              className="loc"
              head={[
                ...(multi ? ([['Collection', false, true]] as Head[]) : []),
                ['ID'],
                ['Name', false, true],
                ['Mountain range', false, true],
                ['Coordinates'],
                ['Elevation', true],
                ['Photos', true],
                ['Active days', true],
                ['First photo'],
                ['Last photo'],
              ]}
              rows={locations.map((r) => [
                ...(multi ? [r.collections.map((c) => model.collections[c].name).join(', ')] : []),
                r.ids.join(', '),
                r.noLocation ? 'No location set' : r.name || '—',
                r.range || '—',
                formatPosition(r.position, display),
                formatElevation(r.elevation, display.elevation),
                r.photos,
                r.activeDays,
                dash(r.firstDate),
                dash(r.lastDate),
              ])}
            />,
          )}
          {section(
            'hours',
            'Activity by hour',
            <>
              <p className="r-cap">Detections by hour of day, camera clock time. Shaded hours are night.</p>
              {result.detections.length ? (
                <div className="r-chart chart">
                  <HourChart hours={hours} filters={NO_FILTERS} />
                </div>
              ) : (
                <p className="r-none">No detections in view.</p>
              )}
            </>,
          )}
          {section(
            'bycoll',
            'By collection',
            <ReportTable
              head={[['Collection'], ['Locations', true], ['Photos', true], ['Tagged', true], ['Detections', true], ['Species', true], ['First photo'], ['Last photo']]}
              rows={byCollection.rows.map((r) => r.map((v) => (typeof v === 'number' ? v : dash(v))))}
            />,
          )}
          {section(
            'checks',
            'Data checks',
            checks.length ? (
              <ul className="r-checks">
                {checks.map((c, i) => (
                  <li key={i}>{c.text}</li>
                ))}
              </ul>
            ) : (
              <p className="r-none">No problems found.</p>
            ),
          )}
          <footer className="r-foot">
            <span>SPARC'd Explorer</span>
            <span>{isoDate(prepared)}</span>
          </footer>
        </article>
      </div>
    </div>,
    document.body,
  );
}
