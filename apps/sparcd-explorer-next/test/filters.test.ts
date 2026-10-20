import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  activeFilters,
  carryFilters,
  carryList,
  clearFilter,
  isFiltered,
  listKeys,
  only,
  onlyLocations,
  onlySpecies,
  photoSites,
  photosForTag,
  resetFilters,
  soleSpecies,
  tick,
  tickSpecies,
  toggleSpecies,
  type FilterState,
} from '../src/data';
import { collection, deployment, fileNames, filter, media, modelOf, observation, siteNamed } from './support/fixtures';

const a = collection('A', 'aaa')
  .upload('u1', {
    deployments: [deployment('AA01', 'Alpha', 12.5, -100.25, 1000)],
    media: [
      media('u1', 'a1.jpg', 'AA01', '2023-05-10T06:00:00'),
      media('u1', 'a2.jpg', 'AA01', '2023-05-11T22:00:00'),
      media('u1', 'a3.jpg', 'AA01', '2024-01-02T13:00:00'),
    ],
    observations: [
      observation('u1', 'a1.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
      observation('u1', 'a2.jpg', 'AA01', ''),
      observation('u1', 'a3.jpg', 'AA01', '', { common: 'Deer', scientific: 'Odocoileus hemionus' }),
    ],
  })
  .upload('u2', {
    deployments: [deployment('AB02', 'Bravo', 12.9, -100.9, 2000)],
    media: [media('u2', 'b1.jpg', 'AB02', '2024-07-04T03:00:00'), media('u2', 'b2.jpg', 'AB02', '')],
    observations: [
      observation('u2', 'b1.jpg', 'AB02', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
      observation('u2', 'b1.jpg', 'AB02', '', { common: 'Deer', scientific: 'Odocoileus hemionus' }),
    ],
  })
  .upload('u3', {
    deployments: [deployment('0000', '', null, null)],
    media: [media('u3', 'n1.jpg', '0000', '2024-08-01T12:00:00')],
    observations: [observation('u3', 'n1.jpg', '0000', '', { common: 'Owl', scientific: 'Strigiformes' })],
  });
const b = collection('B', 'bbb').upload('u1', {
  deployments: [deployment('CD01', 'Charlie', 13.5, -101.5, null)],
  media: [media('u1', 'c1.jpg', 'CD01', '2024-07-05T04:00:00')],
  observations: [observation('u1', 'c1.jpg', 'CD01', '', { common: 'Deer', scientific: 'Odocoileus hemionus' })],
});

const model = modelOf([a, b]);
const files = (state: Partial<FilterState>) => fileNames(model, filter(model, state).photos);
const ALL = ['a1.jpg', 'a2.jpg', 'a3.jpg', 'b1.jpg', 'b2.jpg', 'c1.jpg', 'n1.jpg'];

describe('applyFilters, one dimension at a time', () => {
  it('keeps every photo with no filter', () => {
    expect(files({})).toEqual(ALL);
    expect(filter(model).detections).toHaveLength(6);
  });

  it('collections, only while more than one is open', () => {
    expect(files({ collections: { hidden: ['sparcd-aaa::aaa'] } })).toEqual(['c1.jpg']);
    const single = modelOf(a);
    expect(filter(single, { collections: { hidden: ['sparcd-aaa::aaa'] } }).photos).toHaveLength(single.photos.length);
  });

  it('species: a photo with a ticked species passes, with only the ticked detections', () => {
    const result = filter(model, { species: onlySpecies(model, ['Lynx rufus']) });
    expect(fileNames(model, result.photos)).toEqual(['a1.jpg', 'b1.jpg']);
    expect(result.detections.map((d) => model.species[model.detections[d].species].name)).toEqual(['Bobcat', 'Bobcat']);
    expect(files({ species: onlySpecies(model, ['Lynx rufus', 'Strigiformes']) })).toEqual(['a1.jpg', 'b1.jpg', 'n1.jpg']);
  });

  it('species: a photo with several species stays while any of them is ticked', () => {
    const result = filter(model, { species: { hidden: ['Lynx rufus'], hideUntagged: false } });
    expect(fileNames(model, result.photos)).toEqual(['a2.jpg', 'a3.jpg', 'b1.jpg', 'b2.jpg', 'c1.jpg', 'n1.jpg']);
    expect(result.detections.some((d) => model.species[model.detections[d].species].name === 'Bobcat')).toBe(false);
    expect(files({ species: { hidden: ['Lynx rufus', 'Odocoileus hemionus'], hideUntagged: false } })).toEqual(['a2.jpg', 'b2.jpg', 'n1.jpg']);
  });

  it('species: untagged photos pass while "Untagged photos" is ticked', () => {
    expect(files({ species: { hidden: [], hideUntagged: true } })).toEqual(['a1.jpg', 'a3.jpg', 'b1.jpg', 'c1.jpg', 'n1.jpg']);
    expect(files({ species: onlySpecies(model, [], true) })).toEqual(['a2.jpg', 'b2.jpg']);
    expect(files({ species: onlySpecies(model, ['Strigiformes'], true) })).toEqual(['a2.jpg', 'b2.jpg', 'n1.jpg']);
    expect(filter(model, { species: onlySpecies(model, []) }).photos).toEqual([]);
  });

  it('species: camera effort ignores it', () => {
    expect(filter(model, { species: onlySpecies(model, []) }).effort).toEqual(filter(model).effort);
  });

  it('locations, by site; a location key picks all its sites', () => {
    expect(files({ locations: onlyLocations(model, ['id:AA01']) })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg']);
    expect(files({ locations: onlyLocations(model, [model.sites[siteNamed(model, 'Bravo')].key]) })).toEqual(['b1.jpg', 'b2.jpg']);
    expect(files({ locations: onlyLocations(model, ['none']) })).toEqual(['n1.jpg']);
    expect(files({ locations: { hidden: [model.sites[siteNamed(model, 'Bravo')].key] } })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'c1.jpg', 'n1.jpg']);
  });

  it('area, by the sites the map took in; photos with no position are outside every area', () => {
    const alpha = model.sites[siteNamed(model, 'Alpha')].key;
    const charlie = model.sites.find((s) => s.locationId === 'CD01')!.key;
    expect(files({ area: [alpha] })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg']);
    expect(files({ area: [charlie] })).toEqual(['c1.jpg']);
    expect(files({ area: [alpha, charlie] })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'c1.jpg']);
  });

  it('date range, inclusive, on the camera-local date; undated photos are outside it', () => {
    expect(files({ dateFrom: '2024-01-02', dateTo: '2024-07-04' })).toEqual(['a3.jpg', 'b1.jpg']);
    expect(files({ dateFrom: '2024-07-05' })).toEqual(['c1.jpg', 'n1.jpg']);
    expect(files({ dateTo: '2023-05-10' })).toEqual(['a1.jpg']);
  });

  it('years and months', () => {
    expect(files({ years: [2023] })).toEqual(['a1.jpg', 'a2.jpg']);
    expect(files({ months: [7] })).toEqual(['b1.jpg', 'c1.jpg']);
    expect(files({ years: [2023, 2024], months: [5, 8] })).toEqual(['a1.jpg', 'a2.jpg', 'n1.jpg']);
  });

  it('hours, including a range past midnight', () => {
    expect(files({ hours: [3, 6] })).toEqual(['a1.jpg', 'b1.jpg', 'c1.jpg']);
    expect(files({ hours: [22, 4] })).toEqual(['a2.jpg', 'b1.jpg', 'c1.jpg']);
  });

  it('elevation, inclusive; unknown elevation is outside the range', () => {
    expect(files({ elevation: [1500, 2500] })).toEqual(['b1.jpg', 'b2.jpg']);
    expect(files({ elevation: [1000, 2000] })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'b1.jpg', 'b2.jpg']);
  });

  it('mountain range; a location with none is outside it once the filter is on', () => {
    const ranges = (keep: string[]) => files({ ranges: only(listKeys(model, 'ranges'), keep) });
    expect(listKeys(model, 'ranges')).toEqual(['AA0', 'AB0', 'CD0']);
    expect(ranges(['AB0'])).toEqual(['b1.jpg', 'b2.jpg']);
    expect(ranges(['AA0', 'CD0'])).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'c1.jpg']);
    expect(files({ ranges: { hidden: ['AB0'] } })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'c1.jpg']);
  });

  it('the Photos view’s tagged / untagged / all switch', () => {
    const { photos } = filter(model);
    expect(fileNames(model, photosForTag(model, photos, 'tagged'))).toEqual(['a1.jpg', 'a3.jpg', 'b1.jpg', 'c1.jpg', 'n1.jpg']);
    expect(fileNames(model, photosForTag(model, photos, 'untagged'))).toEqual(['a2.jpg', 'b2.jpg']);
    expect(photosForTag(model, photos, 'all')).toBe(photos);
  });
});

