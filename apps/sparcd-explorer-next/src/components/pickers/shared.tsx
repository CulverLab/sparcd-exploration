import { useMemo, useRef, useState, type ReactNode } from 'react';
import { applyFilters, clearFilter, type FilterDimension } from '@/data';
import { useView } from '@/lib/useView';
import { SearchField } from '../SearchField';

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
 * The rows a list shows: those with something under the other filters, and
 * your own choices, the smaller side of the ticks. Mostly ticked, the unticked
 * rows stay so you can tick them back; mostly unticked, the ticked ones stay
 * and the thousands of unticked ones with nothing in view don't.
 */
export function listedRows(rows: PickRow[]): PickRow[] {
  const on = rows.filter((r) => r.ticked === true).length;
  const off = rows.filter((r) => r.ticked === false).length;
  return rows.filter((r) => !r.zero || r.ticked === 'some' || (r.ticked ? on <= off : off <= on));
}

/**
 * A list with every item ticked to start. Each row has its checkbox and, with
 * more than one row listed, an Only button, shown on hover or focus (always on
 * touch screens). Select all and Clear all act on the whole list, or on the
 * matches while a search is on. A row listed since the picker opened stays
 * until it closes, so ticking one back doesn't take it from under the pointer.
 */
export function ListPicker({
  title,
  noun,
  search,
  rows,
  onTick,
  onOnly,
}: {
  title: string;
  /** One item, as "Pick at least one species" names it. */
  noun: string;
  search?: { label: string; placeholder: string };
  rows: PickRow[];
  onTick: (rows: PickRow[], on: boolean) => void;
  onOnly: (row: PickRow) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const seen = useRef(new Set<string>());
  for (const r of listedRows(rows)) seen.current.add(r.key);
  const listed = rows.filter((r) => seen.current.has(r.key));
  const searching = Boolean(search && q);
  const shown = searching ? listed.filter((r) => r.find?.includes(q)) : listed;
  const bulk = searching ? shown : rows;
  const id = `${title.toLowerCase().replace(/\W+/g, '-')}-search`;
  return (
    <>
      <div className="sect">
        <div className="row">
          <h3>{title}</h3>
          <div className="flex-1" />
          <button type="button" className="linkbtn text-[12px]" disabled={bulk.every((r) => r.ticked === true)} onClick={() => onTick(bulk, true)}>
            {searching ? 'Select matches' : 'Select all'}
          </button>
          <button type="button" className="linkbtn text-[12px]" disabled={bulk.every((r) => r.ticked === false)} onClick={() => onTick(bulk, false)}>
            {searching ? 'Clear matches' : 'Clear all'}
          </button>
        </div>
        {search && (
          <>
            <label className="sr" htmlFor={id}>
              {search.label}
            </label>
            <SearchField id={id} placeholder={search.placeholder} value={query} onChange={setQuery} />
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
            {listed.length > 1 && (
              <button type="button" className="only" aria-label={`Only ${r.name}`} onClick={() => onOnly(r)}>
                Only
              </button>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="fine px-1 py-2">{searching ? 'Nothing matches that search.' : 'Nothing in view here.'}</p>}
      </div>
      {rows.every((r) => r.ticked === false) && (
        <p className="fine" role="status">
          Pick at least one {noun}
        </p>
      )}
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

/** Whether every key is ticked, none is, or only some. */
export function tickedOf(hidden: ReadonlySet<string>, keys: string[]): boolean | 'some' {
  const off = keys.filter((k) => hidden.has(k)).length;
  return off === 0 ? true : off === keys.length ? false : 'some';
}
