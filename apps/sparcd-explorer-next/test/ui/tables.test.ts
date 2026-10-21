import { describe, expect, it } from 'vitest';
import { locationRows, photoRows, speciesRows } from '../../src/data';
import { DEFAULT_SORTING } from '../../src/store';
import { compareCells, orderBy, photoTimeRanks, sortRows, tableOrder, timeKey, type Cell, type Col } from '../../src/lib/tables';
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
const DISPLAY = { coords: 'latlon' as const, precision: { method: 'round' as const, digits: 3 }, elevation: 'm' as const };

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

describe('the sort, fast at any size', () => {
  // The order it replaced: each pair compared, ties by their place.
  const reference = <R>(rows: R[], key: (r: R) => Cell, desc: boolean) =>
    rows
      .map((r, i) => ({ r, i, v: key(r) }))
      .sort((a, b) => (desc ? -1 : 1) * compareCells(a.v, b.v) || a.i - b.i)
      .map((x) => x.r);
  const pick = <T>(items: T[], n: number) => items[n % items.length];

  it('orders text, numbers and empty cells exactly as comparing each pair did', () => {
    const words = ['AB10', 'AB2', 'ab2', 'Ab3', 'Été', 'ete', 'b', 'B', '', 'AB02', 'AB-3', '7', '07', 'x y'];
    const text = Array.from({ length: 400 }, (_, i) => ({ i, v: i % 9 === 0 ? null : pick(words, (i * 7919) % 97) }));
    const numbers = Array.from({ length: 400 }, (_, i) => ({ i, v: i % 11 === 0 ? null : ((i * 7919) % 53) - 20.5 }));
    for (const rows of [text, numbers] as { i: number; v: Cell }[][]) {
      for (const desc of [false, true]) {
        expect(orderBy(rows, (r) => r.v, desc).map((r) => r.i)).toEqual(reference(rows, (r) => r.v, desc).map((r) => r.i));
      }
    }
  });

  it('sorts a set of rows once per column and direction', () => {
    expect(sortRows(rows, cols, [{ id: 'id', desc: false }])).toBe(sortRows(rows, cols, [{ id: 'id', desc: false }]));
    expect(sortRows(rows, cols, [{ id: 'id', desc: true }])).not.toBe(sortRows(rows, cols, [{ id: 'id', desc: false }]));
  });

  it('keys a date and time as one number that orders as its text does', () => {
    const times = ['2024-03-05 14:07:09', '2024-03-05', '2024-03-05 14:07', '2023-12-31 23:59:59', '2024-03-05 09:00:00', '2024-03-05 14:07:10'];
    const byText = [...times].sort((a, b) => compareCells(a, b));
    const byKey = [...times].sort((a, b) => timeKey(a)! - timeKey(b)!);
    expect(byKey).toEqual(byText);
    expect(timeKey('2024-03-05T14:07:09.250-07:00')).toBe(timeKey('2024-03-05 14:07:09'));
    expect([timeKey('05/03/2024'), timeKey(''), timeKey('2024-3-5')]).toEqual([null, null, null]);
  });

  it('ranks every photo by time once, and the Photos table sorts by it, text that isn\'t a time with the empty ones', () => {
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AB01', 'Ridge', 10, -100)],
        media: [
          media('u1', 'a.jpg', 'AB01', '2024-01-02T10:00:00'),
          media('u1', 'b.jpg', 'AB01', 'not a time'),
          media('u1', 'c.jpg', 'AB01', '2023-06-01T08:30:00'),
          media('u1', 'd.jpg', 'AB01', '2024-01-02T10:00:00'),
          media('u1', 'e.jpg', 'AB01', ''),
        ],
        observations: [],
      }),
    );
    expect(photoTimeRanks(model)).toBe(photoTimeRanks(model));
    const photoRowsOf = photoRows(model, model.photos.map((_, i) => i));
    const timeCol = tableOrder({ model, display: DISPLAY, totalDetections: 0 }, { ...DEFAULT_SORTING, photos: [{ id: 'time', desc: true }] }, false).photos;
    expect(timeCol(photoRowsOf).map((r) => r.fileName)).toEqual(['a.jpg', 'd.jpg', 'c.jpg', 'b.jpg', 'e.jpg']);
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
