import { describe, expect, it } from 'vitest';
import {
  buildModel,
  checkBadTimestamps,
  checkHiddenUploads,
  checkMissingFiles,
  checkMoved,
  checkNearDuplicateIds,
  checkNoCoordinates,
  checkNoLocation,
  checkSharedLocations,
  checkUnreadable,
  dataChecks,
} from '../src/data';
import { collection, deployment, media, mediaPath, modelOf, observation } from './support/fixtures';

const TS = '2024-01-01T10:00:00';

const clean = () =>
  collection().upload('u1', {
    deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
    media: [media('u1', 'a.jpg', 'AA01', TS)],
  });

describe('data checks', () => {
  it('find nothing in clean data', () => {
    expect(dataChecks(modelOf(clean()))).toEqual([]);
  });

  it('count photos with no location, how many are untagged, and their years', () => {
    const model = modelOf(
      clean()
        .upload('u2', {
          deployments: [deployment('0000', 'Unknown', null, null)],
          media: [media('u2', 'b.jpg', '0000', '2025-03-01T10:00:00'), media('u2', 'c.jpg', '0000', '2026-01-01T10:00:00')],
          observations: [observation('u2', 'b.jpg', '0000', '', { common: 'Owl' })],
        })
        .upload('u3', { media: [media('u3', 'd.jpg', 'ZZ', '2026-02-01T10:00:00')] }),
    );
    expect(checkNoLocation(model)).toEqual([{ kind: 'no-location', photos: 3, untagged: 2, years: [2025, 2026] }]);
  });

  it('find one location ID at more than one coordinate pair and count the pairs', () => {
    const model = modelOf(
      clean()
        .upload('u2', { deployments: [deployment('AA01', 'Alpha', 12.75, -100.25)], media: [media('u2', 'b.jpg', 'AA01', TS)] })
        .upload('u3', { deployments: [deployment('AA01', 'Alpha moved', 12.75, -100.5)], media: [media('u3', 'c.jpg', 'AA01', TS)] })
        // Same position under another name is not a move.
        .upload('u4', { deployments: [deployment('BB01', 'Bravo', 12.9, -100.9)], media: [media('u4', 'd.jpg', 'BB01', TS)] })
        .upload('u5', { deployments: [deployment('BB01', 'Bravo renamed', 12.9, -100.9)], media: [media('u5', 'e.jpg', 'BB01', TS)] }),
    );
    expect(checkMoved(model)).toEqual([{ kind: 'moved', locationId: 'AA01', pairs: 3, sites: [0, 1, 2] }]);
  });

  it('find near-duplicate IDs: the same after uppercasing and dropping punctuation', () => {
    const model = modelOf(
      clean()
        .upload('u2', { deployments: [deployment('aa-01', 'Alpha', 12.5, -100.25)], media: [media('u2', 'b.jpg', 'aa-01', TS)] })
        .upload('u3', { deployments: [deployment('AB01', 'Other', 12.6, -100.3)], media: [media('u3', 'c.jpg', 'AB01', TS)] }),
    );
    expect(checkNearDuplicateIds(model)).toEqual([{ kind: 'near-duplicate-ids', ids: ['AA01', 'aa-01'] }]);
  });

  it('find deployments with a location ID but no usable coordinates', () => {
    const model = modelOf(
      clean()
        .upload('u2', { deployments: [deployment('CC01', 'Charlie', null, null)], media: [media('u2', 'b.jpg', 'CC01', TS)] })
        .upload('u3', { deployments: [deployment('DD01', 'Delta', 120, 200)], media: [media('u3', 'c.jpg', 'DD01', TS)] }),
    );
    expect(checkNoCoordinates(model).map((c) => [model.sites[c.site].locationId, c.deployments])).toEqual([
      ['CC01', 1],
      ['DD01', 1],
    ]);
  });

  it('count incomplete uploads that are hidden, per collection', () => {
    const model = modelOf(clean().hide('u8').hide('u9'));
    expect(checkHiddenUploads(model)).toEqual([
      { kind: 'hidden-uploads', collection: 0, folders: ['Collections/test/Uploads/u8/', 'Collections/test/Uploads/u9/'] },
    ]);
  });

  it('find the same location ID in more than one open collection, with each collection’s dates', () => {
    const a = collection('A', 'aaa').upload('u1', {
      deployments: [deployment('SR07', 'Spring', 12.5, -100.25)],
      media: [media('u1', 'a.jpg', 'SR07', '2023-01-05T10:00:00'), media('u1', 'b.jpg', 'SR07', '2023-06-05T10:00:00')],
    });
    const b = collection('B', 'bbb').upload('u1', {
      deployments: [deployment('SR07', 'Spring', 12.5, -100.25)],
      media: [media('u1', 'c.jpg', 'SR07', '2024-02-01T10:00:00')],
    });
    expect(checkSharedLocations(modelOf([a, b]))).toEqual([
      {
        kind: 'shared-location',
        ids: ['SR07'],
        spans: [
          { collection: 0, first: '2023-01-05', last: '2023-06-05' },
          { collection: 1, first: '2024-02-01', last: '2024-02-01' },
        ],
      },
    ]);
    expect(checkSharedLocations(modelOf(a))).toEqual([]);
  });

  it('find timestamps that do not parse, per upload', () => {
    const model = modelOf(
      clean().upload('u2', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u2', 'b.jpg', 'AA01', '0000-00-00T00:00:00'), media('u2', 'c.jpg', 'AA01', ''), media('u2', 'd.jpg', 'AA01', TS)],
      }),
    );
    expect(checkBadTimestamps(model)).toEqual([{ kind: 'bad-timestamps', upload: 1, photos: [1, 2] }]);
  });

  it('name files that could not be read', () => {
    const loaded = clean().build();
    loaded.problems = [{ folder: 'Collections/test/Uploads/u1/', file: 'media.csv', message: 'Failed to read media.csv (HTTP 500).' }];
    expect(checkUnreadable(buildModel([loaded]))).toEqual([
      { kind: 'unreadable', collection: 0, folder: 'Collections/test/Uploads/u1/', file: 'media.csv', message: 'Failed to read media.csv (HTTP 500).' },
    ]);
  });

  it('list every check, photos with no location first', () => {
    const model = modelOf(
      clean()
        .hide('u9')
        .upload('u2', { deployments: [deployment('0000', '', null, null)], media: [media('u2', 'b.jpg', '0000', TS)] })
        .upload('u3', { deployments: [deployment('AA01', 'Alpha', 12.75, -100.25)], media: [media('u3', 'c.jpg', 'AA01', 'bad')] }),
    );
    expect(dataChecks(model).map((c) => c.kind)).toEqual(['no-location', 'hidden-uploads', 'moved', 'bad-timestamps']);
  });
});

