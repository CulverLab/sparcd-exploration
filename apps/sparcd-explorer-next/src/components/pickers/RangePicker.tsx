import { useMemo } from 'react';
import { NO_LOCATION_NAME, listKeys, locationKeyOf, only, tick } from '@/data';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ListPicker, useWithout } from './shared';

export function RangePicker() {
  const { model, filters, grouping } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const without = useWithout('ranges');
  const locations = useMemo(() => {
    const perRange = new Map<string, Set<string>>();
    for (const i of without.photos) {
      const site = model.sites[model.photos[i].site];
      const seen = perRange.get(site.range);
      if (seen) seen.add(locationKeyOf(site, grouping.separate));
      else perRange.set(site.range, new Set([locationKeyOf(site, grouping.separate)]));
    }
    return perRange;
  }, [model, without, grouping]);
  const off = new Set(filters.ranges.hidden);
  return (
    <ListPicker
      title="Mountain range"
      noun="mountain range"
      rows={listKeys(model, 'ranges').map((range) => {
        const n = locations.get(range)?.size ?? 0;
        return {
          key: range,
          name: range || NO_LOCATION_NAME,
          title: range || NO_LOCATION_NAME,
          count: `${n} loc.`,
          zero: n === 0,
          ticked: !off.has(range),
        };
      })}
      onTick={(picked, on) => setFilters((f) => ({ ...f, ranges: tick(f.ranges, picked.map((r) => r.key), on) }))}
      onOnly={(r) => setFilters((f) => ({ ...f, ranges: only(listKeys(model, 'ranges'), [r.key]) }))}
    />
  );
}
