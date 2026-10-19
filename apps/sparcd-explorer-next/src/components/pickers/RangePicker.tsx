import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ClearRow, Option, toggled } from './shared';

export function RangePicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const locations = new Map<string, Set<string>>();
  for (const s of model.sites) {
    if (!s.range) continue;
    if (!locations.has(s.range)) locations.set(s.range, new Set());
    locations.get(s.range)!.add(s.groupKey);
  }
  return (
    <>
      <div className="sect">
        <h3>Mountain range</h3>
      </div>
      <div className="opts">
        {[...locations].sort(([a], [b]) => a.localeCompare(b)).map(([range, keys]) => (
          <Option
            key={range}
            checked={filters.ranges.includes(range)}
            onChange={(on) => setFilters((f) => ({ ...f, ranges: toggled(f.ranges, range, on) }))}
            title={range}
            count={`${keys.size} loc.`}
          />
        ))}
      </div>
      <ClearRow onClear={() => setFilters((f) => ({ ...f, ranges: [] }))} />
    </>
  );
}