describe('photos whose files are missing', () => {
  // Rows an older uploader wrote before the files arrived: no time, no species.
  const c = collection('Gaps', 'gap')
    .upload('u1', {
      deployments: [deployment('0000', '', null, null)],
      media: [media('u1', 'here.jpg', '0000', '2024-01-01T10:00:00'), media('u1', 'stale1.jpg', '0000', '')],
    })
    .upload('u2', { deployments: [deployment('GG01', 'Gap', 12.5, -100.25)], media: [media('u2', 'stale2.jpg', 'GG01', '')] });
  const missing = ['sparcd-gap/' + mediaPath('u1', 'stale1.jpg'), 'sparcd-gap/' + mediaPath('u2', 'stale2.jpg')];

  it('are counted, with the uploads they are in', () => {
    expect(checkMissingFiles(modelOf(c, { missing }))).toEqual([{ kind: 'missing-files', photos: 2, uploads: 2 }]);
    expect(checkMissingFiles(modelOf(c))).toEqual([]);
  });

  it('are left out of the other checks, which they would only repeat', () => {
    const before = modelOf(c);
    expect(checkNoLocation(before)[0].photos).toBe(2);
    expect(checkBadTimestamps(before).flatMap((x) => x.photos)).toHaveLength(2);
    const after = modelOf(c, { missing });
    expect(checkNoLocation(after)[0].photos).toBe(1);
    expect(checkBadTimestamps(after)).toEqual([]);
  });
});
