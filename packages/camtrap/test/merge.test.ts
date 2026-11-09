import { describe, it, expect } from 'vitest';
import {
  type MediaEdit,
  mergeMedia,
  mergeObservations,
  computeSpeciesDelta,
  applyUploadMetaEdit,
  parseUploadMeta,
  serializeUploadMeta,
  parseObservations,
  parseCsvRows,
  OBS_COL,
  serializeCsvRows,
  buildObservationComments,
  removedSpeciesFromComments,
  needExpertFromComments,
  MEDIA_COL,
  reviewEventsFromComments,
} from '../src/index';
import { fixture } from './fixtures';

const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
const PREFIX = `Collections/${UUID}/Uploads/2024.01.15.10.00.00`;
const DEP = `${UUID}:SAN15`;
const k = (name: string) => `${PREFIX}/${name}`;

// The four edits the tagger-edited golden encodes (see _generate.mjs header).
const EDITS: MediaEdit[] = [
  {
    mediaId: k('IMG001.JPG'),
    deploymentId: DEP,
    timestamp: '2024-01-10T08:00:00',
    observations: [{ scientificName: 'Canis latrans', count: 1, commonName: 'Coyote' }],
  },
  {
    mediaId: k('IMG002.JPG'),
    deploymentId: DEP,
    timestamp: '2024-01-10T08:00:30',
    observations: [
      { scientificName: 'Odocoileus hemionus', count: 1, commonName: 'Mule Deer' },
      { scientificName: 'Jaguarundi', count: 1, requestedSpecies: 'Jaguarundi' },
    ],
  },
  {
    mediaId: k('IMG003.JPG'),
    deploymentId: DEP,
    timestamp: '2024-01-10T22:15:00',
    observations: [], // detag
  },
  {
    mediaId: k('IMG005.JPG'),
    deploymentId: DEP,
    timestamp: '2024-01-11T07:00:30',
    mediaTimestamp: '2024-01-11T07:00:30', // per-image time correction
    observations: [{ scientificName: 'Casper', count: 1, commonName: 'Ghost' }],
  },
];

describe('Need expert media marker', () => {
  const source = fixture('java-v016', 'media.csv');
  const statusEdit = (value: boolean): MediaEdit => ({
    mediaId: k('IMG001.JPG'), deploymentId: DEP, timestamp: '2024-01-10T08:00:00',
    observations: [], needExpert: value,
  });

  it('adds, reads, clears, and preserves unrelated comments without touching other rows', () => {
    const original = parseCsvRows(source);
    original[0][MEDIA_COL.comments] = 'field note [TIMESTAMP:spread][FUTURE:yes]';
    const withNote = serializeCsvRows(original);
    const marked = parseCsvRows(mergeMedia(withNote, [statusEdit(true)]));
    expect(needExpertFromComments(marked[0][MEDIA_COL.comments])).toBe(true);
    expect(marked[0][MEDIA_COL.comments]).toBe('field note [TIMESTAMP:spread][FUTURE:yes][NEED_EXPERT:true]');
    expect(marked.slice(1)).toEqual(original.slice(1));
    const cleared = parseCsvRows(mergeMedia(serializeCsvRows(marked), [statusEdit(false)]));
    expect(needExpertFromComments(cleared[0][MEDIA_COL.comments])).toBe(false);
    expect(cleared[0][MEDIA_COL.comments]).toBe(original[0][MEDIA_COL.comments]);
  });

  it('combines status and time edits for one media row', () => {
    const rows = parseCsvRows(mergeMedia(source, [
      { ...statusEdit(true), mediaTimestamp: '2024-01-10T09:00:00', timestampSource: 'manual' },
    ]));
    expect(rows[0][MEDIA_COL.timestamp]).toBe('2024-01-10T09:00:00');
    expect(needExpertFromComments(rows[0][MEDIA_COL.comments])).toBe(true);
  });
});

