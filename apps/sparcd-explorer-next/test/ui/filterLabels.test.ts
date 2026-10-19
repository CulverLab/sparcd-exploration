import { describe, expect, it } from 'vitest';
import { NO_FILTERS, type FilterState } from '../../src/data';
import { filterButtons, filterWords, locationLabel, matchLegend, photoCountLabel } from '../../src/lib/filterLabels';
import { collection, deployment, media, modelOf, observation } from '../support/fixtures';

const alpha = collection('Alpha', 'aaa').upload('u1', {
  deployments: [deployment('AA01', 'Spring', 12.5, -100.25, 1000)],
  media: [media('u1', 'a.jpg', 'AA01', '2023-01-01T10:00:00')],
  observations: [
    observation('u1', 'a.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
    observation('u1', 'a.jpg', 'AA01', '', { common: 'Coyote', scientific: 'Canis latrans' }),
  ],
});
const bravo = collection('Bravo', 'bbb').upload('u1', {
  deployments: [deployment('0000', '', null, null)],
  media: [media('u1', 'b.jpg', '0000', '2024-01-01T10:00:00')],
});
const single = modelOf(alpha);
const both = modelOf([alpha, bravo]);

const labels = (f: Partial<FilterState>, model = single, unit: 'm' | 'ft' = 'm') =>
  filterButtons(model, { ...NO_FILTERS, ...f }, unit).map((b) => b.label);

describe('filter button labels', () => {
  it('read the filter names while nothing is filtered', () => {
    expect(labels({})).toEqual(['Species', 'Locations', 'Dates', 'Elevation', 'Mountain range']);
    expect(filterButtons(single, NO_FILTERS, 'm').every((b) => !b.active)).toBe(true);
  });

  it('show Collections only with several collections open, and Area only while one is selected', () => {
    expect(labels({}, both)[0]).toBe('Collections');
    expect(labels({ collections: ['sparcd-bbb::bbb'] }, both)[0]).toBe('Collections: Bravo');
    expect(labels({ area: [single.sites[0].key] })).toContain('Area: 1 location');
  });

  it('name the first value and count the rest', () => {
    expect(labels({ species: ['Lynx rufus'] })[0]).toBe('Species: Bobcat');
    expect(labels({ species: ['Lynx rufus', 'Canis latrans'] })[0]).toBe('Species: Bobcat +1');
    expect(labels({ species: ['Lynx rufus'], speciesMode: 'hide' })[0]).toBe('Hiding: Bobcat');
    expect(labels({ locations: ['id:AA01', 'none'] })[1]).toBe('Locations: AA01 +1');
    expect(labels({ ranges: ['BBB', 'AAA'] })[4]).toBe('Mountain range: AAA +1');
  });

  it('say "No location set" for the no-location key', () => {
    expect(locationLabel(both, 'none')).toBe('No location set');
    expect(locationLabel(both, both.sites[0].key)).toBe('AA01');
  });

  it('show date ranges by month when they cover whole months', () => {
    expect(labels({ dateFrom: '2023-09-01', dateTo: '2025-09-30' })[2]).toBe('Dates: Sep 2023 – Sep 2025');
    expect(labels({ dateFrom: '2023-09-01', dateTo: '2023-09-30' })[2]).toBe('Dates: Sep 2023');
    expect(labels({ dateFrom: '2023-09-01' })[2]).toBe('Dates: from Sep 2023');
    expect(labels({ dateTo: '2024-02-29' })[2]).toBe('Dates: until Feb 2024');
    expect(labels({ dateFrom: '2023-09-14', dateTo: '2023-10-01' })[2]).toBe('Dates: 2023-09-14 – 2023-10-01');
  });

  it('show years, then how many more date filters there are', () => {
    expect(labels({ years: [2024, 2023] })[2]).toBe('Dates: 2023, 2024');
    expect(labels({ years: [2022, 2023, 2024] })[2]).toBe('Dates: 3 years');
    expect(labels({ dateFrom: '2023-09-01', years: [2024] })[2]).toBe('Dates: from Sep 2023 +1');
    expect(labels({ hours: [22, 4] })[2]).toBe('Dates: hours 22:00–04:59');
  });

  it('show elevation in the chosen unit', () => {
    expect(labels({ elevation: [1000, 2000] })[3]).toBe('Elevation: 1,000–2,000 m');
    expect(labels({ elevation: [1000, 2000] }, single, 'ft')[3]).toBe('Elevation: 3,281–6,562 ft');
  });
});

describe('photo count', () => {
  it('reads the total, or what is in view of the total', () => {
    expect(photoCountLabel(7235, 7235, false)).toBe('7,235 photos');
    expect(photoCountLabel(2104, 7235, true)).toBe('2,104 of 7,235 photos');
    expect(photoCountLabel(1, 1, false)).toBe('1 photo');
  });
});

describe('the inner bars’ legend', () => {
  const legend = (f: Partial<FilterState>, tagShown = true) => matchLegend(single, { ...NO_FILTERS, ...f }, tagShown);

  it('names what a species filter keeps', () => {
    expect(legend({})).toBeNull();
    expect(legend({ species: ['Lynx rufus', 'Canis latrans'] })).toBe('Bobcat +1');
    expect(legend({ species: ['Lynx rufus'], speciesMode: 'hide' })).toBe('Without Bobcat');
  });

  it('names the tag switch only while the Photos view shows it', () => {
    expect(legend({ photoTag: 'tagged' })).toBe('Tagged');
    expect(legend({ photoTag: 'untagged', species: ['Lynx rufus'] })).toBe('Bobcat, Untagged');
    expect(legend({ photoTag: 'tagged' }, false)).toBeNull();
  });
});

describe('the filters in words, for a report', () => {
  const words = (f: Partial<FilterState>, model = single, unit: 'm' | 'ft' = 'm') => filterWords(model, { ...NO_FILTERS, ...f }, unit);

  it('say so when nothing is filtered', () => {
    expect(words({})).toBe('No filters: all photos');
    expect(words({ photoTag: 'tagged' })).toBe('No filters: all photos');
  });

  it("name the Photos view's tag switch while that view shows", () => {
    const shown = (f: Partial<FilterState>) => filterWords(single, { ...NO_FILTERS, ...f }, 'm', false, true);
    expect(shown({ photoTag: 'tagged' })).toBe('Tagged photos only');
    expect(shown({ photoTag: 'untagged', species: ['Lynx rufus'] })).toBe('Species: Bobcat · Untagged photos only');
    expect(shown({ photoTag: 'all' })).toBe('No filters: all photos');
  });

  it('list every value in full, in the order of the filter bar', () => {
    expect(words({ species: ['Lynx rufus', 'Canis latrans'], dateFrom: '2023-09-01', dateTo: '2025-09-30' })).toBe(
      'Species: Bobcat, Coyote · Dates: Sep 2023 – Sep 2025',
    );
    expect(words({ species: ['Lynx rufus'], speciesMode: 'hide' })).toBe('Hiding species: Bobcat');
    expect(words({ collections: ['sparcd-bbb::bbb'], locations: ['id:AA01', 'none'] }, both)).toBe(
      'Collections: Bravo · Locations: AA01, No location set',
    );
  });

  it('spell out the map area, years, months, hours, elevation and mountain ranges', () => {
    expect(
      words(
        {
          area: [single.sites[0].key],
          years: [2024, 2023],
          months: [12, 1],
          hours: [22, 4],
          elevation: [1000, 1500],
          ranges: ['BBB', 'AAA'],
        },
        single,
        'ft',
      ),
    ).toBe('Map area: 1 location · Years: 2023, 2024 · Months: Jan, Dec · Hours: 22:00–04:59 · Elevation: 3,281–4,921 ft · Mountain range: AAA, BBB');
    expect(words({ dateFrom: '2023-09-14' })).toBe('Dates: from 2023-09-14');
  });
});
