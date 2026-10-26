// The meanings the numbers rest on (spec, Data layer §5).

import { describe, expect, it } from 'vitest';
import { NO_LOCATION_NAME, locationRows, onlyLocations, onlySpecies, photoRows, summarize } from '../src/data';
import { binsOf, collection, deployment, fileNames, filter, media, modelOf, observation, species } from './support/fixtures';

const TS = '2024-01-01T10:00:00';
const grouped = { separate: false };

describe('a tagged image', () => {
  const model = modelOf(
    collection().upload('u1', {
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: ['named', 'common-only', 'blank', 'empty', 'removed', 'none'].map((n) => media('u1', `${n}.jpg`, 'AA01', TS)),
      observations: [
        observation('u1', 'named.jpg', 'AA01', TS, { common: 'Bobcat', scientific: 'Lynx rufus' }),
        observation('u1', 'common-only.jpg', 'AA01', TS, { common: 'Deer' }),
        // The uploader's placeholder is typed blank; sparcd-web leaves the type empty.
        { ...observation('u1', 'blank.jpg', 'AA01', TS), observationType: 'blank' },
        observation('u1', 'empty.jpg', 'AA01', TS),
        // The Tagger writes a blank row naming only what was removed.
        observation('u1', 'removed.jpg', 'AA01', TS, { tags: '[REMOVED:Lynx rufus]' }),
      ],
    }),
  );

  it('names at least one species; placeholders, removal-only rows and no rows are untagged', () => {
    const tagged = model.photos.filter((p) => p.tagged).map((p) => p.fileName);
    expect(tagged).toEqual(['named.jpg', 'common-only.jpg']);
    expect(summarize(model, filter(model), grouped)).toMatchObject({ photos: 6, tagged: 2, detections: 2 });
  });

  it('captions only present species, never removed or corrected-away ones or reviewer marks (#467)', () => {
    const m = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'a.jpg', 'AA01', TS)],
        observations: [
          observation('u1', 'a.jpg', 'AA01', TS, {
            common: 'Coyote',
            scientific: 'Canis latrans',
            tags: '[CORRECTED_FROM:Puma concolor][REMOVED:Lynx rufus][REVIEWED_BY:someone][REVIEWED_AT:2024-01-02T00:00:00Z]',
          }),
        ],
      }),
    );
    expect(photoRows(m, filter(m).photos)[0].species).toBe('Coyote');
    expect(m.species.map((s) => s.name)).toEqual(['Coyote']);
  });

  it('uses the species list for names, then the marker, then the scientific name', () => {
    const m = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: ['a', 'b', 'c'].map((n) => media('u1', `${n}.jpg`, 'AA01', TS)),
        observations: [
          observation('u1', 'a.jpg', 'AA01', TS, { common: 'Wildcat', scientific: 'Lynx rufus' }),
          observation('u1', 'b.jpg', 'AA01', TS, { common: 'Mystery', scientific: 'Genus unlisted' }),
          observation('u1', 'c.jpg', 'AA01', TS, { scientific: 'Genus bare' }),
        ],
      }),
      { species: [species('Bobcat', 'Lynx rufus')] },
    );
    expect(m.species.map((s) => s.name)).toEqual(['Bobcat', 'Mystery', 'Genus bare']);
  });
});

describe('location ID 0000 or empty', () => {
  const model = modelOf(
    collection()
      .upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'a.jpg', 'AA01', TS)],
      })
      .upload('u2', {
        // Coordinates on a 0000 row are not a position.
        deployments: [deployment('0000', 'Unknown', 12.9, -100.9)],
        media: [media('u2', 'b.jpg', '0000', TS)],
        observations: [observation('u2', 'b.jpg', '0000', TS, { common: 'Javelina' })],
      })
      .upload('u3', { deployments: [deployment('', '', null, null)], media: [media('u3', 'c.jpg', '', TS)] })
      .upload('u4', { media: [media('u4', 'd.jpg', 'XX', TS)] }),
  );
  const result = filter(model);

  it('stays in every count', () => {
    expect(summarize(model, result, grouped)).toMatchObject({ photos: 4, tagged: 1, species: 1, locations: 2 });
  });

  it('is one flagged "No location set" row with no position', () => {
    const none = locationRows(model, result, grouped).find((r) => r.noLocation)!;
    expect(none).toMatchObject({ name: NO_LOCATION_NAME, position: null, photos: 3 });
  });

  it('never reaches the map', () => {
    expect(binsOf(model, result).map((b) => b.locationNames)).toEqual([['Alpha']]);
  });
});

