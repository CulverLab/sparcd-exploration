import { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  clearFilter,
  locationRows,
  onlyLocations,
  photoRows,
  photosForTag,
  soleSpecies,
  speciesRows,
  toggleSpecies,
  type FilterResult,
  type LocationRow,
  type Model,
  type PhotoRow,
  type PhotoTag,
  type SpeciesRow,
} from '@/data';
import { activityByLocation } from '@/lib/activity';
import { LIST_NOUNS, matchLegend, noneTicked } from '@/lib/filterLabels';
import { axisTicks, barFill, monthAxis, monthLabel, type AxisTick, type MonthAxis, type MonthCounts } from '@/lib/months';
import { loadPrefs, savePrefs, shownColumns, type ColumnPrefs } from '@/lib/columnPrefs';
import { csvColumns, csvFileName, toCsv } from '@/lib/csv';
import { saveBlob } from '@/lib/download';
import { fmtN, plural } from '@/lib/format';
import {
  locationColumns,
  locationFlagger,
  photoColumns,
  sortRows,
  speciesColumns,
  type Col,
  type Flag,
  type TableContext,
} from '@/lib/tables';
import { useTableView } from '@/lib/useTableView';
import { useStore, type PhotoLayout, type TableView } from '@/store';
import { ColumnsEditor } from './ColumnsEditor';
import { DataChecksPanel } from './DataChecks';
import { CollectionsCell, FlagTags } from './LocationCells';
import { DataTable } from './DataTable';
import { PhotoGrid, useSteadyRows } from './PhotoGrid';
import { Seg, usePopover } from './Popover';
import { Tip, type TipAt } from './Tip';
import { Charts, PhotoDetail } from './later';

const NO_PHOTOS: PhotoRow[] = [];

// The Photos rows last built: switching back to Photos rebuilds nothing, and
// their order, cached by `sortRows`, stays too.
let photoCache: { model: Model; result: FilterResult; tag: PhotoTag; rows: PhotoRow[] } | null = null;
function photoRowsOf(model: Model, result: FilterResult, tag: PhotoTag): PhotoRow[] {
  if (photoCache?.model !== model || photoCache.result !== result || photoCache.tag !== tag) {
    photoCache = { model, result, tag, rows: photoRows(model, photosForTag(model, result.photos, tag), result.detections) };
  }
  return photoCache.rows;
}

const VIEW_NAMES = { locations: 'Locations', species: 'Species', photos: 'Photos', charts: 'Charts' } as const;

