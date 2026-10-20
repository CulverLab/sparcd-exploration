import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeFilters, clearFilter, listKeys, only, onlyLocations, onlySpecies, resetFilters, type FilterState } from '../../src/data';
import { filterButtons, filterWords, matchLegend, noneTicked, photoCountLabel } from '../../src/lib/filterLabels';
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

// Seven locations in seven mountain ranges, one species each, and one untagged photo.
const SEVEN = [
  ['AA01', 'Bobcat', 'Lynx rufus'],
  ['BB01', 'Coyote', 'Canis latrans'],
  ['CC01', 'Mule Deer', 'Odocoileus hemionus'],
  ['DD01', 'Gray Fox', 'Urocyon cinereoargenteus'],
  ['EE01', 'Javelina', 'Pecari tajacu'],
  ['FF01', 'Raven', 'Corvus corax'],
  ['GG01', 'Skunk', 'Mephitis mephitis'],
];
const wide = modelOf(
  collection('Wide', 'www').upload('u1', {
    deployments: SEVEN.map(([id], i) => deployment(id, `Site ${i}`, 10 + i, -100 - i)),
    media: [...SEVEN.map(([id], i) => media('u1', `${i}.jpg`, id, '2024-01-01T10:00:00')), media('u1', 'blank.jpg', 'AA01', '2024-01-02T10:00:00')],
    observations: SEVEN.map(([id, common, scientific], i) => observation('u1', `${i}.jpg`, id, '', { common, scientific })),
  }),
);
const sci = (...names: string[]) => names.map((n) => SEVEN.find((r) => r[1] === n)![2]);
const hiding = (...names: string[]) => ({ hidden: sci(...names), hideUntagged: false });

const labels = (f: Partial<FilterState>, model = single, unit: 'm' | 'ft' = 'm') =>
  filterButtons(model, { ...NO_FILTERS, ...f }, unit).map((b) => b.label);

describe('filter button labels', () => {
  it('read the filter names while nothing is filtered', () => {
    expect(labels({})).toEqual(['Species', 'Locations', 'Dates', 'Elevation', 'Mountain range']);
    expect(filterButtons(single, NO_FILTERS, 'm').every((b) => !b.active)).toBe(true);
  });

  it('show Collections only with several collections open, and Area only while one is selected', () => {
    expect(labels({}, both)[0]).toBe('Collections');
    expect(labels({ collections: only(listKeys(both, 'collections'), ['sparcd-bbb::bbb']) }, both)[0]).toBe('Collections: Bravo');
    expect(labels({ area: [single.sites[0].key] })).toContain('Area: 1 location');
  });
});

