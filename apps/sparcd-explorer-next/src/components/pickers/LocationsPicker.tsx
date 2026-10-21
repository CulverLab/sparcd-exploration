import { useMemo } from 'react';
import { NO_FILTERS, applyFilters, locationRows, onlyLocations, tick } from '@/data';
import { fmtN, formatElevation } from '@/lib/format';
import { locationFlagger } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ListPicker, tickedOf, useWithout } from './shared';

export function LocationsPicker() {
  const { model, filters, grouping, multi } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const unit = useStore((s) => s.display.elevation);
  const without = useWithout('locations');
  const all = useMemo(() => {
    const rows = locationRows(model, applyFilters(model, { ...NO_FILTERS, missing: 'show' }), grouping);
    const flags = locationFlagger(model);
    return rows
      .map((r) => ({ ...r, flags: flags(r) }))
      .sort((a, b) => Number(a.noLocation) - Number(b.noLocation) || a.ids[0].localeCompare(b.ids[0], undefined, { numeric: true }));
  }, [model, grouping]);
  const counts = useMemo(
    () => new Map(locationRows(model, without, grouping).map((r) => [r.key, r.photos])),
    [model, without, grouping],
  );
  const off = new Set(filters.locations.hidden);
  const siteKeys = (sites: number[]) => sites.map((i) => model.sites[i].key);
  return (
    <ListPicker
      title="Locations"
      search={{ label: 'Search locations', placeholder: 'Search ID or name' }}
      rows={all.map((r) => {
        const n = counts.get(r.key) ?? 0;
        const where = r.noLocation ? 'No map position' : [r.range, formatElevation(r.elevation, unit)].filter(Boolean).join(' · ');
        const ids = r.noLocation ? '0000' : r.ids.join(', ');
        return {
          key: r.key,
          name: r.noLocation ? 'No location set' : ids,
          title: (
            <>
              <span className="mono">{ids}</span> {r.noLocation ? 'No location set' : r.name}
              {r.flags.length > 0 && <span className="text-warn"> · {r.flags.map((f) => f.label).join(', ')}</span>}
            </>
          ),
          find: `${r.ids.join('\n')}\n${r.noLocation ? 'no location set' : r.name}`.toLowerCase(),
          count: fmtN(n),
          sub: multi ? `${r.collections.map((c) => model.collections[c].name).join(', ')} · ${where}` : where,
          zero: n === 0,
          ticked: tickedOf(off, siteKeys(r.sites)),
        };
      })}
      onTick={(picked, on) =>
        setFilters((f) => ({ ...f, locations: tick(f.locations, picked.flatMap((r) => siteKeys(all.find((a) => a.key === r.key)!.sites)), on) }))
      }
      onOnly={(r) => setFilters((f) => ({ ...f, locations: onlyLocations(model, [r.key]) }))}
    />
  );
}
