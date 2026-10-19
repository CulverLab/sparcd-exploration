import { describe, expect, it } from 'vitest';
import { sortRows, type Col } from '../../src/lib/tables';

type Row = { id: string; n: number | null };
const cols: Col<Row>[] = [
  { id: 'id', label: 'ID', def: true, value: (r) => r.id },
  { id: 'n', label: 'N', def: true, numeric: true, value: (r) => r.n },
];
const rows: Row[] = [
  { id: 'AB10', n: 2 },
  { id: 'AB2', n: null },
  { id: 'AB1', n: 2 },
  { id: 'AB3', n: 5 },
];
const ids = (sorted: Row[]) => sorted.map((r) => r.id);

describe('one table order for the grid, the list and the detail view', () => {
  it('sorts text naturally and numbers by value, empty first going up and last going down', () => {
    expect(ids(sortRows(rows, cols, [{ id: 'id', desc: false }]))).toEqual(['AB1', 'AB2', 'AB3', 'AB10']);
    expect(ids(sortRows(rows, cols, [{ id: 'n', desc: false }]))).toEqual(['AB2', 'AB10', 'AB1', 'AB3']);
    expect(ids(sortRows(rows, cols, [{ id: 'n', desc: true }]))).toEqual(['AB3', 'AB10', 'AB1', 'AB2']);
  });

  it('keeps ties in their own order either way', () => {
    expect(ids(sortRows(rows, cols, [{ id: 'n', desc: true }])).slice(1, 3)).toEqual(['AB10', 'AB1']);
  });

  it('leaves the rows as they are for a column not shown', () => {
    expect(sortRows(rows, cols, [{ id: 'gone', desc: false }])).toBe(rows);
    expect(sortRows(rows, cols, [])).toBe(rows);
  });
});