describe('list filter labels', () => {
  const species = (f: FilterState['species']) => labels({ species: f }, wide)[0];

  it('name one or two species ticked', () => {
    expect(species(onlySpecies(wide, sci('Bobcat')))).toBe('Species: Bobcat');
    expect(species(onlySpecies(wide, sci('Bobcat', 'Coyote')))).toBe('Species: Bobcat, Coyote');
  });

  it('name one or two species unticked', () => {
    expect(species(hiding('Gray Fox'))).toBe('Species: all but Gray Fox');
    expect(species(hiding('Gray Fox', 'Raven'))).toBe('Species: all but Gray Fox, Raven');
  });

  it('count them otherwise', () => {
    expect(species(onlySpecies(wide, sci('Bobcat', 'Coyote', 'Raven')))).toBe('Species: 3 of 7');
    expect(species(hiding('Bobcat', 'Coyote', 'Raven'))).toBe('Species: 4 of 7');
  });

  it('count "Untagged photos" only when it is all that is unticked, or ticked', () => {
    expect(species({ hidden: [], hideUntagged: true })).toBe('Species: no untagged');
    expect(species({ ...hiding('Gray Fox'), hideUntagged: true })).toBe('Species: all but Gray Fox');
    expect(species(onlySpecies(wide, sci('Bobcat'), true))).toBe('Species: Bobcat');
    expect(species(onlySpecies(wide, [], true))).toBe('Species: untagged only');
  });

  it('say none when nothing at all is ticked', () => {
    expect(species(onlySpecies(wide, []))).toBe('Species: none');
    expect(noneTicked(wide, { ...NO_FILTERS, species: onlySpecies(wide, []) })).toBe('species');
    expect(noneTicked(wide, { ...NO_FILTERS, species: onlySpecies(wide, [], true) })).toBeNull();
    expect(noneTicked(wide, NO_FILTERS)).toBeNull();
  });

  it('read the filter name again once everything is ticked', () => {
    const b = filterButtons(wide, { ...NO_FILTERS, species: { hidden: [], hideUntagged: false } }, 'm')[0];
    expect(b).toMatchObject({ label: 'Species', active: false });
  });

  it('follow the same rules for locations, by location ID', () => {
    const locations = (f: FilterState['locations']) => labels({ locations: f }, wide)[1];
    expect(locations(onlyLocations(wide, ['id:AA01', 'id:BB01']))).toBe('Locations: AA01, BB01');
    expect(locations(onlyLocations(wide, ['id:AA01', 'id:BB01', 'id:CC01', 'id:DD01', 'id:EE01', 'id:FF01']))).toBe(
      'Locations: all but GG01',
    );
    expect(locations(onlyLocations(wide, ['id:AA01', 'id:BB01', 'id:CC01']))).toBe('Locations: 3 of 7');
    expect(locations(onlyLocations(wide, []))).toBe('Locations: none');
    expect(labels({ locations: onlyLocations(both, ['none']) }, both)[2]).toBe('Locations: No location set');
  });

  it('say when a location has only some of its sites ticked', () => {
    // AA01 at two sites; with IDs shown separately, one of them is unticked.
    const c = collection('Two', 'ttt');
    (
      [
        ['AA01', 'North', 12.5],
        ['AA01', 'South', 12.6],
        ['BB01', 'Wash', 13.5],
        ['CC01', 'Flat', 14.5],
        ['DD01', 'Dune', 15.5],
        ['EE01', 'Mesa', 16.5],
      ] as const
    ).forEach(([id, name, lat], i) =>
      c.upload(`u${i}`, { deployments: [deployment(id, name, lat, -100.25)], media: [media(`u${i}`, `${name}.jpg`, id, '2024-01-01T10:00:00')] }),
    );
    const two = modelOf(c);
    const site = (name: string) => two.sites.find((s) => s.name === name)!.key;
    const f = (...hidden: string[]): FilterState => ({ ...NO_FILTERS, locations: { hidden: hidden.map(site) } });
    const button = (state: FilterState, separate = false) => filterButtons(two, state, 'm', separate)[1];

    expect(button(f('North'), true).label).toBe('Locations: all but AA01');
    expect(button(f('North'))).toMatchObject({ label: 'Locations: all but part of AA01', active: true });
    expect(filterWords(two, f('North'), 'm')).toBe('Locations: all but part of AA01');
    expect(button(f('North', 'Flat')).label).toBe('Locations: all but CC01, part of AA01');
    expect(button(f('South', 'Wash', 'Flat', 'Dune')).label).toBe('Locations: EE01, part of AA01');
    expect(button(f('North', 'Wash', 'Flat', 'Dune', 'Mesa')).label).toBe('Locations: part of AA01');
    expect(noneTicked(two, f('North', 'Wash', 'Flat', 'Dune', 'Mesa'))).toBeNull();
    // The × and Reset clear it.
    expect(activeFilters(clearFilter(f('North'), 'locations'))).toEqual([]);
    expect(activeFilters(resetFilters(f('North')).state)).toEqual([]);
  });

  it('follow the same rules for mountain ranges and collections', () => {
    const ranges = (keep: string[]) => labels({ ranges: only(listKeys(wide, 'ranges'), keep) }, wide)[4];
    expect(ranges(['BB0', 'AA0'])).toBe('Mountain range: AA0, BB0');
    expect(ranges(['AA0', 'BB0', 'CC0', 'DD0', 'EE0', 'FF0'])).toBe('Mountain range: all but GG0');
    expect(ranges(['AA0', 'BB0', 'CC0'])).toBe('Mountain range: 3 of 7');
    expect(labels({ collections: { hidden: ['sparcd-aaa::aaa'] } }, both)[0]).toBe('Collections: Bravo');
    expect(labels({ collections: { hidden: ['sparcd-aaa::aaa', 'sparcd-bbb::bbb'] } }, both)[0]).toBe('Collections: none');
  });
});