describe('applyFilters, combined', () => {
  it('ANDs dimensions together', () => {
    expect(files({ species: onlySpecies(model, ['Odocoileus hemionus']), years: [2024] })).toEqual(['a3.jpg', 'b1.jpg', 'c1.jpg']);
    expect(files({ collections: { hidden: ['sparcd-bbb::bbb'] }, months: [7] })).toEqual(['b1.jpg']);
    expect(
      files({ locations: onlyLocations(model, ['id:AA01']), species: { hidden: ['Lynx rufus'], hideUntagged: false } }),
    ).toEqual(['a2.jpg', 'a3.jpg']);
    expect(files({ elevation: [0, 5000], dateFrom: '2024-01-01', hours: [0, 12] })).toEqual(['b1.jpg']);
    expect(files({ ranges: only(listKeys(model, 'ranges'), ['AA0']), species: onlySpecies(model, ['Strigiformes']) })).toEqual([]);
  });

  it('keeps camera effort separate from the species filter', () => {
    const result = filter(model, { locations: onlyLocations(model, ['id:AA01']), species: onlySpecies(model, ['Lynx rufus']) });
    expect(fileNames(model, result.photos)).toEqual(['a1.jpg']);
    expect(fileNames(model, result.effort)).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg']);
  });

  it('is pure: same input, same output, state untouched', () => {
    const state: FilterState = { ...NO_FILTERS, years: [2024], species: onlySpecies(model, ['Lynx rufus']) };
    const frozen = JSON.stringify(state);
    expect(filter(model, state)).toEqual(filter(model, state));
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe('the list pickers', () => {
  const species = listKeys(model, 'species');

  it('start with everything ticked, which is no filter', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(species).toEqual(['Lynx rufus', 'Odocoileus hemionus', 'Strigiformes']);
  });

  it('Only ticks one row and unticks every other, "Untagged photos" too', () => {
    expect(onlySpecies(model, ['Lynx rufus'])).toEqual({ hidden: ['Odocoileus hemionus', 'Strigiformes'], hideUntagged: true });
    expect(onlySpecies(model, [], true)).toEqual({ hidden: species, hideUntagged: false });
    expect(only(['a', 'b', 'c'], ['b'])).toEqual({ hidden: ['a', 'c'] });
  });

  it('Only on a location ticks every site with that ID, and only sites with photos are listed', () => {
    expect(photoSites(model).map((s) => s.locationId)).toEqual(['AA01', 'AB02', '0000', 'CD01']);
    expect(onlyLocations(model, ['id:AA01']).hidden).toHaveLength(3);
  });

  it('a checkbox ticks or unticks its row alone', () => {
    const off = tickSpecies(NO_FILTERS.species, ['Lynx rufus'], false, false);
    expect(off).toEqual({ hidden: ['Lynx rufus'], hideUntagged: false });
    expect(tickSpecies(off, ['Lynx rufus'], false, true)).toEqual(NO_FILTERS.species);
    expect(tickSpecies(off, [], true, false)).toEqual({ hidden: ['Lynx rufus'], hideUntagged: true });
    expect(tick({ hidden: ['a'] }, ['a'], true)).toEqual({ hidden: [] });
  });

  it('Clear all then Select all, over every row', () => {
    const cleared = tickSpecies(NO_FILTERS.species, species, true, false);
    expect(cleared).toEqual({ hidden: species, hideUntagged: true });
    expect(filter(model, { species: cleared }).photos).toEqual([]);
    expect(tickSpecies(cleared, species, true, true)).toEqual(NO_FILTERS.species);
  });

  it('Select all and Clear all with a search act on the matching rows only', () => {
    // A search for "o" matches Bobcat, Deer (Odocoileus) and Owl, not "Untagged photos".
    const matching = ['Lynx rufus', 'Odocoileus hemionus'];
    const cleared = tickSpecies(NO_FILTERS.species, matching, false, false);
    expect(cleared).toEqual({ hidden: matching, hideUntagged: false });
    const some = tickSpecies(onlySpecies(model, ['Strigiformes']), matching, false, true);
    expect(some).toEqual({ hidden: [], hideUntagged: true });
  });

  it('a species bar or row shows that species alone, and lets it go on a second click', () => {
    const one = toggleSpecies(model, NO_FILTERS, 'Strigiformes');
    expect(soleSpecies(model, one.species)).toBe('Strigiformes');
    expect(toggleSpecies(model, one, 'Strigiformes').species).toEqual(NO_FILTERS.species);
    expect(soleSpecies(model, onlySpecies(model, ['Strigiformes'], true))).toBeNull();
  });
});

describe('reset and undo', () => {
  const busy: FilterState = {
    ...NO_FILTERS,
    species: { hidden: ['Lynx rufus'], hideUntagged: true },
    years: [2024],
    area: ['sparcd-aaa::aaa|AA01|Alpha|12.5,-100.25'],
    photoTag: 'untagged',
  };

  it('clears every filter and hands back the previous state for Undo', () => {
    const { state, undo } = resetFilters(busy);
    expect(isFiltered(state)).toBe(false);
    expect(files(state)).toEqual(ALL);
    expect(undo).toBe(busy);
    expect(files(undo)).toEqual(files(busy));
  });

  it('leaves the Photos view’s switch alone', () => {
    expect(resetFilters(busy).state.photoTag).toBe('untagged');
  });

  it('knows when nothing is filtered, so Reset can be disabled', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, photoTag: 'tagged' })).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, months: [3] })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, species: { hidden: [], hideUntagged: true } })).toBe(true);
  });
});

