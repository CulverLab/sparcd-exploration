import { describe, expect, it } from 'vitest';
import type { UploadMetaJson } from '@sparcd/camtrap';
import { buildModel, checkBadTimestamps, checkTimesFromTags, dayNumber, formatTimestamp24, parseLocalTimestamp } from '../src/data';
import { collection, deployment, media, modelOf, observation } from './support/fixtures';

describe('parseLocalTimestamp', () => {
  it('reads the camera wall clock with no UTC conversion', () => {
    // 23:30 at -07:00 is the next day in UTC; the photo still belongs to the 10th.
    expect(parseLocalTimestamp('2024-03-10T23:30:00.000-07:00')).toMatchObject({
      date: '2024-03-10',
      year: 2024,
      month: 3,
      hour: 23,
    });
    // A legacy Z timestamp is read for its written fields too.
    expect(parseLocalTimestamp('2024-03-10T01:15:00Z')).toMatchObject({ date: '2024-03-10', hour: 1 });
  });

  it('accepts naive and space-separated timestamps and date-only values', () => {
    expect(parseLocalTimestamp('2018-06-15T10:00:00')?.hour).toBe(10);
    expect(parseLocalTimestamp('2018-06-15 21:05')?.hour).toBe(21);
    expect(parseLocalTimestamp('2018-06-15')).toMatchObject({ date: '2018-06-15', hour: null });
  });

  it('returns null for timestamps that do not parse', () => {
    for (const bad of ['', 'unknown', '0000-00-00T00:00:00', '2023-02-30T10:00:00', '2024-13-01T00:00:00', '2024-01-01T25:00:00']) {
      expect(parseLocalTimestamp(bad), bad).toBeNull();
    }
  });

  it('accepts seconds, a fraction and a Z or ±hh:mm offset, without applying the offset', () => {
    expect(parseLocalTimestamp('2024-01-01T10:20:30')).toMatchObject({ date: '2024-01-01', hour: 10 });
    expect(parseLocalTimestamp('2024-01-01T10:20:30.123456')?.hour).toBe(10);
    expect(parseLocalTimestamp('2024-01-01T23:59:59+14:00')).toMatchObject({ date: '2024-01-01', hour: 23 });
    expect(parseLocalTimestamp('2024-01-01T00:00:00-12:00')).toMatchObject({ date: '2024-01-01', hour: 0 });
    expect(parseLocalTimestamp('2024-01-01 10:20Z')?.hour).toBe(10);
  });

  it('rejects text that only starts like a timestamp, or has out-of-range fields', () => {
    for (const bad of [
      '2024-01-01Tgarbage',
      '2024-01-01blah',
      '2024-01-01T10:20:99',
      '2024-01-01T10:60:00',
      '2024-01-01T10',
      '2024-01-01T10:20:30.',
      '2024-01-01T10:20:30+25:00',
      '2024-01-01T10:20:30+05:61',
      '2024-01-01T10:20:30 PDT',
      '2024-01-01Z',
    ]) {
      expect(parseLocalTimestamp(bad), bad).toBeNull();
    }
  });

  it('sends unparseable timestamps to the bad-timestamp data check', () => {
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'ok.jpg', 'AA01', '2024-01-01T10:20:30'), media('u1', 'bad.jpg', 'AA01', '2024-01-01T10:20:99')],
      }),
    );
    expect(checkBadTimestamps(model)).toEqual([{ kind: 'bad-timestamps', upload: 0, photos: [1] }]);
  });

  it('numbers days so ranges compare as integers', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(parseLocalTimestamp('2024-01-01T00:00:00')!.day).toBe(dayNumber('2024-01-01'));
  });
});

describe('formatTimestamp24', () => {
  it('shows late hours in 24-hour form without AM/PM', () => {
    expect(formatTimestamp24('2026-09-11T22:15:10.000Z')).toBe('2026-09-11 22:15:10');
  });

  it('shows a missing timestamp as empty', () => {
    expect(formatTimestamp24(null)).toBe('');
    expect(formatTimestamp24(undefined)).toBe('');
  });
});

