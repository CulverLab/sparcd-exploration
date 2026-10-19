import { describe, expect, it } from 'vitest';
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
  yearTicks,
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

  it('puts year labels at the first month and every January', () => {
    expect(yearTicks(monthAxis(model)!).map((t) => [t.year, t.at])).toEqual([
      [2023, 0],
      [2024, 2 / 16],
      [2025, 14 / 16],
    ]);
  });
});

describe('photos per month', () => {
  it('counts photos and untagged photos by camera-local month, leaving undated ones out', () => {
    expect([...countByMonth(model, filter(model).photos)]).toEqual([
      [NOV_2023, [2, 1]],
      [NOV_2023 + 2, [1, 1]],
      [NOV_2023 + 15, [1, 0]],
    ]);
  });

  it('per location for the Activity column, on the same axis', () => {
    const { byKey, max } = activityByLocation(model, filter(model).photos, false);
    expect([...byKey.get('id:AA01')!]).toEqual([
      [NOV_2023, [2, 1]],
      [NOV_2023 + 2, [1, 1]],
    ]);
    expect([...byKey.get('id:BB01')!]).toEqual([[NOV_2023 + 15, [1, 0]]]);
    expect(max).toBe(2);
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