describe('each filter button', () => {
  const everything: FilterState = {
    collections: { hidden: ['sparcd-bbb::bbb'] },
    species: { hidden: ['Lynx rufus'], hideUntagged: false },
    locations: { hidden: ['sparcd-aaa::aaa|AA01|Alpha|12.5,-100.25'] },
    area: ['sparcd-aaa::aaa|AA01|Alpha|12.5,-100.25'],
    dateFrom: '2024-01-01',
    dateTo: '2024-12-31',
    years: [2024],
    months: [1],
    hours: [1, 2],
    elevation: [0, 10],
    ranges: { hidden: ['AA0'] },
    photoTag: 'all',
  };

  it('shows which filters are active', () => {
    expect(activeFilters(everything)).toEqual(['collections', 'species', 'locations', 'area', 'dates', 'elevation', 'ranges']);
    expect(activeFilters({ ...NO_FILTERS, hours: [1, 2] })).toEqual(['dates']);
  });

  it('clears only its own filter with ×, back to everything ticked', () => {
    for (const dimension of activeFilters(everything)) {
      const cleared = clearFilter(everything, dimension);
      expect(activeFilters(cleared)).toEqual(activeFilters(everything).filter((d) => d !== dimension));
    }
    expect(clearFilter(everything, 'dates')).toMatchObject({ dateFrom: null, dateTo: null, years: [], months: [], hours: null });
    expect(clearFilter(everything, 'species').species).toEqual({ hidden: [], hideUntagged: false });
  });
});

