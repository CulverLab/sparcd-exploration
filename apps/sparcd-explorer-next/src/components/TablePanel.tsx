import { Fragment, useMemo, useState } from 'react';
import type { SortingState } from '@tanstack/react-table';
import { locationRows, photoRows, photosForTag, speciesRows, type LocationRow, type PhotoRow, type SpeciesRow } from '@/data';
import { activityByLocation, monthAxis, type MonthAxis } from '@/lib/activity';
import { loadPrefs, savePrefs, shownColumns, type ColumnPrefs } from '@/lib/columnPrefs';
import { csvColumns, csvFileName, toCsv } from '@/lib/csv';
import { plural } from '@/lib/format';
import { locationColumns, locationFlagger, photoColumns, speciesColumns, type Col, type TableContext } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore, type View } from '@/store';
import { ColumnsEditor } from './ColumnsEditor';
import { DataChecksPanel } from './DataChecks';
import { DataTable } from './DataTable';
import { Seg, usePopover } from './Popover';

type TableView = Exclude<View, 'charts'>;

const DEFAULT_SORT: Record<TableView, SortingState> = {
  locations: [{ id: 'id', desc: false }],
  species: [{ id: 'dets', desc: true }],
  photos: [{ id: 'time', desc: true }],
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const YEAR = 12;

function ActivityHead({ axis }: { axis: MonthAxis }) {
  const ticks: { pct: number; year: number }[] = [];
  for (let m = axis.first; m < axis.first + axis.count; m++) {
    if (m % YEAR === 0 || m === axis.first) ticks.push({ pct: ((m - axis.first) / axis.count) * 100, year: Math.floor(m / YEAR) });
  }
  return (
    <span className="axhead">
      <span>Activity</span>
      <span className="yaxis" aria-hidden="true">
        {ticks.map((t) => (
          <Fragment key={t.year}>
            <i style={{ left: `${t.pct}%` }} />
            <span style={t.pct > 84 ? { right: 0, paddingLeft: 0 } : { left: `${t.pct}%` }}>{t.year}</span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}

function ActivityCell({ axis, months, max }: { axis: MonthAxis; months?: Map<number, [number, number]>; max: number }) {
  const H = 14;
  return (
    <svg className="spark" viewBox={`0 0 ${axis.count} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <rect width={axis.count} height={H} fill="var(--ruleSoft)" opacity={0.6} />
      {[...(months ?? [])].map(([m, [n, untagged]]) => (
        <g key={m}>
          <rect
            x={m - axis.first}
            width={1}
            height={H}
            fill={`color-mix(in srgb, var(--accent) ${Math.round((0.25 + 0.75 * Math.sqrt(n / max)) * 100)}%, var(--accentSoft))`}
          />
          {untagged > 0 && <rect x={m - axis.first} y={H - Math.max(2, (H * untagged) / n)} width={1} height={Math.max(2, (H * untagged) / n)} fill="var(--warn)" />}
        </g>
      ))}
    </svg>
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
  const [sorting, setSorting] = useState(DEFAULT_SORT);

  const ctx: TableContext = { model, display, totalDetections: result.detections.length };
  const tableView: TableView | null = view === 'charts' || (view === 'photos' && layout === 'grid') ? null : view;
  const defs = useMemo(
    () => (view === 'species' ? speciesColumns(ctx) : view === 'photos' ? photoColumns(ctx) : locationColumns(ctx)) as Col<never>[],
    [view, model, display, result],
  );
  const { prefs, change } = useColumnPrefs(view === 'charts' ? 'locations' : view, defs);
  const shown = shownColumns(prefs, defs, multi);
  const cols = shown.map((id) => defs.find((d) => d.id === id)!);

  const rows = useMemo(() => {
    if (view === 'species') return speciesRows(model, result, grouping);
    if (view === 'photos') return photoRows(model, photosForTag(model, result.photos, filters.photoTag), result.detections);
    return locationRows(model, result, grouping);
  }, [view, model, result, grouping, filters.photoTag]);
  const flags = useMemo(() => locationFlagger(model), [model]);
  const axis = useMemo(() => monthAxis(model), [model]);
  const activity = useMemo(() => activityByLocation(model, result.photos, grouping.separate), [model, result, grouping]);

  const count =
    view === 'species'
      ? `${rows.length.toLocaleString('en-US')} species`
      : view === 'photos'
        ? plural(rows.length, 'photo')
        : view === 'charts'
          ? plural(result.detections.length, 'detection')
          : plural(rows.length, 'location');

  const exportCsv = () => {
    const csvCols = csvColumns(defs, shown, display);
    download(csvFileName(model.collections.map((c) => c.name), view, new Date()), toCsv(csvCols, rows as never[]));
  };

  const nothing = active && result.photos.length === 0;
  let body;
  if (nothing) {
    body = (
      <div className="empty">
        <h3>No photos match these filters</h3>
        <button type="button" className="btn primary" onClick={reset}>
          Reset filters
        </button>
      </div>
    );
  } else if (!tableView) {
    body = (
      <div className="empty">
        <p className="fine">{view === 'charts' ? 'Charts' : 'The photo grid'} arrive in a later build.</p>
      </div>
    );
  } else if (tableView === 'locations') {
    body = (
      <DataTable<LocationRow>
        cols={cols as Col<LocationRow>[]}
        rows={rows as LocationRow[]}
        sorting={sorting.locations}
        onSorting={(s) => setSorting((all) => ({ ...all, locations: s }))}
        rowKey={(r) => r.key}
        rowClass={(r) => (flags(r).length ? 'flag' : undefined)}
        head={(c) => (c.id === 'activity' && axis ? <ActivityHead axis={axis} /> : undefined)}
        cell={(c, r) => {
          if (c.id === 'activity') return axis ? <ActivityCell axis={axis} months={activity.byKey.get(r.key)} max={activity.max} /> : '—';
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
                  filters: { ...s.filters, locations: [r.key], photoTag: 'all' },
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
        onSorting={(s) => setSorting((all) => ({ ...all, species: s }))}
        rowKey={(r) => model.species[r.species].key}
        cell={(c, r) => {
          if (c.id !== 'common') return undefined;
          const key = model.species[r.species].key;
          const on = filters.speciesMode === 'only' && filters.species.length === 1 && filters.species[0] === key;
          return (
            <button
              type="button"
              className="cellbtn nm"
              aria-pressed={on}
              onClick={() => setFilters((f) => (on ? { ...f, species: [] } : { ...f, species: [key], speciesMode: 'only' }))}
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
        onSorting={(s) => setSorting((all) => ({ ...all, photos: s }))}
        rowKey={(r) => String(r.photo)}
        cell={(c, r) => (c.id === 'species' && !r.species ? <span className="untag">Untagged</span> : undefined)}
        empty={`No ${filters.photoTag === 'tagged' ? 'tagged' : 'untagged'} photos here.`}
      />
    );
  }

  return (
    <section id="table" className="tablepanel panel" aria-label="Table">
      <div className="tbl-head">
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
        <span className="rowcount" aria-live="polite">
          {nothing ? '' : count}
        </span>
        <div className="flex-1" />
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
      {view === 'photos' && (
        <div className="subbar">
          <Seg
            label="Layout"
            value={layout}
            options={[
              ['grid', 'Grid'],
              ['list', 'List'],
            ]}
            onChange={setLayout}
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
        </div>
      )}
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
    </section>
  );
}