describe('tagger merge contract → tagger-edited-v016 golden', () => {
  it('observations merge is byte-for-byte', () => {
    const out = mergeObservations(fixture('java-v016', 'observations.csv'), EDITS);
    expect(out).toBe(fixture('tagger-edited-v016', 'observations.csv'));
  });

  it('media time correction is byte-for-byte (only IMG005 col 4 changes)', () => {
    const out = mergeMedia(fixture('java-v016', 'media.csv'), EDITS);
    expect(out).toBe(fixture('tagger-edited-v016', 'media.csv'));
  });

  it('UploadMeta delta + edit comment is byte-for-byte', () => {
    const delta = computeSpeciesDelta(fixture('java-v016', 'observations.csv'), EDITS);
    expect(delta).toEqual({ detagged: 1, retagged: 2 });
    const meta = applyUploadMetaEdit(parseUploadMeta(fixture('java-v016', 'UploadMeta.json')), {
      delta,
      user: 'jgonzalez',
      editStamp: '2024.01.20.14.30.00',
    });
    expect(serializeUploadMeta(meta)).toBe(fixture('tagger-edited-v016', 'UploadMeta.json'));
    expect(meta.imagesWithSpecies).toBe(4); // 3 - 1 + 2
  });
});

describe('no accidental data loss', () => {
  it('leaves observation bytes untouched when a media-only status changes', () => {
    const original = fixture('java-v016', 'observations.csv').trimEnd();
    expect(mergeObservations(original, [])).toBe(original);
  });
  const merged = parseObservations(mergeObservations(fixture('java-v016', 'observations.csv'), EDITS));

  it('keeps the unrelated IMG004 survivor row untouched', () => {
    const survivor = merged.find((o) => o.mediaId === k('IMG004.JPG'))!;
    expect(survivor.observationId).toBe('obs-img4-0');
    expect(survivor.scientificName).toBe('Puma concolor');
    // The full raw row (incl. behaviour/taxon_id/etc.) is preserved verbatim.
    const rawSurvivor = fixture('java-v016', 'observations.csv')
      .split('\n')
      .find((l) => l.includes('IMG004'));
    expect(mergeObservations(fixture('java-v016', 'observations.csv'), EDITS)).toContain(
      rawSurvivor!,
    );
  });

  it('detag writes a blank placeholder row instead of removing the row', () => {
    const detagged = merged.find((o) => o.mediaId === k('IMG003.JPG'))!;
    expect(detagged).toBeDefined();
    expect(detagged.observationType).toBe('blank');
    expect(detagged.scientificName).toBe('');
  });

  it('serializes and parses explicit removed-species markers', () => {
    const comments = buildObservationComments({
      removedSpecies: ['Puma concolor', 'Canis latrans'],
    });
    expect(comments).toBe('[REMOVED:Puma concolor][REMOVED:Canis latrans]');
    expect(removedSpeciesFromComments(comments)).toEqual(['Puma concolor', 'Canis latrans']);
  });

  it('keeps removal provenance on a full detag placeholder row', () => {
    const mediaId = k('IMG004.JPG');
    const canonical = fixture('java-v016', 'observations.csv');
    const merged = parseObservations(mergeObservations(canonical, [{
      mediaId,
      deploymentId: DEP,
      timestamp: '2024-01-10T22:15:00',
      removedSpecies: ['Puma concolor'],
      observations: [],
    }]));
    const row = merged.find((o) => o.mediaId === mediaId)!;
    expect(row.observationType).toBe('blank');
    expect(row.tags).toContain('[REMOVED:Puma concolor]');
  });
});

describe('zero-count filtering (sparcd-web parity)', () => {
  it('drops a zero-count observation and writes a blank placeholder row', () => {
    const edit: MediaEdit[] = [
      {
        mediaId: k('IMG001.JPG'),
        deploymentId: DEP,
        timestamp: '2024-01-10T08:00:00',
        observations: [{ scientificName: 'Odocoileus hemionus', count: 0, commonName: 'Mule Deer' }],
      },
    ];
    const out = parseObservations(mergeObservations(fixture('java-v016', 'observations.csv'), edit));
    const row = out.find((o) => o.mediaId === k('IMG001.JPG'))!;
    expect(row).toBeDefined();
    expect(row.observationType).toBe('blank');
    expect(row.scientificName).toBe('');
    expect(computeSpeciesDelta(fixture('java-v016', 'observations.csv'), edit)).toEqual({
      detagged: 1,
      retagged: 0,
    });
  });
});