describe('carrying filters to another set of collections', () => {
  const both = modelOf([a, b]);
  const onlyA = modelOf(a);
  const onlyB = modelOf(b);

  it('keeps a filter of a few ticked items as those items; new ones start unticked', () => {
    const state = { ...NO_FILTERS, species: onlySpecies(onlyA, ['Strigiformes']) };
    // B adds no species, so Owl alone carries as Owl alone.
    expect(carryFilters(onlyA, both, state)).toEqual({ state, dropped: false });
    const deer = { ...NO_FILTERS, locations: onlyLocations(onlyA, ['id:AB02']) };
    const { state: next } = carryFilters(onlyA, both, deer);
    // Charlie (CD01) is new to the open set: it stays out.
    expect(files(next)).toEqual(['b1.jpg', 'b2.jpg']);
  });

  it('keeps the ticked items the button named, though one was unticked', () => {
    // "Locations: AA01, No location set": Charlie, new here, stays out.
    const state = { ...NO_FILTERS, locations: { hidden: [onlyA.sites[siteNamed(onlyA, 'Bravo')].key] } };
    const { state: next, dropped } = carryFilters(onlyA, both, state);
    expect(dropped).toBe(false);
    expect(files(next)).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'n1.jpg']);
  });

  it('drops what the new collections lack, and says so', () => {
    const state: FilterState = {
      ...NO_FILTERS,
      collections: { hidden: [both.collections[1].key] },
      species: onlySpecies(both, ['Lynx rufus', 'Strigiformes']),
      locations: onlyLocations(both, ['id:AA01']),
      area: [both.sites[0].key],
      dateFrom: '2024-01-01',
      elevation: [0, 3000],
      photoTag: 'untagged',
    };
    const { state: next, dropped } = carryFilters(both, onlyB, state);
    expect(dropped).toBe(true);
    expect(next).toEqual({
      ...state,
      collections: { hidden: [] },
      species: { hidden: [], hideUntagged: true },
      locations: { hidden: [] },
      area: [],
    });
  });

  it('drops nothing when every value is still there', () => {
    const state = { ...NO_FILTERS, species: onlySpecies(both, ['Lynx rufus']), area: [both.sites[0].key] };
    expect(carryFilters(both, both, state)).toEqual({ state, dropped: false });
  });

  it('carries a list by the side its button named', () => {
    // "a": new items start unticked.
    expect(carryList(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['b', 'c'])).toEqual({ hidden: ['b', 'c', 'd'], dropped: false });
    // "all but d": new items start ticked.
    expect(carryList(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e'], ['d'])).toEqual({ hidden: ['d'], dropped: false });
    // "3 of 7" keeps the smaller side, the ticked one here.
    expect(carryList([...'abcdefg'], [...'abcdefgh'], [...'defg'])).toEqual({ hidden: [...'defgh'], dropped: false });
    // What the button named is gone: the filter goes, and says so.
    expect(carryList(['a', 'b', 'c'], ['b', 'c', 'd'], ['b', 'c'])).toEqual({ hidden: [], dropped: true });
    expect(carryList(['a', 'b', 'c', 'd'], ['a', 'b', 'c'], ['d'])).toEqual({ hidden: [], dropped: true });
    expect(carryList(['a', 'b', 'c'], ['a', 'b'], ['c'])).toEqual({ hidden: [], dropped: false });
    // Undo puts back what the button named, though nothing matches it now.
    expect(carryList(['a', 'b', 'c'], ['b', 'c', 'd'], ['b', 'c'], true)).toEqual({ hidden: ['b', 'c', 'd'], dropped: true });
    expect(carryList(['a', 'b'], ['a', 'b', 'c'], ['a', 'b'])).toEqual({ hidden: ['a', 'b', 'c'], dropped: false });
    expect(carryList(['a'], ['a', 'b'], [])).toEqual({ hidden: [], dropped: false });
  });
});
