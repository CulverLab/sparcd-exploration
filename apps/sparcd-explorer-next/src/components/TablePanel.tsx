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
  type LocationRow,
  type PhotoRow,
  type SpeciesRow,
} from '@/data';
import { activityByLocation } from '@/lib/activity';
import { LIST_NOUNS, matchLegend, noneTicked } from '@/lib/filterLabels';
import { barFill, monthAxis, monthLabel, yearTicks, type MonthAxis, type MonthCounts } from '@/lib/months';
import { loadPrefs, savePrefs, shownColumns, type ColumnPrefs } from '@/lib/columnPrefs';
import { csvColumns, csvFileName, toCsv } from '@/lib/csv';
import { saveBlob } from '@/lib/download';
import { fmtN, plural } from '@/lib/format';
import { locationColumns, locationFlagger, photoColumns, sortRows, speciesColumns, type Col, type TableContext } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore, type PhotoLayout, type TableView } from '@/store';
import { ColumnsEditor } from './ColumnsEditor';
import { DataChecksPanel } from './DataChecks';
import { DataTable } from './DataTable';
import { PhotoGrid } from './PhotoGrid';
import { Seg, usePopover } from './Popover';
import { Tip, type TipAt } from './Tip';
import { Charts, PhotoDetail } from './later';

