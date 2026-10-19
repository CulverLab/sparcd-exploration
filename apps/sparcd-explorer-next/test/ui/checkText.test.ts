import { describe, expect, it } from 'vitest';
import { NO_LOCATION_KEY, dataChecks, type DataCheck, type Model } from '../../src/data';
import { describeCheck } from '../../src/lib/checkText';
import { collection, deployment, media, modelOf, observation } from '../support/fixtures';

const TS = '2024-01-01T10:00:00';
const alpha = collection('Alpha', 'aaa')
  .upload('u1', {
    deployments: [deployment('AA01', 'Spring', 12.5, -100.25)],
    media: [media('u1', 'a.jpg', 'AA01', TS)],
  })
  .upload('u2', { deployments: [deployment('AA01', 'Spring', 12.6, -100.25)], media: [media('u2', 'b.jpg', 'AA01', TS)] })
  .upload('u3', { deployments: [deployment('aa-01', 'Spring', 12.5, -100.25)], media: [media('u3', 'c.jpg', 'aa-01', TS)] })
  .upload('u4', {
    deployments: [deployment('0000', '', null, null)],
    media: [media('u4', 'd.jpg', '0000', '2025-03-01T10:00:00')],
    observations: [observation('u4', 'd.jpg', '0000', '', { common: 'Owl' })],
  })
  .upload('u5', { deployments: [deployment('BB01', 'Bare', null, null)], media: [media('u5', 'e.jpg', 'BB01', 'never')] })
  .hide('u6')
  .hide('u7');
const bravo = collection('Bravo', 'bbb').upload('u1', {
  deployments: [deployment('AA01', 'Spring', 12.5, -100.25)],
  media: [media('u1', 'f.jpg', 'AA01', '2025-06-01T10:00:00')],
});
const model: Model = modelOf([alpha, bravo]);
const lineFor = (kind: DataCheck['kind']) => describeCheck(model, dataChecks(model).find((c) => c.kind === kind)!);

describe('data check sentences', () => {
  it('photos with no location, and an action that shows them in Photos', () => {
    const line = lineFor('no-location');
    expect(line.text).toBe('1 photo from 2025 has no location (ID 0000).');
    expect(line.action).toMatchObject({ label: 'Show this photo', kind: 'show', target: { locations: [NO_LOCATION_KEY], view: 'photos' } });
  });

  it('a moved camera, shown with each position on its own row', () => {
    const line = lineFor('moved');
    expect(line.text).toBe('AA01 sits at 2 positions, so the camera probably moved.');
    expect(line.action).toMatchObject({ kind: 'show', target: { locations: ['id:AA01'], separate: true } });
  });

  it('near-duplicate IDs, both shown', () => {
    const line = lineFor('near-duplicate-ids');
    expect(line.text).toBe('AA01 and aa-01 look like the same location.');
    expect(line.action).toMatchObject({ label: 'Show both IDs', target: { locations: ['id:AA01', 'id:aa-01'] } });
  });

  it('one location in two collections, with each one’s months', () => {
    expect(lineFor('shared-location').text).toBe(
      'AA01 appears in 2 collections: Alpha has Jan 2024 to Jan 2024, Bravo has Jun 2025 to Jun 2025.',
    );
  });

  it('hidden uploads, listed on request', () => {
    const line = lineFor('hidden-uploads');
    expect(line.text).toBe('2 uploads in Alpha are incomplete and hidden.');
    expect(line.action).toEqual({ label: 'List them', kind: 'list' });
    expect(line.details).toEqual(['u6', 'u7']);
  });

  it('a location with no coordinates, and dates that cannot be read', () => {
    expect(lineFor('no-coordinates').text).toBe("BB01 (Bare) has no coordinates, so it can't be placed on the map.");
    expect(lineFor('bad-timestamps').text).toBe(
      "1 photo in upload u5 has a date that can't be read, so it is left out of dates and activity.",
    );
  });

  it('a file that could not be read, with Try again', () => {
    const line = describeCheck(model, {
      kind: 'unreadable',
      collection: 0,
      folder: 'Collections/aaa/Uploads/u1/',
      file: 'media.csv',
      message: 'Access denied reading media.csv.',
    });
    expect(line.text).toBe("media.csv in upload u1 of Alpha couldn't be read, so its rows are missing (Access denied reading media.csv).");
    expect(line.action).toEqual({ label: 'Try again', kind: 'retry' });
  });
});
