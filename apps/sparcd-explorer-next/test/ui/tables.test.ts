import { describe, expect, it } from 'vitest';
import { locationRows, photoRows, speciesRows } from '../../src/data';
import { DEFAULT_SORTING } from '../../src/store';
import { sortRows, tableOrder, type Col } from '../../src/lib/tables';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

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

describe('the order downloads and the report follow', () => {
  const model = modelOf(
    collection('Alpha', 'aaa')
      .upload('u1', {
        deployments: [deployment('AB10', 'Wash', 12.5, -100.25)],
        media: [media('u1', 'a.jpg', 'AB10', '2023-01-01T10:00:00'), media('u1', 'b.jpg', 'AB10', '2023-01-02T10:00:00')],
        observations: [observation('u1', 'a.jpg', 'AB10', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
      })
      .upload('u2', {
        deployments: [deployment('AB2', 'Spring', 12.6, -100.3)],
        media: [media('u2', 'c.jpg', 'AB2', '2024-01-01T10:00:00')],
        observations: [
          observation('u2', 'c.jpg', 'AB2', '', { common: 'Coyote', scientific: 'Canis latrans' }),
          observation('u2', 'c.jpg', 'AB2', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
        ],
      }),
  );
  const result = filter(model);
  const display = { coords: 'latlon' as const, precision: { method: 'round' as const, digits: 3 }, elevation: 'm' as const };
  const order = (sorting = DEFAULT_SORTING) => tableOrder({ model, display, totalDetections: 3 }, sorting, false);

  it("is each table's sort, as the page opens", () => {
    const o = order();
    expect(o.locations(locationRows(model, result, { separate: false })).map((r) => r.ids[0])).toEqual(['AB2', 'AB10']);
    expect(o.species(speciesRows(model, result, { separate: false })).map((r) => model.species[r.species].name)).toEqual(['Bobcat', 'Coyote']);
    expect(o.photos(photoRows(model, result.photos)).map((r) => r.fileName)).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);
  });

  it('follows a sort the person chose', () => {
    const o = order({ ...DEFAULT_SORTING, locations: [{ id: 'photos', desc: true }], photos: [{ id: 'time', desc: false }] });
    expect(o.locations(locationRows(model, result, { separate: false })).map((r) => r.ids[0])).toEqual(['AB10', 'AB2']);
    expect(o.photos(photoRows(model, result.photos)).map((r) => r.fileName)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('leaves rows as they come for a sort on a column the table does not show, as the table does', () => {
    const rows = photoRows(model, result.photos);
    expect(order({ ...DEFAULT_SORTING, photos: [{ id: 'file', desc: true }] }).photos(rows)).toBe(rows);
  });
});
