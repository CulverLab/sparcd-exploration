import { useMemo, type ReactNode } from 'react';
import { applyFilters, clearFilter, type FilterDimension } from '@/data';
import { useView } from '@/lib/useView';

/** What every filter but `dim` keeps, so each option's count says what picking it gives. */
export function useWithout(dim: FilterDimension) {
  const { model, filters } = useView();
  return useMemo(() => applyFilters(model, clearFilter(filters, dim)), [model, filters, dim]);
}

export function Option({
  checked,
  onChange,
  title,
  count,
  sub,
  zero,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  count?: string;
  sub?: ReactNode;
  zero?: boolean;
}) {
  return (
    <label className={zero ? 'opt zero' : 'opt'}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="t">{title}</span>
      {count !== undefined && <span className="c">{count}</span>}
      {sub && <span className="s">{sub}</span>}
    </label>
  );
}

export function ClearRow({ onClear, label = 'Clear', note }: { onClear: () => void; label?: string; note?: string }) {
  return (
    <div className="row">
      {note && <span className="fine">{note}</span>}
      <div className="flex-1" />
      <button type="button" className="btn sm" onClick={onClear}>
        {label}
      </button>
    </div>
  );
}

export const toggled = <T,>(list: T[], value: T, on: boolean): T[] =>
  on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value);
