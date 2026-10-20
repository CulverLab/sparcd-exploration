import { describe, expect, it } from 'vitest';
import { NO_FILTERS, onlySpecies, toggleSpecies, type FilterState } from '../../src/data';
import {
  chartData,
  hourBar,
  hourCounts,
  linear,
  monthBar,
  monthCounts,
  niceTicks,
  speciesBar,
  speciesCounts,
  toggleHour,
  toggleMonth,
} from '../../src/lib/charts';
import { monthAxis } from '../../src/lib/months';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

const BOBCAT = { common: 'Bobcat', scientific: 'Lynx rufus' };
const DEER = { common: 'Deer', scientific: 'Odocoileus hemionus' };

// Times carry offsets the charts must ignore: 23:30 at -07:00 is still 23:30.
const model = modelOf(
  collection().upload('u1', {
    deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
    media: [
      media('u1', 'a.jpg', 'AA01', '2023-11-30T23:30:00-07:00'),
      media('u1', 'b.jpg', 'AA01', '2024-01-01T00:10:00Z'),
      media('u1', 'c.jpg', 'AA01', '2024-01-15T06:00:00'),
      media('u1', 'd.jpg', 'AA01', '2024-01-16'),
      media('u1', 'e.jpg', 'AA01', 'not a date'),
    ],
    observations: [
      observation('u1', 'a.jpg', 'AA01', '', BOBCAT),
      observation('u1', 'a.jpg', 'AA01', '', DEER),
      observation('u1', 'b.jpg', 'AA01', '', BOBCAT),
      observation('u1', 'c.jpg', 'AA01', '', BOBCAT),
      observation('u1', 'd.jpg', 'AA01', '', DEER),
      observation('u1', 'e.jpg', 'AA01', '', DEER),
    ],
  }),
);
const axis = monthAxis(model)!;
const NOV_2023 = 2023 * 12 + 10;
const state = (f: Partial<FilterState>): FilterState => ({ ...NO_FILTERS, ...f });

describe('chart scales', () => {
  it('tick in round steps from 0 to at least the largest bar', () => {
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(47)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('draw bars in proportion to their counts, from zero', () => {
    const x = linear(50, 200);
    expect([x(0), x(25), x(50)]).toEqual([0, 100, 200]);
  });
});

describe('chart bins', () => {
  const { detections } = filter(model);

  it('count detections by species, most first', () => {
    expect(speciesCounts(model, detections).map((s) => [model.species[s.species].name, s.detections])).toEqual([
      ['Bobcat', 3],
      ['Deer', 3],
    ]);
  });

  it('count detections by camera-local hour, never converted to UTC', () => {
    const hours = hourCounts(model, detections);
    expect(hours).toHaveLength(24);
    expect(hours[23]).toBe(2);
    expect(hours[0]).toBe(1);
    expect(hours[6]).toBe(1);
    // A date with no time has no hour; a timestamp that doesn't parse has neither.
    expect(hours.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('count detections by camera-local month along the shared axis', () => {
    expect(axis).toEqual({ first: NOV_2023, count: 3 });
    expect(monthCounts(model, detections, axis)).toEqual([2, 0, 3]);
  });

  it('leave each chart’s own filter out, so any bar can still be picked', () => {
    const data = chartData(model, state({ species: onlySpecies(model, ['Lynx rufus']), hours: [23, 23], dateFrom: '2024-01-01', dateTo: '2024-01-31' }), axis);
    // Species: January 2024, 23:00 → nothing. Hours: Bobcat in January. Months: Bobcat at 23:00.
    expect(data.species).toEqual([]);
    expect(data.hours[0] + data.hours[6]).toBe(2);
    expect(data.months).toEqual([1, 0, 0]);
  });
});

describe('clicking a bar', () => {
  it('filters to that species alone, and a second click lets it go', () => {
    const one = toggleSpecies(model, NO_FILTERS, 'Lynx rufus');
    expect(one.species).toEqual({ hidden: ['Odocoileus hemionus'], hideUntagged: true });
    expect(toggleSpecies(model, one, 'Lynx rufus').species).toEqual(NO_FILTERS.species);
    // Bobcat unticked among others: the click shows it alone.
    expect(toggleSpecies(model, state({ species: { hidden: ['Lynx rufus'], hideUntagged: false } }), 'Lynx rufus').species).toEqual(one.species);
  });

  it('filters to that hour, and a second click lets it go', () => {
    expect(toggleHour(NO_FILTERS, 5).hours).toEqual([5, 5]);
    expect(toggleHour(state({ hours: [5, 5] }), 5).hours).toBeNull();
    expect(toggleHour(state({ hours: [22, 4] }), 5).hours).toEqual([5, 5]);
  });

  it('sets that month as Dates, keeping hours, and a second click lets it go', () => {
    const jan = toggleMonth(state({ years: [2023], hours: [1, 2] }), NOV_2023 + 2);
    expect(jan).toMatchObject({ dateFrom: '2024-01-01', dateTo: '2024-01-31', years: [], hours: [1, 2] });
    expect(toggleMonth(jan, NOV_2023 + 2)).toMatchObject({ dateFrom: null, dateTo: null, hours: [1, 2] });
  });
});

describe('the active filter on the charts', () => {
  it('lights the species ticked and dims the unticked ones', () => {
    expect(speciesBar(NO_FILTERS, 'Lynx rufus')).toBeNull();
    expect(speciesBar(state({ species: onlySpecies(model, ['Lynx rufus']) }), 'Lynx rufus')).toBe('on');
    expect(speciesBar(state({ species: onlySpecies(model, ['Lynx rufus']) }), 'Odocoileus hemionus')).toBe('dim');
    expect(speciesBar(state({ species: { hidden: [], hideUntagged: true } }), 'Lynx rufus')).toBe('on');
  });

  it('lights the hours picked, past midnight too', () => {
    expect(hourBar(NO_FILTERS, 3)).toBeNull();
    expect([21, 23, 0, 4, 5].map((h) => hourBar(state({ hours: [22, 4] }), h))).toEqual(['dim', 'on', 'on', 'on', 'dim']);
  });

  it('lights the months the Dates filter keeps', () => {
    expect(monthBar(NO_FILTERS, NOV_2023, axis)).toBeNull();
    const jan = state({ dateFrom: '2024-01-01', dateTo: '2024-01-31' });
    expect([NOV_2023, NOV_2023 + 2].map((m) => monthBar(jan, m, axis))).toEqual(['dim', 'on']);
    expect(monthBar(state({ years: [2023] }), NOV_2023, axis)).toBe('on');
  });
});