describe('years and dates', () => {
  const model = modelOf(
    collection().upload('u1', {
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: [
        media('u1', 'tagged.jpg', 'AA01', '2023-12-31T23:30:00-07:00'),
        media('u1', 'untagged.jpg', 'AA01', '2025-01-01T00:10:00+05:00'),
      ],
      observations: [observation('u1', 'tagged.jpg', 'AA01', '2023-12-31T23:30:00-07:00', { common: 'Owl' })],
    }),
  );

  it('come from media timestamps, so untagged photos count', () => {
    expect(fileNames(model, filter(model, { years: [2025] }).photos)).toEqual(['untagged.jpg']);
    expect(model.dateSpan).toEqual({ first: '2023-12-31', last: '2025-01-01' });
  });

  it('use the camera-local date with no UTC conversion', () => {
    expect(model.photos.map((p) => [p.date, p.year, p.hour])).toEqual([
      ['2023-12-31', 2023, 23],
      ['2025-01-01', 2025, 0],
    ]);
  });
});

describe('active days', () => {
  const model = modelOf(
    collection()
      .upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [
          media('u1', 'a1.jpg', 'AA01', '2024-01-01T08:00:00'),
          media('u1', 'a2.jpg', 'AA01', '2024-01-01T20:00:00'),
          media('u1', 'a3.jpg', 'AA01', '2024-01-03T08:00:00'),
          media('u1', 'undated.jpg', 'AA01', ''),
        ],
        observations: [observation('u1', 'a3.jpg', 'AA01', '2024-01-03T08:00:00', { common: 'Owl' })],
      })
      .upload('u2', {
        deployments: [deployment('BB01', 'Bravo', 12.9, -100.9)],
        media: [media('u2', 'b1.jpg', 'BB01', '2024-01-01T09:00:00')],
      }),
  );

  it('count distinct (location, local date) pairs with a photo', () => {
    expect(summarize(model, filter(model), grouped).activeDays).toBe(3);
  });

  it('follow location and date filters but not the species filter: they measure camera effort', () => {
    expect(summarize(model, filter(model, { locations: onlyLocations(model, ['id:AA01']) }), grouped).activeDays).toBe(2);
    expect(summarize(model, filter(model, { dateFrom: '2024-01-02' }), grouped).activeDays).toBe(1);
    const owls = summarize(model, filter(model, { species: onlySpecies(model, ['Owl']) }), grouped);
    expect(owls).toMatchObject({ photos: 1, activeDays: 3 });
  });
});

describe('mountain range', () => {
  it('is the first three characters of the location ID', () => {
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('SRX07', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'a.jpg', 'SRX07', TS)],
      }),
    );
    expect(model.sites[0].range).toBe('SRX');
    expect(locationRows(model, filter(model), grouped)[0].range).toBe('SRX');
  });
});

describe('photos and their sites', () => {
  it('match a photo to its own upload’s deployment row, else that upload’s first row', () => {
    const model = modelOf(
      collection()
        .upload('u1', {
          deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
          media: [media('u1', 'a.jpg', 'AA01', TS), { ...media('u1', 'b.jpg', 'AA01', TS), deploymentId: 'mismatch' }],
        })
        .upload('u2', {
          // Same deployment ID, another position: each upload keeps its own.
          deployments: [deployment('AA01', 'Alpha', 12.75, -100.25)],
          media: [media('u2', 'c.jpg', 'AA01', TS)],
        }),
    );
    const at = (file: string) => model.sites[model.photos.find((p) => p.fileName === file)!.site].position;
    expect([at('a.jpg'), at('b.jpg'), at('c.jpg')]).toEqual([
      { lat: 12.5, lon: -100.25 },
      { lat: 12.5, lon: -100.25 },
      { lat: 12.75, lon: -100.25 },
    ]);
  });

  it('marks videos', () => {
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'clip.mp4', 'AA01', TS, 'video/mp4'), media('u1', 'CLIP2.MP4', 'AA01', TS, ''), media('u1', 'a.jpg', 'AA01', TS)],
      }),
    );
    expect(model.photos.map((p) => p.video)).toEqual([true, true, false]);
  });

  it('averages a site’s elevation over its deployments and keeps a missing one null', () => {
    const model = modelOf(
      collection()
        .upload('u1', { deployments: [deployment('AA01', 'Alpha', 12.5, -100.25, 1000)], media: [media('u1', 'a.jpg', 'AA01', TS)] })
        .upload('u2', { deployments: [deployment('AA01', 'Alpha', 12.5, -100.25, 1003)], media: [media('u2', 'b.jpg', 'AA01', TS)] })
        .upload('u3', { deployments: [deployment('BB01', 'Bravo', 12.9, -100.9, null)], media: [media('u3', 'c.jpg', 'BB01', TS)] }),
    );
    expect(model.sites.map((s) => [s.locationId, s.elevation, s.deployments])).toEqual([
      ['AA01', 1002, 2],
      ['BB01', null, 1],
    ]);
  });
});