describe('classified_by provenance', () => {
  it('serializes repeatable review events as paired markers and parses them back', () => {
    const events = [
      { reviewedBy: 'harold', reviewedAt: '2024-01-20T14:30:00.000Z' },
      { reviewedBy: 'anita', reviewedAt: '2024-01-21T09:00:00.000Z' },
    ];
    const comments = buildObservationComments({ commonName: 'Coyote', reviewEvents: events });
    expect(comments).toBe(
      '[COMMONNAME:Coyote][REVIEWED_BY:harold][REVIEWED_AT:2024-01-20T14:30:00.000Z]' +
      '[REVIEWED_BY:anita][REVIEWED_AT:2024-01-21T09:00:00.000Z]',
    );
    expect(reviewEventsFromComments(comments)).toEqual(events);
  });

  it('ignores unmatched markers without shifting later reviewer timestamps', () => {
    expect(reviewEventsFromComments(
      '[REVIEWED_AT:orphan][REVIEWED_BY:harold][REVIEWED_AT:2024-01-20T14:30:00.000Z]',
    )).toEqual([{ reviewedBy: 'harold', reviewedAt: '2024-01-20T14:30:00.000Z' }]);
  });

  it('preserves review markers when replacing an observation row', () => {
    const canonical = serializeCsvRows([
      ['obs-1', DEP, '', k('IMG001.JPG'), '2024-01-10T08:00:00', 'animal', '', '', 'Canis latrans', '1', '', '', '', '', '', '', 'anita', '2024-01-10T09:00:00.000Z', '', '[REVIEWED_BY:harold][REVIEWED_AT:2024-01-20T14:30:00.000Z]'],
    ]);
    const out = parseObservations(mergeObservations(canonical, [{
      mediaId: k('IMG001.JPG'), deploymentId: DEP, timestamp: '2024-01-10T08:00:00',
      observations: [{ scientificName: 'Canis latrans', count: 2, classifiedBy: 'anita', reviewEvents: [{ reviewedBy: 'harold', reviewedAt: '2024-01-20T14:30:00.000Z' }] }],
    }]));
    expect(out[0].reviewEvents).toEqual([{ reviewedBy: 'harold', reviewedAt: '2024-01-20T14:30:00.000Z' }]);
  });

  it('carries existing attribution onto replacement rows', () => {
    const canonical = serializeCsvRows([
      ['obs-1', DEP, '', k('IMG001.JPG'), '2024-01-10T08:00:00', 'animal', '', '', 'Canis latrans', '1', '', 'Adult', '', 'Walking', 'ind-1', '', 'anita', '', '0.95', '[OTHER:keep]'],
    ]);
    const out = parseObservations(mergeObservations(canonical, [{
      mediaId: k('IMG001.JPG'), deploymentId: DEP, timestamp: '2024-01-10T08:00:00',
      observations: [{ scientificName: 'Canis latrans', count: 2, commonName: 'Coyote', classifiedBy: 'anita' }],
    }]));
    expect(out[0].classifiedBy).toBe('anita');
    const row = parseCsvRows(mergeObservations(canonical, [{
      mediaId: k('IMG001.JPG'), deploymentId: DEP, timestamp: '2024-01-10T08:00:00',
      observations: [{ scientificName: 'Canis latrans', count: 2, commonName: 'Coyote', classifiedBy: 'anita' }],
    }]))[0];
    expect(row[OBS_COL.lifeStage]).toBe('Adult');
    expect(row[OBS_COL.behaviour]).toBe('Walking');
    expect(row[OBS_COL.individualId]).toBe('ind-1');
    expect(row[OBS_COL.classificationConfidence]).toBe('0.95');
    expect(row[OBS_COL.comments]).toContain('[OTHER:keep]');
  });

  it('carries the old row onto its replacement when the producer left observation_type empty', () => {
    const canonical = serializeCsvRows([
      ['obs-1', DEP, '', k('IMG001.JPG'), '2024-01-10T08:00:00', '', '', '', 'Canis latrans', '1', '', 'Adult', '', 'Walking', 'ind-1', '', 'anita', '', '0.95', '[OTHER:keep]'],
    ]);
    const row = parseCsvRows(mergeObservations(canonical, [{
      mediaId: k('IMG001.JPG'), deploymentId: DEP, timestamp: '2024-01-10T08:00:00',
      observations: [{ scientificName: 'Canis latrans', count: 2, commonName: 'Coyote', classifiedBy: 'anita' }],
    }]))[0];
    expect(row[OBS_COL.lifeStage]).toBe('Adult');
    expect(row[OBS_COL.behaviour]).toBe('Walking');
    expect(row[OBS_COL.individualId]).toBe('ind-1');
    expect(row[OBS_COL.comments]).toContain('[OTHER:keep]');
  });

  // #368: a review (confirm or correction) records who and when — col 17
  // round-trips the same way col 16 (classified_by) already does.
  it('writes and reads back classification_timestamp alongside classified_by', () => {
    // Column order per OBS_COL: id, deploymentId, sequenceId, mediaId,
    // timestamp, observationType, cameraSetup, taxonId, scientificName,
    // count, countNew, lifeStage, sex, behaviour, individualId,
    // classificationMethod, classifiedBy, classificationTimestamp,
    // classificationConfidence, comments.
    const canonical = serializeCsvRows([
      ['obs-1', DEP, '', k('IMG001.JPG'), '2024-01-10T08:00:00', 'animal', '', '', 'Canis latrans', '1', '', '', '', '', '', '', 'anita', '2024-01-10T09:00:00.000Z', '', ''],
    ]);
    const out = parseObservations(mergeObservations(canonical, [{
      mediaId: k('IMG001.JPG'), deploymentId: DEP, timestamp: '2024-01-10T08:00:00',
      observations: [{
        scientificName: 'Canis latrans', count: 1, commonName: 'Coyote',
        classifiedBy: 'harold', classificationTimestamp: '2024-01-20T14:30:00.000Z',
      }],
    }]));
    expect(out).toHaveLength(1); // the edit replaces the row, not appends alongside it
    expect(out[0].classifiedBy).toBe('harold');
    expect(out[0].classificationTimestamp).toBe('2024-01-20T14:30:00.000Z');
  });
});

