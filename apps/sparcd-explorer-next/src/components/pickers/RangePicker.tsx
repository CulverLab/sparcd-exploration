import { listKeys, only, tick } from '@/data';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { ListPicker } from './shared';

export function RangePicker() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const locations = new Map<string, Set<string>>();
  for (const s of model.sites) {
    if (!s.range) continue;
    if (!locations.has(s.range)) locations.set(s.range, new Set());
    locations.get(s.range)!.add(s.groupKey);
  }
  const off = new Set(filters.ranges.hidden);
  return (
    <ListPicker
      title="Mountain range"
      noun="mountain range"
      rows={listKeys(model, 'ranges').map((range) => ({
        key: range,
        name: range,
        title: range,
        count: `${locations.get(range)!.size} loc.`,
        ticked: !off.has(range),
      }))}
      onTick={(picked, on) => setFilters((f) => ({ ...f, ranges: tick(f.ranges, picked.map((r) => r.key), on) }))}
      onOnly={(r) => setFilters((f) => ({ ...f, ranges: only(listKeys(model, 'ranges'), [r.key]) }))}
    />
  );
}
