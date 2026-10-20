import { useMemo, useState, type ReactNode } from 'react';
import { applyFilters, clearFilter, type FilterDimension } from '@/data';
import { useView } from '@/lib/useView';

/** What every filter but `dim` keeps, so each option's count says what picking it gives. */
export function useWithout(dim: FilterDimension) {
  const { model, filters } = useView();
  return useMemo(() => applyFilters(model, clearFilter(filters, dim)), [model, filters, dim]);
}

export type PickRow = {
  key: string;
  /** Plain words for the row's Only button: "Only Bobcat". */
  name: string;
  title: ReactNode;
  sub?: ReactNode;
  count?: string;
  zero?: boolean;
  /** Lowercase text a search matches against. */
  find?: string;
  /** `some` when only part of the row is ticked, as a location ID with one of its sites unticked. */
  ticked: boolean | 'some';
  /** A rule under the row, setting it apart from the list below. */
  apart?: boolean;
};

/**
 * A list with every item ticked to start. Each row has its checkbox and an
 * Only button, shown on hover or focus (always on touch screens); Select all
 * and Clear all act on the rows a search leaves showing.
 */
export function ListPicker({
  title,
  search,
  rows,
  onTick,
  onOnly,
}: {
  title: string;
  search?: { label: string; placeholder: string };
  rows: PickRow[];
  onTick: (rows: PickRow[], on: boolean) => void;
  onOnly: (row: PickRow) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = search && q ? rows.filter((r) => r.find?.includes(q)) : rows;
  const id = `${title.toLowerCase().replace(/\W+/g, '-')}-search`;
  return (
    <>
      <div className="sect">
        <div className="row">
          <h3>{title}</h3>
          <div className="flex-1" />
          <button type="button" className="linkbtn text-[12px]" disabled={shown.every((r) => r.ticked === true)} onClick={() => onTick(shown, true)}>
            Select all
          </button>
          <button type="button" className="linkbtn text-[12px]" disabled={shown.every((r) => r.ticked === false)} onClick={() => onTick(shown, false)}>
            Clear all
          </button>
        </div>
        {search && (
          <>
            <label className="sr" htmlFor={id}>
              {search.label}
            </label>
            <input
              id={id}
              className="field"
              type="search"
              placeholder={search.placeholder}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </>
        )}
      </div>
      <div className="opts">
        {shown.map((r) => (
          <div key={r.key} className={['opt', r.zero && 'zero', r.apart && 'apart'].filter(Boolean).join(' ')}>
            <label>
              <input
                type="checkbox"
                checked={r.ticked === true}
                ref={(box) => {
                  if (box) box.indeterminate = r.ticked === 'some';
                }}
                onChange={(e) => onTick([r], e.target.checked)}
              />
              <span className="t">{r.title}</span>
              {r.count !== undefined && <span className="c">{r.count}</span>}
              {r.sub && <span className="s">{r.sub}</span>}
            </label>
            <button type="button" className="only" aria-label={`Only ${r.name}`} onClick={() => onOnly(r)}>
              Only
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="fine px-1 py-2">Nothing matches that search.</p>}
      </div>
    </>
  );
}

export function ClearRow({ onClear, label = 'Clear' }: { onClear: () => void; label?: string }) {
  return (
    <div className="row">
      <div className="flex-1" />
      <button type="button" className="btn sm" onClick={onClear}>
        {label}
      </button>
    </div>
  );
}

export const toggled = <T,>(list: T[], value: T, on: boolean): T[] =>
  on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value);

/** Whether every key is ticked, none is, or only some. */
export function tickedOf(hidden: ReadonlySet<string>, keys: string[]): boolean | 'some' {
  const off = keys.filter((k) => hidden.has(k)).length;
  return off === 0 ? true : off === keys.length ? false : 'some';
}
