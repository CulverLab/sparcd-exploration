import { describe, expect, it } from 'vitest';
import { onlySpecies } from '../../src/data';
import { activityByLocation } from '../../src/lib/activity';
import {
  countByMonth,
  datesToMonths,
  monthAxis,
  monthIndex,
  monthKey,
  monthLabel,
  monthShade,
  monthsToDates,
  axisTicks,
  type MonthAxis,
} from '../../src/lib/months';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

// Two locations over Nov 2023 to Feb 2025, one photo undated.
const model = modelOf(
  collection()
    .upload('u1', {
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: [
        media('u1', 'a.jpg', 'AA01', '2023-11-03T10:00:00'),
        media('u1', 'b.jpg', 'AA01', '2023-11-20T22:00:00'),
        media('u1', 'c.jpg', 'AA01', '2024-01-01T00:30:00'),
        media('u1', 'x.jpg', 'AA01', 'not a date'),
      ],
      observations: [observation('u1', 'a.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
    })
    .upload('u2', {
      deployments: [deployment('BB01', 'Bravo', 12.9, -100.9)],
      media: [media('u2', 'd.jpg', 'BB01', '2025-02-28T23:59:00')],
      observations: [observation('u2', 'd.jpg', 'BB01', '', { common: 'Deer', scientific: 'Odocoileus hemionus' })],
    }),
);
const NOV_2023 = 2023 * 12 + 10;

describe('the shared month axis', () => {
  it('runs from the first month of the opened data to the last', () => {
    expect(monthAxis(model)).toEqual({ first: NOV_2023, count: 16 });
    expect(monthIndex('2023-11-03')).toBe(NOV_2023);
    expect(monthKey(NOV_2023)).toBe('2023-11');
    expect(monthLabel(NOV_2023 + 2)).toBe('Jan 2024');
  });

  it('puts year labels at the first month and every January when they fit', () => {
    expect(axisTicks(monthAxis(model)!, 640).map((t) => [t.year, t.x, t.anchor])).toEqual([
      [2023, 0, 'start'],
      [2024, 80, 'start'],
      [2025, 560, 'start'],
    ]);
  });
});

describe('year labels that fit the width', () => {
  // Jan 2013 to Dec 2026: 14 years.
  const years14: MonthAxis = { first: 2013 * 12, count: 168 };
  const years = (axis: MonthAxis, width: number) => axisTicks(axis, width).map((t) => t.year);
  const starts = (axis: MonthAxis, width: number) =>
    axisTicks(axis, width).map((t) => (t.anchor === 'end' ? width - 36 : t.x));

  it('labels every year when each gets 36 px', () => {
    expect(years(years14, 14 * 40)).toEqual([2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  });

  it('labels every second year when every year would crowd', () => {
    expect(years(years14, 14 * 30)).toEqual([2013, 2016, 2018, 2020, 2022, 2024, 2026]);
  });

  it('labels every fifth year when every second would crowd', () => {
    expect(years(years14, 200)).toEqual([2013, 2020, 2025]);
  });

  it('falls back to the first year and the last, the last ending at the axis end', () => {
    const forty: MonthAxis = { first: 1986 * 12 + 3, count: 40 * 12 };
    expect(axisTicks(forty, 150)).toEqual([
      { month: forty.first, year: 1986, x: 0, anchor: 'start' },
      { month: forty.first + forty.count - 1, year: 2026, x: 150, anchor: 'end' },
    ]);
  });

  it('keeps the first label and drops a January that would crowd it', () => {
    // Nov 2023 to Feb 2025 at 200 px: Jan 2024 sits 25 px in.
    expect(years(monthAxis(model)!, 200)).toEqual([2023, 2025]);
  });

  it('ends a label too near the axis end at the end', () => {
    expect(axisTicks(years14, 200).at(-1)).toMatchObject({ year: 2025, anchor: 'end' });
  });

  it('shows one label for a single year, or when two would not fit', () => {
    expect(years({ first: 2024 * 12 + 2, count: 6 }, 300)).toEqual([2024]);
    expect(years(years14, 60)).toEqual([2013]);
  });

  it('never puts two labels closer than 36 px, at any width', () => {
    for (const axis of [years14, monthAxis(model)!, { first: 1990 * 12 + 7, count: 400 }]) {
      for (let width = 60; width <= 1400; width += 37) {
        const xs = starts(axis, width);
        xs.slice(1).forEach((x, i) => expect(x - xs[i]).toBeGreaterThanOrEqual(36));
      }
    }
  });
});

describe('photos per month', () => {
  it('counts photos and untagged photos by camera-local month, leaving undated ones out', () => {
    expect([...countByMonth(model, filter(model).effort)]).toEqual([
      [NOV_2023, [2, 1, 0]],
      [NOV_2023 + 2, [1, 1, 0]],
      [NOV_2023 + 15, [1, 0, 0]],
    ]);
  });

  it('keeps camera effort as the bars under a species filter, and counts the matching photos inside them', () => {
    const bobcats = filter(model, { species: onlySpecies(model, ['Lynx rufus']) });
    expect([...countByMonth(model, bobcats.effort, bobcats.photos)]).toEqual([
      [NOV_2023, [2, 1, 1]],
      [NOV_2023 + 2, [1, 1, 0]],
      [NOV_2023 + 15, [1, 0, 0]],
    ]);
  });

  it('per location for the Activity column, on the same axis', () => {
    const { byKey, max } = activityByLocation(model, filter(model).effort, false);
    expect([...byKey.get('id:AA01')!]).toEqual([
      [NOV_2023, [2, 1, 0]],
      [NOV_2023 + 2, [1, 1, 0]],
    ]);
    expect([...byKey.get('id:BB01')!]).toEqual([[NOV_2023 + 15, [1, 0, 0]]]);
    expect(max).toBe(2);
  });

  it('per location under a species filter: every location keeps its effort, the matches sit inside', () => {
    const deer = filter(model, { species: onlySpecies(model, ['Odocoileus hemionus']) });
    const { byKey } = activityByLocation(model, deer.effort, false, deer.photos);
    expect([...byKey.get('id:AA01')!]).toEqual([
      [NOV_2023, [2, 1, 0]],
      [NOV_2023 + 2, [1, 1, 0]],
    ]);
    expect([...byKey.get('id:BB01')!]).toEqual([[NOV_2023 + 15, [1, 0, 1]]]);
  });

  it('shades busier months darker, from a quarter to full', () => {
    expect(monthShade(0, 10)).toBe(0.25);
    expect(monthShade(10, 10)).toBe(1);
    expect(monthShade(2, 10)).toBeLessThan(monthShade(5, 10));
  });
});

describe('months and the Dates filter', () => {
  it('turns a run of months into first and last days, whichever way it was dragged', () => {
    expect(monthsToDates(NOV_2023 + 3, NOV_2023)).toEqual({ dateFrom: '2023-11-01', dateTo: '2024-02-29' });
    expect(monthsToDates(NOV_2023, NOV_2023)).toEqual({ dateFrom: '2023-11-01', dateTo: '2023-11-30' });
  });

  it('turns a date range back into the months it touches, clamped to the axis', () => {
    const axis = monthAxis(model)!;
    expect(datesToMonths('2023-11-01', '2024-02-29', axis)).toEqual([NOV_2023, NOV_2023 + 3]);
    expect(datesToMonths('2024-01-15', null, axis)).toEqual([NOV_2023 + 2, NOV_2023 + 15]);
    expect(datesToMonths('2020-01-01', '2023-12-02', axis)).toEqual([NOV_2023, NOV_2023 + 1]);
    expect(datesToMonths(null, null, axis)).toBeNull();
    expect(datesToMonths('2030-01-01', null, axis)).toBeNull();
  });
});
