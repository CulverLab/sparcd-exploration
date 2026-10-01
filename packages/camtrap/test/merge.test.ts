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
