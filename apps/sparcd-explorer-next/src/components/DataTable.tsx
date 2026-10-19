import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from '@tanstack/react-table';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { cellText, type Cell, type Col } from '@/lib/tables';

function compare<R>(a: Row<R>, b: Row<R>, id: string): number {
  const x = a.getValue<Cell>(id);
  const y = b.getValue<Cell>(id);
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1;
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
}

export type DataTableProps<R> = {
  cols: Col<R>[];
  rows: R[];
  sorting: SortingState;
  onSorting: (s: SortingState) => void;
  rowKey: (r: R) => string;
  rowClass?: (r: R) => string | undefined;
  /** The row under the pointer or holding focus, or null when none is. */
  onRowHover?: (r: R | null) => void;
  /** A cell drawn by the caller instead of its text. */
  cell?: (c: Col<R>, r: R) => ReactNode | undefined;
  /** A header drawn by the caller instead of its label. */
  head?: (c: Col<R>) => ReactNode | undefined;
  /** A last column of per-row actions. */
  action?: { label: string; cell: (r: R) => ReactNode };
  empty: string;
};

/**
 * Every table: sortable headers that stay under the sticky filter bar while
 * the page scrolls, and rows drawn only near the viewport (no paging).
 */
export function DataTable<R>({ cols, rows, sorting, onSorting, rowKey, rowClass, onRowHover, cell, head, action, empty }: DataTableProps<R>) {
  const columns = useMemo<ColumnDef<R, Cell>[]>(
    () =>
      cols.map((c) => ({
        id: c.id,
        accessorFn: (r: R) => c.value(r),
        enableSorting: c.sortable !== false,
        sortDescFirst: Boolean(c.numeric),
        sortingFn: compare,
      })),
    [cols],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (u) => onSorting(typeof u === 'function' ? u(sorting) : u),
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: rowKey,
  });
  const sorted = table.getRowModel().rows;
  const colById = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols]);

  const tableRef = useRef<HTMLTableElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const top = (bodyRef.current?.getBoundingClientRect().top ?? 0) + scrollY;
    if (Math.abs(top - margin) > 1) setMargin(top);
  });
  const virtualizer = useWindowVirtualizer({ count: sorted.length, estimateSize: () => 34, overscan: 12, scrollMargin: margin });
  const items = virtualizer.getVirtualItems();
  const before = items.length ? items[0].start - margin : 0;
  const after = items.length ? virtualizer.getTotalSize() - (items[items.length - 1].end - margin) : 0;

  // Column headers ride under the sticky bar while the table scrolls past, even
  // though a wide table scrolls sideways in its own box.
  useEffect(() => {
    const stick = () => {
      const t = tableRef.current;
      const bar = document.getElementById('sticky-top');
      if (!t || !bar || !t.tHead) return;
      const r = t.getBoundingClientRect();
      const off = Math.min(Math.max(bar.getBoundingClientRect().bottom - r.top, 0), Math.max(0, r.height - t.tHead.offsetHeight - 80));
      t.style.setProperty('--hy', `${off}px`);
    };
    stick();
    addEventListener('scroll', stick, { passive: true });
    addEventListener('resize', stick);
    return () => {
      removeEventListener('scroll', stick);
      removeEventListener('resize', stick);
    };
  }, [rows]);

  const span = cols.length + (action ? 1 : 0);
  return (
    <>
      <table ref={tableRef} className="data">
        <thead>
          <tr>
            {table.getHeaderGroups()[0].headers.map((h) => {
              const c = colById.get(h.id)!;
              const dir = h.column.getIsSorted();
              const label = head?.(c) ?? c.label;
              return (
                <th
                  key={h.id}
                  className={c.numeric ? 'n' : undefined}
                  aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  title={c.title}
                >
                  {h.column.getCanSort() ? (
                    <button type="button" onClick={h.column.getToggleSortingHandler()}>
                      {label}
                      {dir && (
                        <span className="arr" aria-hidden="true">
                          {dir === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="th">{label}</span>
                  )}
                </th>
              );
            })}
            {action && (
              <th className="act">
                <span className="th">
                  <span className="sr">{action.label}</span>
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {before > 0 && (
            <tr aria-hidden="true">
              <td className="spacer" colSpan={span} style={{ height: before }} />
            </tr>
          )}
          {items.map((item) => {
            const row = sorted[item.index];
            const r = row.original;
            const extra = rowClass?.(r);
            return (
              <tr
                key={row.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={extra}
                onPointerEnter={onRowHover && (() => onRowHover(r))}
                onPointerLeave={onRowHover && (() => onRowHover(null))}
                onFocus={onRowHover && (() => onRowHover(r))}
                onBlur={onRowHover && ((e) => !e.currentTarget.contains(e.relatedTarget) && onRowHover(null))}
              >
                {cols.map((c) => (
                  <td key={c.id} className={[c.numeric && 'n', c.mono && 'm', c.italic && 'sci'].filter(Boolean).join(' ') || undefined}>
                    {cell?.(c, r) ?? cellText(c, r)}
                  </td>
                ))}
                {action && <td className="act">{action.cell(r)}</td>}
              </tr>
            );
          })}
          {after > 0 && (
            <tr aria-hidden="true">
              <td className="spacer" colSpan={span} style={{ height: after }} />
            </tr>
          )}
        </tbody>
      </table>
      <div className="tbl-foot">{sorted.length ? `All ${sorted.length.toLocaleString('en-US')} shown` : empty}</div>
    </>
  );
}