describe('photos whose media.csv has no time', () => {
  // SPARC'd web wrote these rows blank; the tags kept the camera's time.
  const U = '2024.03.05.10.00.00_fielduser';
  const OWL = { common: 'Owl' };
  const upload = (observations: ReturnType<typeof observation>[], mediaTime = '') =>
    collection().upload(U, {
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: [media(U, 'a.jpg', 'AA01', mediaTime)],
      observations,
    });
  const photo = (c: ReturnType<typeof upload>, missing: string[] = []) => modelOf(c, { missing }).photos[0];

  it('take the camera time from their tags, marked as such', () => {
    const p = photo(upload([observation(U, 'a.jpg', 'AA01', '2024-03-01T23:40:00', OWL)]));
    expect(p).toMatchObject({ timestamp: '2024-03-01T23:40:00', date: '2024-03-01', year: 2024, month: 3, hour: 23, timeFromTags: true });
    expect(p.timeKey).toBe(parseLocalTimestamp('2024-03-01T23:40:00')!.key);
  });

  it('take the earliest when the tags disagree', () => {
    const p = photo(
      upload([
        observation(U, 'a.jpg', 'AA01', '2024-03-02T08:00:00', OWL),
        observation(U, 'a.jpg', 'AA01', '2024-03-01T07:00:00', { common: 'Fox' }),
      ]),
    );
    expect(p.timestamp).toBe('2024-03-01T07:00:00');
  });

  it('ignore upload and tagging times: a fraction, a zone, or a date after the upload', () => {
    for (const time of ['2024-03-01T10:00:00.123Z', '2024-03-01T10:00:00+00:00', '2024-03-01T10:00:00.123456', '2024-03-01T10:00', '2024-03-06T10:00:00']) {
      const p = photo(upload([observation(U, 'a.jpg', 'AA01', time, OWL)]));
      expect(p, time).toMatchObject({ timestamp: '', date: null, timeKey: null, timeFromTags: false });
    }
    expect(photo(upload([observation(U, 'a.jpg', 'AA01', '2024-03-05T09:00:00', OWL)])).date).toBe('2024-03-05');
  });

  it('bound the date by UploadMeta.json when the upload has one', () => {
    const loaded = upload([observation(U, 'a.jpg', 'AA01', '2024-03-04T09:00:00', OWL)]).build();
    loaded.uploads[0].meta = { uploadDate: { date: { year: 2024, month: 3, day: 3 } } } as UploadMetaJson;
    expect(buildModel([loaded]).photos[0].date).toBeNull();
  });

  it('keep the time media.csv has, whatever the tags say', () => {
    const p = photo(upload([observation(U, 'a.jpg', 'AA01', '2024-03-01T07:00:00', OWL)], '2024-03-02T08:00:00'));
    expect(p).toMatchObject({ timestamp: '2024-03-02T08:00:00', timeFromTags: false });
  });

  it('are counted in their own data check, and left out of the unreadable one', () => {
    const c = collection().upload(U, {
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: [media(U, 'a.jpg', 'AA01'), media(U, 'b.jpg', 'AA01'), media(U, 'gone.jpg', 'AA01')],
      observations: [
        observation(U, 'a.jpg', 'AA01', '2024-03-01T07:00:00', OWL),
        observation(U, 'b.jpg', 'AA01', '2024-03-05T17:00:00.123Z', OWL),
        observation(U, 'gone.jpg', 'AA01', '2024-03-01T08:00:00', OWL),
      ],
    });
    const model = modelOf(c, { missing: [`sparcd-test/${media(U, 'gone.jpg', 'AA01').mediaPath}`] });
    expect(checkTimesFromTags(model)).toEqual([{ kind: 'times-from-tags', photos: [0], uploads: 1 }]);
    expect(checkBadTimestamps(model)).toEqual([{ kind: 'bad-timestamps', upload: 0, photos: [1] }]);
  });
});
