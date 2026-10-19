import { useMemo, useState } from 'react';
import { NO_FILTERS, applyFilters, locationRows } from '@/data';
import { fmtN, formatElevation } from '@/lib/format';
import { locationFlagger } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow, Option, toggled, useWithout } from './shared';

export function LocationsPicker() {
  const { model, filters, grouping, multi } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const unit = useStore((s) => s.display.elevation);
  const without = useWithout('locations');
  const [search, setSearch] = useState('');
  const all = useMemo(() => {
    const rows = locationRows(model, applyFilters(model, NO_FILTERS), grouping);
    const flags = locationFlagger(model);
    return rows
      .map((r) => ({ ...r, flags: flags(r) }))
      .sort((a, b) => Number(a.noLocation) - Number(b.noLocation) || a.ids[0].localeCompare(b.ids[0], undefined, { numeric: true }));
  }, [model, grouping]);
  const counts = useMemo(
    () => new Map(locationRows(model, without, grouping).map((r) => [r.key, r.photos])),
    [model, without, grouping],
  );
  const q = search.trim().toLowerCase();
  const shown = all.filter((r) => !q || r.ids.some((id) => id.toLowerCase().includes(q)) || r.name.toLowerCase().includes(q));
  return (
    <>
      <div className="sect">
        <h3>Locations</h3>
        <label className="sr" htmlFor="loc-search">
          Search locations
        </label>
        <input
          id="loc-search"
          className="field"
          type="search"
          placeholder="Search ID or name"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="opts">
        {shown.map((r) => {
          const n = counts.get(r.key) ?? 0;
          const where = r.noLocation ? 'No map position' : [r.range, formatElevation(r.elevation, unit)].filter(Boolean).join(' · ');
          return (
            <Option
              key={r.key}
              checked={filters.locations.includes(r.key)}
              onChange={(on) => setFilters((f) => ({ ...f, locations: toggled(f.locations, r.key, on) }))}
              title={
                <>
                  <span className="mono">{r.noLocation ? '0000' : r.ids.join(', ')}</span> {r.noLocation ? 'No location set' : r.name}
                  {r.flags.length > 0 && <span className="text-warn"> · {r.flags.join(', ')}</span>}
                </>
              }
              count={fmtN(n)}
              sub={multi ? `${r.collections.map((c) => model.collections[c].name).join(', ')} · ${where}` : where}
              zero={n === 0}
            />
          );
        })}
      </div>
      <ClearRow onClear={() => setFilters((f) => ({ ...f, locations: [] }))} />
    </>
  );
}
