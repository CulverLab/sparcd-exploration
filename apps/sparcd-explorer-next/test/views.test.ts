import { describe, expect, it } from 'vitest';
import { hexBins, locationRows, photoRows, speciesRows, summarize } from '../src/data';
import { collection, deployment, filter, media, modelOf, observation } from './support/fixtures';

const grouped = { separate: false };
const separate = { separate: true };

// SR07 is one location whose camera moved and was renamed.
const model = modelOf(
  collection()
    .upload('u1', {
      deployments: [deployment('SR07', 'Spring', 12.5, -100.25, 1000)],
      media: [media('u1', 'a.jpg', 'SR07', '2023-01-01T10:00:00'), media('u1', 'b.jpg', 'SR07', '2023-01-02T10:00:00')],
      observations: [
        observation('u1', 'a.jpg', 'SR07', '', { common: 'Bobcat', scientific: 'Lynx rufus', count: 2 }),
        observation('u1', 'a.jpg', 'SR07', '', { common: 'Deer', scientific: 'Odocoileus hemionus' }),
      ],
    })
    .upload('u2', {
      deployments: [deployment('SR07', 'Spring new', 12.75, -100.25, 1100)],
      media: [media('u2', 'c.jpg', 'SR07', '2024-05-01T10:00:00')],
      observations: [observation('u2', 'c.jpg', 'SR07', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
    }),
);
const result = filter(model);

describe('summarize', () => {
  it('gives the In view numbers from one result', () => {
    expect(summarize(model, result, grouped)).toMatchObject({
      locations: 1,
      photos: 3,
      tagged: 2,
      detections: 3,
      species: 2,
      animals: 4,
      activeDays: 3,
      firstDate: '2023-01-01',
      lastDate: '2024-05-01',
      topSpecies: [
        { species: 0, detections: 2 },
        { species: 1, detections: 1 },
      ],
      byCollection: [{ collection: 0, photos: 3, tagged: 2, detections: 3 }],
    });
  });

  it('counts locations by the grouping in force', () => {
    expect(summarize(model, result, separate).locations).toBe(2);
  });
});

describe('locationRows', () => {
  it('groups by location ID by default, showing the most recent position', () => {
    const [row] = locationRows(model, result, grouped);
    expect(row).toMatchObject({
      key: 'id:SR07',
      ids: ['SR07'],
      name: 'Spring new',
      position: { lat: 12.75, lon: -100.25 },
      elevation: 1100,
      range: 'SR0',
      photos: 3,
      tagged: 2,
      detections: 3,
      species: 2,
      firstDate: '2023-01-01',
      lastDate: '2024-05-01',
      activeDays: 3,
    });
  });

  it('shows each location ID and position separately when asked', () => {
    const rows = locationRows(model, result, separate);
    expect(rows.map((r) => [r.ids, r.name, r.photos])).toEqual([
      [['SR07'], 'Spring', 2],
      [['SR07'], 'Spring new', 1],
    ]);
    expect(rows[0].key).toBe(model.sites[0].key);
  });

  it('keeps IDs that differ only in case or punctuation apart', () => {
    const nearDuplicates = modelOf(
      collection()
        .upload('u1', { deployments: [deployment('AA-01', 'Alpha', 12.5, -100.25)], media: [media('u1', 'a.jpg', 'AA-01', '2023-01-01T10:00:00')] })
        .upload('u2', { deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)], media: [media('u2', 'b.jpg', 'AA01', '2023-01-01T10:00:00')] }),
    );
    const rows = locationRows(nearDuplicates, filter(nearDuplicates), grouped);
    expect(rows.map((r) => [r.key, r.ids, r.photos])).toEqual([
      ['id:AA-01', ['AA-01'], 1],
      ['id:AA01', ['AA01'], 1],
    ]);
  });

  it('counts active days from camera effort, so a species filter leaves them alone', () => {
    const owls = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'owl.jpg', 'AA01', '2024-01-01T22:00:00'), media('u1', 'empty.jpg', 'AA01', '2024-01-02T03:00:00')],
        observations: [observation('u1', 'owl.jpg', 'AA01', '2024-01-01T22:00:00', { common: 'Owl', scientific: 'Bubo virginianus' })],
      }),
    );
    const onlyOwls = filter(owls, { species: ['Bubo virginianus'] });
    expect(summarize(owls, onlyOwls, grouped)).toMatchObject({ photos: 1, activeDays: 2 });
    expect(locationRows(owls, onlyOwls, grouped)).toMatchObject([{ photos: 1, activeDays: 2 }]);
  });
});

describe('speciesRows', () => {
  it('counts detections, photos, animals and locations per species, most detected first', () => {
    expect(speciesRows(model, result, separate)).toEqual([
      { species: 0, detections: 2, photos: 2, animals: 3, locations: 2 },
      { species: 1, detections: 1, photos: 1, animals: 1, locations: 1 },
    ]);
  });
});

describe('photoRows', () => {
  it('lists one row per photo with its species joined and a 24-hour time', () => {
    expect(photoRows(model, result.photos)[0]).toEqual({
      photo: 0,
      fileName: 'a.jpg',
      time: '2023-01-01 10:00:00',
      date: '2023-01-01',
      species: 'Bobcat, Deer',
      locationId: 'SR07',
      locationName: 'Spring',
      collection: 'Test',
      tagged: true,
      video: false,
    });
  });

  it('limits species to the detections in view', () => {
    const bobcats = filter(model, { species: ['Lynx rufus'] });
    expect(photoRows(model, bobcats.photos, bobcats.detections)[0].species).toBe('Bobcat');
  });
});

describe('hexBins', () => {
  it('bins sites by cell with photo counts and species richness', () => {
    const bins = hexBins(model, result);
    expect(bins.map((b) => [b.locationNames, b.photos, b.tagged, b.richness])).toEqual([
      [['Spring'], 2, 1, 2],
      [['Spring new'], 1, 1, 1],
    ]);
    expect(bins[0].center).not.toEqual(model.sites[0].position);
  });
});
