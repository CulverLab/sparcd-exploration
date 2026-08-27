import { describe, it, expect } from 'vitest';
import {
  parseObservations,
  parseMedia,
  serializeMedia,
  parseCsvRows,
  parseTagMarkers,
  serializeTagMarkers,
  buildObservationComments,
  commonNameFromComments,
  requestedSpeciesFromComments,
  computeSpeciesDelta,
  applyUploadMetaEdit,
  parseUploadMeta,
  javaEditStamp,
  shiftTimestamp,
  correctedTimestamp,
  ZERO_OFFSET,
  validateCoordinates,
  validateColumnCount,
  OBS_COL,
  OBS_COLUMN_COUNT,
  MEDIA_COLUMN_COUNT,
  type MediaEdit,
} from '../src/index';
import { fixture } from './fixtures';

describe('uploader contract', () => {
  it('uploader writes one observations.csv row per file, species columns blank', () => {
    const obs = parseObservations(fixture('uploader-empty-v016', 'observations.csv'));
    expect(obs).toHaveLength(5);
    for (const o of obs) {
      expect(o.scientificName).toBe('');
      expect(o.tags).toBe('');
    }
    // count reads back as 0 (blank column), same as parseObservations always does.
    for (const o of obs) expect(o.count).toBe(0);
  });

  it('uploader media carries the DST-corrected naive capture time in col 4', () => {
    // The uploader is the writer-of-record for capture time: col 4 holds the
    // canonical naive wall-clock (no Z), matching the java-v016 media shape.
    const media = parseMedia(fixture('uploader-empty-v016', 'media.csv'));
    expect(media[0].timestamp).toBe('2024-01-10T08:00:00');
    for (const m of media) expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('serializeMedia honors a non-empty timestamp and still allows an empty one', () => {
    const base = {
      mediaId: 'k',
      deploymentId: 'd',
      mediaPath: 'k',
      fileName: 'f.jpg',
      mimeType: 'image/jpeg',
    };
    const withTs = serializeMedia([{ ...base, timestamp: '2024-07-15T15:00:00' }]);
    expect(parseMedia(withTs)[0].timestamp).toBe('2024-07-15T15:00:00');
    // Round-trips the canonical 11-col shape.
    expect(validateColumnCount(parseCsvRows(withTs), MEDIA_COLUMN_COUNT)).toBeNull();

    const blank = serializeMedia([{ ...base, timestamp: '' }]);
    expect(parseMedia(blank)[0].timestamp).toBe('');
  });
});

describe('retro-compatibility: lightweight readers find the fields', () => {
  const rows = parseCsvRows(fixture('tagger-edited-v016', 'observations.csv'));

  it('species in col 8, count in col 9, common name in col 19', () => {
    const coyote = rows.find((r) => r[OBS_COL.scientificName] === 'Canis latrans')!;
    expect(coyote[OBS_COL.count]).toBe('1');
    expect(coyote[OBS_COL.comments]).toBe('[COMMONNAME:Coyote]');
    expect(commonNameFromComments(coyote[OBS_COL.comments])).toBe('Coyote');
  });

  it('media id (col 3) matches a full key from media.csv', () => {
    const mediaKeys = new Set(parseMedia(fixture('tagger-edited-v016', 'media.csv')).map((m) => m.mediaId));
    for (const r of rows) expect(mediaKeys.has(r[OBS_COL.mediaId])).toBe(true);
  });

  it('requested species surfaces as a machine-readable marker', () => {
    const req = rows.find((r) => r[OBS_COL.comments].includes('REQUESTED_SPECIES'))!;
    expect(requestedSpeciesFromComments(req[OBS_COL.comments])).toBe('Jaguarundi');
  });

  it('every edited row keeps the fixed 20-column width', () => {
    expect(validateColumnCount(rows, OBS_COLUMN_COUNT)).toBeNull();
    expect(validateColumnCount(parseCsvRows(fixture('tagger-edited-v016', 'media.csv')), MEDIA_COLUMN_COUNT)).toBeNull();
  });
});

describe('tag marker grammar', () => {
  it('preserves and tolerates unknown prefixes', () => {
    const markers = parseTagMarkers('[COMMONNAME:Owl][FUTURE_THING:42][REQUESTED_SPECIES:Jaguarundi]');
    expect(markers).toEqual([
      { prefix: 'COMMONNAME', value: 'Owl' },
      { prefix: 'FUTURE_THING', value: '42' },
      { prefix: 'REQUESTED_SPECIES', value: 'Jaguarundi' },
    ]);
    expect(serializeTagMarkers(markers)).toBe(
      '[COMMONNAME:Owl][FUTURE_THING:42][REQUESTED_SPECIES:Jaguarundi]',
    );
  });

  it('builds comments from reserved fields plus carried-through markers', () => {
    expect(buildObservationComments({ commonName: 'Coyote' })).toBe('[COMMONNAME:Coyote]');
    expect(
      buildObservationComments({ requestedSpecies: 'Jaguarundi', extra: [{ prefix: 'X', value: 'y' }] }),
    ).toBe('[REQUESTED_SPECIES:Jaguarundi][X:y]');
  });
});

describe('UploadMeta delta', () => {
  const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
  const PREFIX = `Collections/${UUID}/Uploads/2024.01.15.10.00.00`;
  const detagEdit: MediaEdit[] = [
    {
      mediaId: `${PREFIX}/IMG003.JPG`,
      deploymentId: `${UUID}:SAN15`,
      timestamp: '2024-01-10T22:15:00',
      observations: [],
    },
  ];

  it('trusts a drifted stored tally instead of recomputing', () => {
    const delta = computeSpeciesDelta(fixture('java-v016', 'observations.csv'), detagEdit);
    expect(delta).toEqual({ detagged: 1, retagged: 0 });
    const drifted = applyUploadMetaEdit(parseUploadMeta(fixture('java-v016', 'UploadMeta.drifted.json')), {
      delta,
      user: 'jgonzalez',
      editStamp: '2024.01.20.14.30.00',
    });
    expect(drifted.imagesWithSpecies).toBe(98); // 99 (stored) - 1, NOT a recompute to 2
  });

  it('formats edit comments in the Java uuuu.MM.dd.HH.mm.ss style', () => {
    expect(javaEditStamp(new Date(2024, 0, 5, 9, 7, 3))).toBe('2024.01.05.09.07.03');
  });
});

describe('time correction', () => {
  it('applies a signed +1h offset and emits full ISO 8601 UTC', () => {
    expect(shiftTimestamp('2024-01-11T06:00:30.000Z', { ...ZERO_OFFSET, hours: 1 })).toBe(
      '2024-01-11T07:00:30.000Z',
    );
  });

  it('accepts legacy naive input too, upgrading it to full ISO on output', () => {
    expect(shiftTimestamp('2024-01-11T06:00:30', { ...ZERO_OFFSET, hours: 1 })).toBe(
      '2024-01-11T07:00:30.000Z',
    );
  });

  it('rolls second/day boundaries with exact-duration arithmetic', () => {
    expect(shiftTimestamp('2024-12-31T23:59:59.000Z', { ...ZERO_OFFSET, seconds: 1 })).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  // Month/year shifts must match the original desktop tooling's clamping
  // semantics (LocalDateTime.plusYears(...).plusMonths(...)) — each step CLAMPS
  // the day-of-month to the last valid day instead of overflowing into the next
  // month. This is a hard compatibility contract, not a stylistic choice.
  it('clamps month/year overflow to the last valid day, matching LocalDateTime semantics', () => {
    // Jan 31 + 1 month → Feb 29 (2024 leap), NOT Mar 2. Clamps to last Feb day.
    expect(shiftTimestamp('2024-01-31T00:00:00.000Z', { ...ZERO_OFFSET, months: 1 })).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    // Same shift in a non-leap year clamps to Feb 28.
    expect(shiftTimestamp('2023-01-31T00:00:00.000Z', { ...ZERO_OFFSET, months: 1 })).toBe(
      '2023-02-28T00:00:00.000Z',
    );
    // Leap day + 1 year → Feb 28 the next (non-leap) year.
    expect(shiftTimestamp('2024-02-29T12:00:00.000Z', { ...ZERO_OFFSET, years: 1 })).toBe(
      '2025-02-28T12:00:00.000Z',
    );
    // Order matters: plusYears clamps 29→28 first, then plusMonths carries that
    // 28 forward (→ Mar 28), NOT Mar 29. Proves the two clamps are sequential.
    expect(shiftTimestamp('2024-02-29T00:00:00.000Z', { ...ZERO_OFFSET, years: 1, months: 1 })).toBe(
      '2025-03-28T00:00:00.000Z',
    );
    // Negative month wraps the year correctly.
    expect(shiftTimestamp('2024-01-15T08:30:00.000Z', { ...ZERO_OFFSET, months: -1 })).toBe(
      '2023-12-15T08:30:00.000Z',
    );
    // Day/hour/minute/second offsets are exact durations applied after the clamp.
    expect(
      shiftTimestamp('2024-01-31T22:00:00.000Z', { ...ZERO_OFFSET, months: 1, days: 1, hours: 3 }),
    ).toBe('2024-03-02T01:00:00.000Z'); // Feb 29 (clamp) + 1d3h
  });

  it('per-image override wins over the upload offset', () => {
    expect(
      correctedTimestamp('2024-01-11T06:00:30.000Z', { ...ZERO_OFFSET, hours: 1 }, '2024-01-11T07:00:30.000Z'),
    ).toBe('2024-01-11T07:00:30.000Z');
    expect(correctedTimestamp('2024-01-11T06:00:30.000Z', { ...ZERO_OFFSET, hours: 1 }, null)).toBe(
      '2024-01-11T07:00:30.000Z',
    );
    expect(correctedTimestamp('2024-01-11T06:00:30.000Z', null, null)).toBe('2024-01-11T06:00:30.000Z');
  });
});

describe('validators', () => {
  it('passes in-range coordinates and flags out-of-range', () => {
    expect(validateCoordinates(31.5, -110.2)).toBeNull();
    expect(validateCoordinates(200, -110.2)).toMatch(/latitude/);
  });

  it('flags a likely lat/lng transposition', () => {
    expect(validateCoordinates(-110.2, 31.5)).toMatch(/transposed/);
  });
});
