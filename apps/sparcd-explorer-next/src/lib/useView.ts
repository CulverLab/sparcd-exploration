// The filtered view every workspace part reads. `applyFilters` runs once per
// model and filter change, however many components ask.

import { useMemo } from 'react';
import { applyFilters, isFiltered, type FilterResult, type FilterState, type Model } from '@/data';
import { useStore } from '@/store';

let last: { model: Model; filters: FilterState; result: FilterResult } | null = null;

export function filtered(model: Model, filters: FilterState): FilterResult {
  if (last?.model !== model || last.filters !== filters) last = { model, filters, result: applyFilters(model, filters) };
  return last.result;
}

export function useView() {
  const model = useStore((s) => s.model)!;
  const filters = useStore((s) => s.filters);
  const separate = useStore((s) => s.separate);
  const result = filtered(model, filters);
  return useMemo(
    () => ({ model, filters, result, grouping: { separate }, multi: model.collections.length > 1, active: isFiltered(filters) }),
    [model, filters, result, separate],
  );
}
