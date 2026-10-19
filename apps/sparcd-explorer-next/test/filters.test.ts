import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  activeFilters,
  clearFilter,
  isFiltered,
  photosForTag,
  resetFilters,
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
    expect(files({ collections: ['sparcd-bbb::bbb'] })).toEqual(['c1.jpg']);
    const single = modelOf(a);
    expect(filter(single, { collections: ['sparcd-bbb::bbb'] }).photos).toHaveLength(single.photos.length);
  });

  it('species, show only: photos with a chosen species and only those detections', () => {
    const result = filter(model, { species: ['Lynx rufus'] });
    expect(fileNames(model, result.photos)).toEqual(['a1.jpg', 'b1.jpg']);
    expect(result.detections.map((d) => model.species[model.detections[d].species].name)).toEqual(['Bobcat', 'Bobcat']);
    expect(files({ species: ['Lynx rufus', 'Strigiformes'] })).toEqual(['a1.jpg', 'b1.jpg', 'n1.jpg']);
  });

  it('species, hide: drops a photo only when every species on it is hidden; untagged photos stay', () => {
    const result = filter(model, { species: ['Lynx rufus'], speciesMode: 'hide' });
    expect(fileNames(model, result.photos)).toEqual(['a2.jpg', 'a3.jpg', 'b1.jpg', 'b2.jpg', 'c1.jpg', 'n1.jpg']);
    expect(result.detections.some((d) => model.species[model.detections[d].species].name === 'Bobcat')).toBe(false);
  });

  it('locations, by grouped location key or by site key', () => {
    expect(files({ locations: ['id:AA01'] })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg']);
    expect(files({ locations: [model.sites[siteNamed(model, 'Bravo')].key] })).toEqual(['b1.jpg', 'b2.jpg']);
    expect(files({ locations: ['none'] })).toEqual(['n1.jpg']);
  });

  it('area, by hex or by box; photos with no position are outside every area', () => {
    const alpha = model.sites[siteNamed(model, 'Alpha')];
    expect(files({ area: { hexes: [alpha.hex!], boxes: [] } })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg']);
    expect(files({ area: { hexes: [], boxes: [{ south: 13, west: -102, north: 14, east: -101 }] } })).toEqual(['c1.jpg']);
    expect(files({ area: { hexes: [alpha.hex!], boxes: [{ south: 13, west: -102, north: 14, east: -101 }] } })).toEqual([
      'a1.jpg',
      'a2.jpg',
      'a3.jpg',
      'c1.jpg',
    ]);
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

  it('mountain range', () => {
    expect(files({ ranges: ['AB0'] })).toEqual(['b1.jpg', 'b2.jpg']);
    expect(files({ ranges: ['AA0', 'CD0'] })).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg', 'c1.jpg']);
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
    expect(files({ species: ['Odocoileus hemionus'], years: [2024] })).toEqual(['a3.jpg', 'b1.jpg', 'c1.jpg']);
    expect(files({ collections: ['sparcd-aaa::aaa'], months: [7] })).toEqual(['b1.jpg']);
    expect(files({ locations: ['id:AA01'], species: ['Lynx rufus'], speciesMode: 'hide' })).toEqual(['a2.jpg', 'a3.jpg']);
    expect(files({ elevation: [0, 5000], dateFrom: '2024-01-01', hours: [0, 12] })).toEqual(['b1.jpg']);
    expect(files({ ranges: ['AA0'], species: ['Strigiformes'] })).toEqual([]);
  });

  it('keeps camera effort separate from the species filter', () => {
    const result = filter(model, { locations: ['id:AA01'], species: ['Lynx rufus'] });
    expect(fileNames(model, result.photos)).toEqual(['a1.jpg']);
    expect(fileNames(model, result.effort)).toEqual(['a1.jpg', 'a2.jpg', 'a3.jpg']);
  });

  it('is pure: same input, same output, state untouched', () => {
    const state: FilterState = { ...NO_FILTERS, years: [2024], species: ['Lynx rufus'] };
    const frozen = JSON.stringify(state);
    expect(filter(model, state)).toEqual(filter(model, state));
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe('reset and undo', () => {
  const busy: FilterState = {
    ...NO_FILTERS,
    species: ['Lynx rufus'],
    speciesMode: 'hide',
    years: [2024],
    area: { hexes: ['1:2'], boxes: [] },
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
    expect(isFiltered({ ...NO_FILTERS, photoTag: 'tagged', speciesMode: 'hide' })).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, months: [3] })).toBe(true);
  });
});

describe('each filter button', () => {
  const everything: FilterState = {
    collections: ['sparcd-aaa::aaa'],
    species: ['Lynx rufus'],
    speciesMode: 'hide',
    locations: ['id:AA01'],
    area: { hexes: ['1:2'], boxes: [{ south: 0, west: 0, north: 1, east: 1 }] },
    dateFrom: '2024-01-01',
    dateTo: '2024-12-31',
    years: [2024],
    months: [1],
    hours: [1, 2],
    elevation: [0, 10],
    ranges: ['AA0'],
    photoTag: 'all',
  };

  it('shows which filters are active', () => {
    expect(activeFilters(everything)).toEqual(['collections', 'species', 'locations', 'area', 'dates', 'elevation', 'ranges']);
    expect(activeFilters({ ...NO_FILTERS, hours: [1, 2] })).toEqual(['dates']);
  });

  it('clears only its own filter with ×', () => {
    for (const dimension of activeFilters(everything)) {
      const cleared = clearFilter(everything, dimension);
      expect(activeFilters(cleared)).toEqual(activeFilters(everything).filter((d) => d !== dimension));
    }
    expect(clearFilter(everything, 'dates')).toMatchObject({ dateFrom: null, dateTo: null, years: [], months: [], hours: null });
    expect(clearFilter(everything, 'species')).toMatchObject({ species: [], speciesMode: 'only' });
  });
});
