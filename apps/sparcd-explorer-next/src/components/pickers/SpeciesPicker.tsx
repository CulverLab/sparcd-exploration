import { useMemo, useState } from 'react';
import { fmtN } from '@/lib/format';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { Seg } from '../Popover';
import { ClearRow, Option, toggled, useWithout } from './shared';

export function SpeciesPicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const without = useWithout('species');
  const [search, setSearch] = useState('');
  const counts = useMemo(() => {
    const n = new Map<number, number>();
    for (const d of without.detections) {
      const s = model.detections[d].species;
      n.set(s, (n.get(s) ?? 0) + 1);
    }
    return n;
  }, [model, without]);
  const q = search.trim().toLowerCase();
  const list = model.species
    .map((s, i) => ({ ...s, n: counts.get(i) ?? 0 }))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.scientificName.toLowerCase().includes(q))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const picked = filters.species.length;
  return (
    <>
      <div className="sect">
        <div className="row">
          <h3>Species</h3>
          <div className="flex-1" />
          <Seg
            label="Filter mode"
            value={filters.speciesMode}
            options={[
              ['only', 'Show only these'],
              ['hide', 'Hide these'],
            ]}
            onChange={(speciesMode) => setFilters((f) => ({ ...f, speciesMode }))}
          />
        </div>
        <label className="sr" htmlFor="sp-search">
          Search species
        </label>
        <input
          id="sp-search"
          className="field"
          type="search"
          placeholder="Search common or scientific name"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="opts">
        {list.map((s) => (
          <Option
            key={s.key}
            checked={filters.species.includes(s.key)}
            onChange={(on) => setFilters((f) => ({ ...f, species: toggled(f.species, s.key, on) }))}
            title={s.name}
            count={fmtN(s.n)}
            sub={s.scientificName && s.scientificName !== s.name ? s.scientificName : undefined}
            zero={s.n === 0}
          />
        ))}
        {list.length === 0 && <p className="fine px-1 py-2">No species match that search.</p>}
      </div>
      <ClearRow
        note={
          picked
            ? `${filters.speciesMode === 'only' ? 'Showing only' : 'Hiding'} ${picked} species`
            : `${model.species.length} species`
        }
        onClear={() => setFilters((f) => ({ ...f, species: [], speciesMode: 'only' }))}
      />
    </>
  );
}
