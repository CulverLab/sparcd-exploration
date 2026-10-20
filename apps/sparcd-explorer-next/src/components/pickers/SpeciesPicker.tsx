import { useMemo } from 'react';
import { onlySpecies, tickSpecies } from '@/data';
import { fmtN } from '@/lib/format';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ListPicker, useWithout, type PickRow } from './shared';

/** The row for photos with no species, set apart above the species. */
const UNTAGGED = '\0untagged';

export function SpeciesPicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const without = useWithout('species');
  const counts = useMemo(() => {
    const n = new Map<number, number>();
    for (const d of without.detections) {
      const s = model.detections[d].species;
      n.set(s, (n.get(s) ?? 0) + 1);
    }
    let untagged = 0;
    for (const i of without.photos) if (!model.photos[i].tagged) untagged++;
    return { n, untagged };
  }, [model, without]);
  const { hidden, hideUntagged } = filters.species;
  const off = new Set(hidden);
  const rows: PickRow[] = [
    {
      key: UNTAGGED,
      name: 'Untagged photos',
      title: 'Untagged photos',
      find: 'untagged photos',
      count: fmtN(counts.untagged),
      zero: counts.untagged === 0,
      ticked: !hideUntagged,
      apart: true,
    },
    ...model.species
      .map((s, i) => ({ ...s, n: counts.n.get(i) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
      .map((s) => ({
        key: s.key,
        name: s.name,
        title: s.name,
        sub: s.scientificName && s.scientificName !== s.name ? s.scientificName : undefined,
        find: `${s.name}\n${s.scientificName}`.toLowerCase(),
        count: fmtN(s.n),
        zero: s.n === 0,
        ticked: !off.has(s.key),
      })),
  ];
  const species = (picked: PickRow[]) => picked.filter((r) => r.key !== UNTAGGED).map((r) => r.key);
  return (
    <ListPicker
      title="Species"
      search={{ label: 'Search species', placeholder: 'Search common or scientific name' }}
      rows={rows}
      onTick={(picked, on) =>
        setFilters((f) => ({ ...f, species: tickSpecies(f.species, species(picked), picked.some((r) => r.key === UNTAGGED), on) }))
      }
      onOnly={(r) =>
        setFilters((f) => ({ ...f, species: r.key === UNTAGGED ? onlySpecies(model, [], true) : onlySpecies(model, [r.key]) }))
      }
    />
  );
}