function ActivityHead({ axis }: { axis: MonthAxis }) {
  return (
    <span className="axhead">
      <span>Activity</span>
      <span className="yaxis" aria-hidden="true">
        {yearTicks(axis).map((t) => (
          <Fragment key={t.year}>
            <i style={{ left: `${t.at * 100}%` }} />
            <span style={t.at > 0.84 ? { right: 0, paddingLeft: 0 } : { left: `${t.at * 100}%` }}>{t.year}</span>
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
  row,
  months,
  max,
  legend,
  onTip,
}: {
  axis: MonthAxis;
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
        {yearTicks(axis)
          .filter((t) => t.month !== axis.first)
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
  const { model, filters, result, grouping, multi, active } = useView();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const layout = useStore((s) => s.photoLayout);
  const setLayout = useStore((s) => s.setPhotoLayout);
  const setFilters = useStore((s) => s.setFilters);
  const display = useStore((s) => s.display);
  const reset = useStore((s) => s.resetFilters);
  const withUndo = useStore((s) => s.withUndo);
  const checks = usePopover();
  const sorting = useStore((s) => s.sorting);
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
    if (view === 'photos') return photoRows(model, photosForTag(model, result.photos, filters.photoTag), result.detections);
    return locationRows(model, result, grouping);
  }, [view, model, result, grouping, filters.photoTag]);
  const flags = useMemo(() => locationFlagger(model), [model]);
  const axis = useMemo(() => monthAxis(model), [model]);
  // The Activity column is camera effort; a species filter's photos sit inside it.
  const activityLegend = matchLegend(model, filters, false);
  const activity = useMemo(
    () => activityByLocation(model, result.effort, grouping.separate, activityLegend ? result.photos : []),
    [model, result, grouping, activityLegend],
  );

  // Grid, List and the detail view walk one order: the List's sort.
  const photoOrder = useMemo(
    () => (view === 'photos' ? sortRows(rows as PhotoRow[], cols as Col<PhotoRow>[], sorting.photos) : []),
    [view, rows, cols, sorting.photos],
  );
  // The panel keeps the model it opened with, so a background refresh never swaps the photo under it.
  const [detail, setDetail] = useState<{ model: typeof model; order: number[]; index: number; from: HTMLElement | null } | null>(null);
  const openDetail = (row: PhotoRow, from: HTMLElement | null) =>
    setDetail({ model, order: photoOrder.map((r) => r.photo), index: photoOrder.indexOf(row), from });
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
  const switchLayout = (next: PhotoLayout) => {
    if (next === layout) return;
    const panel = document.getElementById('table')!;
    const top = panel.getBoundingClientRect().top + scrollY + panel.clientTop - (document.getElementById('sticky-top')?.offsetHeight ?? 0);
    offsets.current[layout] = Math.max(0, scrollY - top);
    const back = offsets.current[next];
    restore.current = Math.round(back > 0 ? top + back : Math.min(scrollY, Math.max(0, top)));
    setLayout(next);
  };
  useLayoutEffect(() => {
    const to = restore.current;
    if (to === null) return;
    restore.current = null;
    scrollTo(0, to);
    // Once more after the new rows have measured themselves and settled.
    const frame = requestAnimationFrame(() => scrollTo(0, to));
    return () => cancelAnimationFrame(frame);
  }, [layout]);

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
    const sorted = view === 'photos' ? photoOrder : sortRows(rows as never[], cols, sorting[view as TableView]);
    saveBlob(
      csvFileName(model.collections.map((c) => c.name), view, new Date()),
      new Blob([toCsv(csvCols, sorted as never[])], { type: 'text/csv;charset=utf-8' }),
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
        <PhotoGrid model={model} rows={photoOrder} onOpen={openDetail} initialScroll={restore.current} />
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
        rows={rows as LocationRow[]}
        sorting={sorting.locations}
        onSorting={(s) => setSorting('locations', s)}
        rowKey={(r) => r.key}
        rowClass={(r) => (flags(r).length ? 'flag' : undefined)}
        onRowHover={(r) => setHighlight(r && !r.noLocation ? r.sites : null)}
        head={(c) => (c.id === 'activity' && axis ? <ActivityHead axis={axis} /> : undefined)}
        cell={(c, r) => {
          if (c.id === 'activity') {
            return axis ? (
              <ActivityCell axis={axis} row={r} months={activity.byKey.get(r.key)} max={activity.max} legend={activityLegend} onTip={setTip} />
            ) : (
              '—'
            );
          }
          if (c.id !== 'name') return undefined;
          const f = flags(r);
          return (
            <>
              <span className="nm">{r.noLocation ? 'No location set' : r.name || '—'}</span>
              {f.length > 0 && <span className="tag">{f.join(' · ')}</span>}
            </>
          );
        }}
        action={{
          label: 'Actions',
          cell: (r) => (
            <button
              type="button"
              className="linkbtn text-[12px]"
              onClick={() =>
                withUndo(`Showing photos from ${r.noLocation ? 'no location' : r.ids.join(', ')}`, (s) => ({
                  ...s,
                  filters: { ...s.filters, locations: onlyLocations(model, [r.key]), photoTag: 'all' },
                  view: 'photos',
                }))
              }
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
        rows={rows as SpeciesRow[]}
        sorting={sorting.species}
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
        rows={rows as PhotoRow[]}
        sorting={sorting.photos}
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
    <section id="table" className="tablepanel panel" aria-label="Table">
      {/* One line that stays under the filter bar while the table scrolls. */}
      <div className="tbl-head">
        <div className="tbl-tools">
          <Seg
            className="seg view-seg"
            label="Show"
            value={view}
            options={[
              ['locations', 'Locations'],
              ['species', 'Species'],
              ['photos', 'Photos'],
              ['charts', 'Charts'],
            ]}
            onChange={setView}
          />
          {view === 'photos' && (
            <>
              <Seg
                label="Layout"
                value={layout}
                options={[
                  ['grid', 'Grid'],
                  ['list', 'List'],
                ]}
                onChange={switchLayout}
              />
              <Seg
                label="Tagged"
                value={filters.photoTag}
                options={[
                  ['tagged', 'Tagged'],
                  ['untagged', 'Untagged'],
                  ['all', 'All'],
                ]}
                onChange={(photoTag) => setFilters((f) => ({ ...f, photoTag }))}
              />
              {layout === 'grid' && (
                <Seg<'new' | 'old' | ''>
                  label="Order"
                  value={sorting.photos[0]?.id === 'time' ? (sorting.photos[0].desc ? 'new' : 'old') : ''}
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
