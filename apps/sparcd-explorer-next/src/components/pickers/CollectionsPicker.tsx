import { useMemo } from 'react';
import { fmtN, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow, Option, toggled, useWithout } from './shared';

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
  return (
    <>
      <div className="sect">
        <h3>Collections</h3>
      </div>
      <div className="opts">
        {model.collections.map((c, i) => (
          <Option
            key={c.key}
            checked={filters.collections.includes(c.key)}
            onChange={(on) => setFilters((f) => ({ ...f, collections: toggled(f.collections, c.key, on) }))}
            title={c.name}
            count={fmtN(counts[i].photos)}
            sub={plural(counts[i].locations.size, 'location')}
            zero={counts[i].photos === 0}
          />
        ))}
      </div>
      <ClearRow onClear={() => setFilters((f) => ({ ...f, collections: [] }))} />
    </>
  );
}