describe('date and elevation labels', () => {
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
  const legend = (f: Partial<FilterState>, tagShown = true) => matchLegend(wide, { ...NO_FILTERS, ...f }, tagShown);

  it('names what a species filter keeps', () => {
    expect(legend({})).toBeNull();
    expect(legend({ species: onlySpecies(wide, sci('Bobcat', 'Coyote')) })).toBe('Bobcat, Coyote');
    expect(legend({ species: hiding('Bobcat') })).toBe('All but Bobcat');
  });

  it('names the tag switch only while the Photos view shows it', () => {
    expect(legend({ photoTag: 'tagged' })).toBe('Tagged');
    expect(legend({ photoTag: 'untagged', species: onlySpecies(wide, sci('Bobcat')) })).toBe('Bobcat, Untagged');
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
    expect(shown({ photoTag: 'untagged', species: onlySpecies(single, ['Lynx rufus']) })).toBe('Species: Bobcat · Untagged photos only');
    expect(shown({ photoTag: 'all' })).toBe('No filters: all photos');
  });

  it('use the button’s words, in the order of the filter bar', () => {
    expect(words({ species: onlySpecies(wide, sci('Bobcat', 'Coyote')), dateFrom: '2023-09-01', dateTo: '2025-09-30' }, wide)).toBe(
      'Species: Bobcat, Coyote · Dates: Sep 2023 – Sep 2025',
    );
    expect(words({ species: hiding('Gray Fox') }, wide)).toBe('Species: all but Gray Fox');
    expect(words({ collections: { hidden: ['sparcd-aaa::aaa'] }, locations: onlyLocations(both, ['none']) }, both)).toBe(
      'Collections: Bravo · Locations: No location set',
    );
  });

  it('say what the species filter does with untagged photos', () => {
    const species = (f: FilterState['species']) => words({ species: f }, wide);
    expect(species(onlySpecies(wide, sci('Bobcat', 'Coyote', 'Raven')))).toBe('Species: 3 of 7, no untagged photos');
    expect(species({ hidden: [], hideUntagged: true })).toBe('Species: no untagged photos');
    expect(species(onlySpecies(wide, sci('Bobcat'), true))).toBe('Species: Bobcat, untagged photos');
    expect(species(onlySpecies(wide, [], true))).toBe('Species: untagged photos only');
    expect(species(onlySpecies(wide, []))).toBe('Species: none');
  });

  it('spell out the map area, years, months, hours, elevation and mountain ranges', () => {
    expect(
      words(
        {
          area: [wide.sites[0].key],
          years: [2024, 2023],
          months: [12, 1],
          hours: [22, 4],
          elevation: [1000, 1500],
          ranges: only(listKeys(wide, 'ranges'), ['BB0', 'AA0']),
        },
        wide,
        'ft',
      ),
    ).toBe('Map area: 1 location · Years: 2023, 2024 · Months: Jan, Dec · Hours: 22:00–04:59 · Elevation: 3,281–4,921 ft · Mountain range: AA0, BB0');
    expect(words({ dateFrom: '2023-09-14' })).toBe('Dates: from 2023-09-14');
  });
});
