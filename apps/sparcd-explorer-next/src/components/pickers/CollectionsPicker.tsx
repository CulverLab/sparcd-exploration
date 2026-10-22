import { useMemo } from 'react';
import { listKeys, only, tick } from '@/data';
import { fmtN, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ListPicker, useWithout } from './shared';

/** Photos and locations per collection, ignoring the Collections filter. */
export function useCollectionCounts() {
  const { model, grouping } = useView();
  const without = useWithout('collections');
  return useMemo(() => {
    const counts = model.collections.map(() => ({ photos: 0, locations: new Set<string>() }));
    for (const i of without.photos) {
      const p = model.photos[i];
      const site = model.sites[p.site];
      counts[p.collection].photos++;
      counts[p.collection].locations.add(grouping.separate ? site.key : site.groupKey);
    }
    return counts;
  }, [model, without, grouping]);
}

export function CollectionsPicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const counts = useCollectionCounts();
  const off = new Set(filters.collections.hidden);
  return (
    <ListPicker
      title="Collections"
      noun="collection"
      rows={model.collections.map((c, i) => ({
        key: c.key,
        name: c.name,
        title: c.name,
        count: fmtN(counts[i].photos),
        sub: plural(counts[i].locations.size, 'location'),
        zero: counts[i].photos === 0,
        ticked: !off.has(c.key),
      }))}
      onTick={(picked, on) => setFilters((f) => ({ ...f, collections: tick(f.collections, picked.map((r) => r.key), on) }))}
      onOnly={(r) => setFilters((f) => ({ ...f, collections: only(listKeys(model, 'collections'), [r.key]) }))}
    />
  );
}