describe('a blank edit time keeps the times the rows hold', () => {
  // SPARC'd web left some media.csv times blank; the Tagger stamps rows from
  // media.csv, so its edit time is blank while the rows hold the camera's time.
  const row = (mediaId: string, timestamp: string, scientificName: string, type = 'animal') => {
    const r = new Array<string>(20).fill('');
    r[OBS_COL.observationId] = `${mediaId}:${scientificName}`;
    r[OBS_COL.deploymentId] = DEP;
    r[OBS_COL.mediaId] = mediaId;
    r[OBS_COL.timestamp] = timestamp;
    r[OBS_COL.observationType] = type;
    r[OBS_COL.scientificName] = scientificName;
    r[OBS_COL.count] = '1';
    return r;
  };
  const A = k('A.JPG');
  const B = k('B.JPG');
  const csv = serializeCsvRows([
    row(A, '2024-01-10T08:00:00.000Z', 'Odocoileus hemionus'),
    row(A, '2024-01-09T05:30:00', 'Canis latrans'),
    row(B, '2024-01-09T06:00:00', 'Lynx rufus'),
  ]);
  const timesOf = (out: string, mediaId: string) =>
    Object.fromEntries(parseObservations(out).filter((o) => o.mediaId === mediaId).map((o) => [o.scientificName || o.observationType, o.timestamp]));
  const edit = (observations: MediaEdit['observations'], timestamp = ''): MediaEdit => ({ mediaId: A, deploymentId: DEP, timestamp, observations });

  it('keeps each species row its own time, and gives a new species the earliest', () => {
    const out = mergeObservations(csv, [
      edit([
        { scientificName: 'Odocoileus hemionus', count: 2 },
        { scientificName: 'Canis latrans', count: 1 },
        { scientificName: 'Puma concolor', count: 1 },
      ]),
    ]);
    expect(timesOf(out, A)).toEqual({
      'Odocoileus hemionus': '2024-01-10T08:00:00.000Z',
      'Canis latrans': '2024-01-09T05:30:00',
      'Puma concolor': '2024-01-09T05:30:00',
    });
    expect(timesOf(out, B)).toEqual({ 'Lynx rufus': '2024-01-09T06:00:00' });
  });

  it('gives the placeholder row of a full detag the earliest time', () => {
    expect(timesOf(mergeObservations(csv, [edit([])]), A)).toEqual({ blank: '2024-01-09T05:30:00' });
  });

  it('still stamps every row with a time the edit has', () => {
    const out = mergeObservations(csv, [edit([{ scientificName: 'Canis latrans', count: 1 }, { scientificName: 'Puma concolor', count: 1 }], '2024-01-09T05:31:00')]);
    expect(timesOf(out, A)).toEqual({ 'Canis latrans': '2024-01-09T05:31:00', 'Puma concolor': '2024-01-09T05:31:00' });
  });

  it('leaves a new image with no rows and no time blank', () => {
    const out = mergeObservations(csv, [{ ...edit([{ scientificName: 'Canis latrans', count: 1 }]), mediaId: k('NEW.JPG') }]);
    expect(timesOf(out, k('NEW.JPG'))).toEqual({ 'Canis latrans': '' });
  });
});