/** The Activity header: year labels thinned to fit, reporting the strip width it has. */
function ActivityHead({ ticks, onWidth }: { ticks: AxisTick[]; onWidth: (width: number) => void }) {
  const axisRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = axisRef.current!;
    const measure = () => onWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onWidth]);
  return (
    <span className="axhead">
      <span>Activity</span>
      <span ref={axisRef} className="yaxis" aria-hidden="true">
        {ticks.map((t) => (
          <Fragment key={t.month}>
            <i style={{ left: t.x }} />
            <span style={t.anchor === 'end' ? { right: 0, paddingLeft: 0 } : { left: t.x }}>{t.year}</span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}

/** "AB01 · 2023-04 to 2025-03 · 157 active days" */
function activityLine(r: LocationRow): string {
  const id = r.noLocation ? 'No location set' : r.ids.join(', ');
  const span = r.firstDate && r.lastDate ? `${r.firstDate.slice(0, 7)} to ${r.lastDate.slice(0, 7)}` : 'no photos in view';
  return `${id} · ${span} · ${plural(r.activeDays, 'active day')}`;
}

function ActivityCell({
  axis,
  ticks,
  row,
  months,
  max,
  legend,
  onTip,
}: {
  axis: MonthAxis;
  /** Year lines drawn where the header labels them. */
  ticks: AxisTick[];
  row: LocationRow;
  months?: MonthCounts;
  max: number;
  /** What the inner bars show, when a species filter is on. */
  legend: string | null;
  onTip: (tip: TipAt | null) => void;
}) {
  const H = 14;
  const line = activityLine(row);
  return (
    <span
      className="spark"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const m = axis.first + Math.min(axis.count - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * axis.count)));
        const [photos, untagged, match] = months?.get(m) ?? [0, 0, 0];
        onTip({
          x: e.clientX,
          y: e.clientY,
          content: (
            <>
              <b>{line}</b>
              <div className="m">
                {monthLabel(m)}: {plural(photos, 'photo')}
                {untagged ? `, ${fmtN(untagged)} untagged` : ''}
                {legend ? `; ${legend}: ${fmtN(match)}` : ''}
              </div>
            </>
          ),
        });
      }}
      onPointerLeave={() => onTip(null)}
    >
      <svg viewBox={`0 0 ${axis.count} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <rect className="trk" width={axis.count} height={H} />
        {[...(months ?? [])].map(([m, [n, untagged, match]]) => {
          // Untagged photos from the bottom, the photos the species filter keeps on top of them.
          const uh = untagged ? Math.max(2, (H * untagged) / n) : 0;
          const mh = match ? Math.min(H - uh, Math.max(3, (H * match) / n)) : 0;
          return (
            <g key={m} data-match={legend ? match : undefined}>
              <rect x={m - axis.first} width={1} height={H} style={{ fill: barFill(n, max, Boolean(legend)) }} />
              {uh > 0 && <rect className="untag" x={m - axis.first} y={H - uh} width={1} height={uh} />}
              {mh > 0 && <rect className="match" x={m - axis.first} y={H - uh - mh} width={1} height={mh} />}
            </g>
          );
        })}
        {ticks
          .filter((t) => t.month !== axis.first && t.month % 12 === 0)
          .map((t) => (
            <line key={t.month} className="yr" x1={t.month - axis.first} x2={t.month - axis.first} y2={H} />
          ))}
      </svg>
      <span className="sr">{line}</span>
    </span>
  );
}

function useColumnPrefs(view: TableView, defs: Col<never>[]) {
  const [prefs, setPrefs] = useState<Partial<Record<TableView, ColumnPrefs>>>({});
  const current = prefs[view] ?? loadPrefs(view, defs);
  return {
    prefs: current,
    change: (next: ColumnPrefs | null) => {
      savePrefs(view, next);
      setPrefs((p) => ({ ...p, [view]: next ?? loadPrefs(view, defs) }));
    },
  };
}

export function TablePanel() {
  // Controls follow `now`; the rows follow `shown`, a moment later.
  const { now, shown: table, updating } = useTableView();
  const { model, filters, result, grouping, multi, active, view, layout, sorting } = table;
  const setView = useStore((s) => s.setView);
  const setLayout = useStore((s) => s.setPhotoLayout);
  const setFilters = useStore((s) => s.setFilters);
  const display = useStore((s) => s.display);
  const reset = useStore((s) => s.resetFilters);
  const drillDown = useStore((s) => s.drillDown);
  const setPhotoTag = useStore((s) => s.setPhotoTag);
  const back = useStore((s) => s.back);
  const goBack = useStore((s) => s.goBack);
  const checks = usePopover();
  const setSorting = useStore((s) => s.setSorting);
  const [tip, setTip] = useState<TipAt | null>(null);
  const setHighlight = useStore((s) => s.setHighlight);
  // A view or model change leaves no row lit on the map.
  useEffect(() => () => setHighlight(null), [view, model, setHighlight]);

  const ctx: TableContext = { model, display, totalDetections: result.detections.length };
  const tableView: TableView | null = view === 'charts' || (view === 'photos' && layout === 'grid') ? null : view;
  const defs = useMemo(
    () => (view === 'species' ? speciesColumns(ctx) : view === 'photos' ? photoColumns(ctx) : locationColumns(ctx)) as Col<never>[],
    [view, model, display, result],
  );
  const { prefs, change } = useColumnPrefs(view === 'charts' ? 'locations' : view, defs);
  const shown = shownColumns(prefs, defs, multi);
  const shownKey = shown.join('\n');
  const cols = useMemo(() => shown.map((id) => defs.find((d) => d.id === id)!), [shownKey, defs]);

  const rows = useMemo(() => {
    if (view === 'species') return speciesRows(model, result, grouping);
    if (view === 'photos') return photoRowsOf(model, result, filters.photoTag);
    return locationRows(model, result, grouping);
  }, [view, model, result, grouping, filters.photoTag]);
  // Every table walks one order: the one its header sorts by.
  const ordered = useMemo(
    () => (view === 'charts' ? [] : sortRows(rows as never[], cols, sorting[view])),
    [view, rows, cols, sorting],
  );
  const flags = useMemo(() => locationFlagger(model), [model]);
  // A location's flag opens Data checks beside it, on its own check.
  const flagAnchor = useRef<HTMLElement | null>(null);
  const [flagCheck, setFlagCheck] = useState<{ check: string; n: number } | null>(null);
  const openCheck = (flag: Flag, from: HTMLElement) => {
    const again = flagCheck?.check === flag.check && flagAnchor.current === from;
    flagAnchor.current = from;
    setFlagCheck(again ? null : { check: flag.check, n: (flagCheck?.n ?? 0) + 1 });
  };
  const axis = useMemo(() => monthAxis(model), [model]);
  const [sparkW, setSparkW] = useState(200);
  const ticks = useMemo(() => (axis ? axisTicks(axis, sparkW) : []), [axis, sparkW]);
  // The Activity column is camera effort; a species filter's photos sit inside it.
  const activityLegend = matchLegend(model, filters, false);
  const activity = useMemo(
    () => activityByLocation(model, result.effort, grouping.separate, activityLegend ? result.photos : []),
    [model, result, grouping, activityLegend],
  );

  // Grid, List and the detail view walk one order: the List's sort.
  const photoOrder = (view === 'photos' ? ordered : NO_PHOTOS) as PhotoRow[];
  const grid = useSteadyRows(model, photoOrder);
  // The panel keeps the model it opened with, so a background refresh never swaps the photo under it.
  const [detail, setDetail] = useState<{ model: typeof model; order: number[]; index: number; from: HTMLElement | null } | null>(null);
  const openDetail = (row: PhotoRow, from: HTMLElement | null) => {
    const shown = tableView ? { model, rows: photoOrder } : grid;
    setDetail({ model: shown.model, order: shown.rows.map((r) => r.photo), index: shown.rows.indexOf(row), from });
  };
  const closeDetail = () => {
    detail?.from?.focus({ preventScroll: true });
    setDetail(null);
  };

  // Grid and List each keep their own place in the page: back to where a
  // layout was, and one not scrolled yet starts at the table's top (the page
  // stays put when that is already in view). The table's top is where its
  // controls just reach their place under the filter bar, so they never move
  // on a switch. The new layout's virtualizer starts at that place too, so it
  // never scrolls back to the old one.
  const offsets = useRef<Record<PhotoLayout, number>>({ grid: 0, list: 0 });
  const restore = useRef<number | null>(null);
  // Bumped when Back sets `restore`, so the scroll is put back once its view has drawn.
  const [returned, setReturned] = useState(0);
  const tableTop = () => {
    const panel = document.getElementById('table')!;
    return panel.getBoundingClientRect().top + scrollY + panel.clientTop - (document.getElementById('sticky-top')?.offsetHeight ?? 0);
  };
  const switchLayout = (next: PhotoLayout) => {
    if (next === now.layout) return;
    const top = tableTop();
    offsets.current[layout] = Math.max(0, scrollY - top);
    const was = offsets.current[next];
    restore.current = Math.round(was > 0 ? top + was : Math.min(scrollY, Math.max(0, top)));
    setLayout(next);
  };
  useLayoutEffect(() => {
    const to = restore.current;
    // Once the table has caught up with the click.
    if (to === null || updating) return;
    restore.current = null;
    scrollTo(0, to);
    // Once more after the new rows have measured themselves and settled.
    const frame = requestAnimationFrame(() => scrollTo(0, to));
    return () => cancelAnimationFrame(frame);
  }, [layout, returned, updating]);
  const backHere = () => {
    restore.current = back!.scroll;
    setReturned((n) => n + 1);
    goBack();
  };

  const count =
    view === 'species'
      ? `${rows.length.toLocaleString('en-US')} species`
      : view === 'photos'
        ? plural(rows.length, 'photo')
        : view === 'charts'
          ? plural(result.detections.length, 'detection')
          : plural(rows.length, 'location');

  // The file lists the rows in the table's order.
  const exportCsv = () => {
    const csvCols = csvColumns(defs, shown, display);
    saveBlob(
      csvFileName(model.collections.map((c) => c.name), view, new Date()),
      new Blob([toCsv(csvCols, ordered)], { type: 'text/csv;charset=utf-8' }),
    );
  };

  const nothing = active && result.photos.length === 0;
  const unpicked = nothing ? noneTicked(model, filters, grouping.separate) : null;
  let body;
  if (nothing) {
    body = (
      <div className="empty">
        <h3>{unpicked ? `No ${LIST_NOUNS[unpicked]} selected` : 'No photos match these filters'}</h3>
        <div className="flex flex-wrap justify-center gap-2">
          {unpicked && (
            <button type="button" className="btn primary" onClick={() => setFilters((f) => clearFilter(f, unpicked))}>
              Select all
            </button>
          )}
          <button type="button" className={unpicked ? 'btn' : 'btn primary'} onClick={reset}>
            Reset filters
          </button>
        </div>
      </div>
    );
  } else if (view === 'charts') {
    body = (
      <Suspense fallback={<div className="charts" />}>
        <Charts />
      </Suspense>
    );
  } else if (!tableView) {
    body = (
      <>
        <PhotoGrid model={grid.model} rows={grid.rows} onOpen={openDetail} initialScroll={restore.current} />
        <div className="tbl-foot">
          {photoOrder.length
            ? `All ${photoOrder.length.toLocaleString('en-US')} shown`
            : `No ${filters.photoTag === 'tagged' ? 'tagged' : 'untagged'} photos here.`}
        </div>
      </>
    );
  } else if (tableView === 'locations') {
    body = (
      <DataTable<LocationRow>
        cols={cols as Col<LocationRow>[]}
        rows={ordered as LocationRow[]}
        sorting={now.sorting.locations}
        onSorting={(s) => setSorting('locations', s)}
        rowKey={(r) => r.key}
        rowClass={(r) => (flags(r).length ? 'flag' : undefined)}
        onRowHover={(r) => setHighlight(r && !r.noLocation ? r.sites : null)}
        head={(c) => (c.id === 'activity' && axis ? <ActivityHead ticks={ticks} onWidth={setSparkW} /> : undefined)}
        cell={(c, r) => {
          if (c.id === 'activity') {
            return axis ? (
              <ActivityCell axis={axis} ticks={ticks} row={r} months={activity.byKey.get(r.key)} max={activity.max} legend={activityLegend} onTip={setTip} />
            ) : (
              '—'
            );
          }
          if (c.id === 'coll' && r.collections.length > 1) {
            return <CollectionsCell names={r.collections.map((i) => model.collections[i].name)} />;
          }
          if (c.id !== 'name') return undefined;
          return (
            <>
              <span className="nm">{r.noLocation ? 'No location set' : r.name || '—'}</span>
              <FlagTags flags={flags(r)} onOpen={openCheck} />
            </>
          );
        }}
        action={{
          label: 'Actions',
          cell: (r) => (
            <button
              type="button"
              className="linkbtn text-[12px]"
              onClick={() => {
                const from = scrollY;
                // The photos start at the table's top; the page stays put when that is already in view.
                restore.current = Math.round(Math.min(from, Math.max(0, tableTop())));
                setReturned((n) => n + 1);
                drillDown(
                  `Showing photos from ${r.noLocation ? 'no location' : r.ids.join(', ')}`,
                  (s) => ({
                    ...s,
                    filters: { ...s.filters, locations: onlyLocations(model, [r.key]), photoTag: 'all' },
                    view: 'photos',
                  }),
                  from,
                );
              }}
            >
              Show photos
            </button>
          ),
        }}
        empty="No locations here."
      />
    );
  } else if (tableView === 'species') {
    body = (
      <DataTable<SpeciesRow>
        cols={cols as Col<SpeciesRow>[]}
        rows={ordered as SpeciesRow[]}
        sorting={now.sorting.species}
        onSorting={(s) => setSorting('species', s)}
        rowKey={(r) => model.species[r.species].key}
        cell={(c, r) => {
          if (c.id !== 'common') return undefined;
          const key = model.species[r.species].key;
          const on = soleSpecies(model, filters.species) === key;
          return (
            <button
              type="button"
              className="cellbtn nm"
              aria-pressed={on}
              onClick={() => setFilters((f) => toggleSpecies(model, f, key))}
            >
              {model.species[r.species].name}
            </button>
          );
        }}
        empty="No tagged species in these photos."
      />
    );
  } else {
    body = (
      <DataTable<PhotoRow>
        cols={cols as Col<PhotoRow>[]}
        rows={photoOrder}
        sorting={now.sorting.photos}
        onSorting={(s) => setSorting('photos', s)}
        rowKey={(r) => String(r.photo)}
        initialScroll={restore.current}
        cell={(c, r) => (c.id === 'species' && !r.species ? <span className="untag">Untagged</span> : undefined)}
        onRowClick={(r, tr) => openDetail(r, tr.querySelector<HTMLElement>('td.act button'))}
        action={{
          label: 'Open',
          cell: (r) => (
            <button type="button" className="linkbtn text-[12px]" onClick={(e) => openDetail(r, e.currentTarget)}>
              View
            </button>
          ),
        }}
        empty={`No ${filters.photoTag === 'tagged' ? 'tagged' : 'untagged'} photos here.`}
      />
    );
  }

  return (
    <section id="table" className="tablepanel panel" aria-label="Table" aria-busy={updating}>
      {/* One line that stays under the filter bar while the table scrolls. */}
      <div className="tbl-head">
        <div className="tbl-tools">
          {back && (
            <button type="button" className="btn backbtn" onClick={backHere}>
              <span aria-hidden="true">←</span> Back to {VIEW_NAMES[back.view]}
            </button>
          )}
          <Seg
            className="seg view-seg"
            label="Show"
            value={now.view}
            options={[
              ['locations', 'Locations'],
              ['species', 'Species'],
              ['photos', 'Photos'],
              ['charts', 'Charts'],
            ]}
            onChange={setView}
          />
          {now.view === 'photos' && (
            <>
              <Seg
                label="Layout"
                value={now.layout}
                options={[
                  ['grid', 'Grid'],
                  ['list', 'List'],
                ]}
                onChange={switchLayout}
              />
              <Seg
                label="Tagged"
                value={now.filters.photoTag}
                options={[
                  ['tagged', 'Tagged'],
                  ['untagged', 'Untagged'],
                  ['all', 'All'],
                ]}
                onChange={setPhotoTag}
              />
              {now.layout === 'grid' && (
                <Seg<'new' | 'old' | ''>
                  label="Order"
                  value={now.sorting.photos[0]?.id === 'time' ? (now.sorting.photos[0].desc ? 'new' : 'old') : ''}
                  options={[
                    ['new', 'Newest first'],
                    ['old', 'Oldest first'],
                  ]}
                  onChange={(order) => setSorting('photos', [{ id: 'time', desc: order === 'new' }])}
                />
              )}
            </>
          )}
          <span className="rowcount" aria-live="polite">
            {nothing ? '' : count}
          </span>
        </div>
        <div className="tbl-acts">
          <ColumnsEditor
            title={view === 'species' ? 'Species' : view === 'photos' ? 'Photos list' : 'Locations'}
            defs={defs}
            prefs={prefs}
            multi={multi}
            disabled={!tableView}
            onChange={change}
          />
          <button type="button" className="btn" disabled={view === 'charts'} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
      {view === 'locations' && grouping.separate && (
        <div className="subbar">
          <span className="state">Each location ID shown separately</span>
          <button ref={checks.anchor} type="button" className="linkbtn" aria-expanded={checks.open} onClick={checks.toggle}>
            Change in Data checks
          </button>
          {checks.open && <DataChecksPanel anchor={checks.anchor} onClose={checks.close} />}
        </div>
      )}
      <div className="tbl-wrap">{body}</div>
      {flagCheck && (
        <DataChecksPanel
          key={flagCheck.n}
          anchor={flagAnchor}
          focus={flagCheck.check}
          onClose={(refocus) => {
            setFlagCheck(null);
            if (refocus) flagAnchor.current?.focus({ preventScroll: true });
          }}
        />
      )}
      <Tip at={tip} />
      {detail && view === 'photos' && (
        <Suspense fallback={null}>
          <PhotoDetail
            model={detail.model}
            order={detail.order}
            index={detail.index}
            onIndex={(index) => setDetail({ ...detail, index })}
            onClose={closeDetail}
          />
        </Suspense>
      )}
    </section>
  );
}
