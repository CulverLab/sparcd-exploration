// The canonical media↔observations join the Tag workspace grounds on. Pure;
// the data-contract details (column positions, marker grammar) are proven in
// `@sparcd/camtrap` — this only checks the join + the seeded base state.

import { describe, it, expect } from 'vitest';
import { serializeCsvRows, serializeObservations, MEDIA_COLUMN_COUNT } from '@sparcd/camtrap';
import { buildTagImages, isVideoKey } from '../src/lib/workspace';

// Real canonical media (Java / sparcd-web) carries the capture time in col 4,
// unlike the uploader's initial empty-timestamp write — build raw rows so the
// seeding test reflects what the workspace actually grounds on.
function mediaRow(key: string, deployment: string, timestamp: string, fileName: string): string[] {
  const row = new Array<string>(MEDIA_COLUMN_COUNT).fill('');
  row[0] = key; // media_id (= full key)
  row[1] = deployment;
  row[4] = timestamp;
  row[6] = fileName;
  row[7] = 'image/jpeg';
  return row;
}

const mediaCsv = serializeCsvRows([
  mediaRow('Collections/c/Uploads/u/IMG001.JPG', 'c:loc-a', '2024-01-01T08:00:00', 'IMG001.JPG'),
  mediaRow('Collections/c/Uploads/u/IMG002.JPG', 'c:loc-a', '2024-01-01T08:01:00', 'IMG002.JPG'),
]);

// IMG001 already tagged Coyote with a common-name marker; IMG002 untagged.
const obsCsv = serializeObservations([
  {
    observationId: 'o1',
    mediaId: 'Collections/c/Uploads/u/IMG001.JPG',
    deploymentId: 'c:loc-a',
    timestamp: '2024-01-01T08:00:00',
    observationType: 'animal',
    scientificName: 'Canis latrans',
    count: 2,
    tags: '[COMMONNAME:Coyote]',
    classifiedBy: 'anita',
  },
]);

// A second, multi-species fixture: IMG001 has TWO canonical observation rows.
const multiMediaCsv = serializeCsvRows([
  mediaRow('Collections/c/Uploads/u/IMG001.JPG', 'c:loc-a', '2024-01-01T08:00:00', 'IMG001.JPG'),
]);
const multiObsCsv = serializeObservations([
  {
    observationId: 'o1',
    mediaId: 'Collections/c/Uploads/u/IMG001.JPG',
    deploymentId: 'c:loc-a',
    timestamp: '2024-01-01T08:00:00',
    observationType: 'animal',
    scientificName: 'Odocoileus hemionus',
    count: 3,
    tags: '[COMMONNAME:Mule Deer]',
  },
  {
    observationId: 'o2',
    mediaId: 'Collections/c/Uploads/u/IMG001.JPG',
    deploymentId: 'c:loc-a',
    timestamp: '2024-01-01T08:00:00',
    observationType: 'animal',
    scientificName: 'Canis latrans',
    count: 1,
    tags: '[COMMONNAME:Coyote]',
  },
]);

// A blank-row fixture: IMG001 has a placeholder observation (observationType: 'blank').
const blankObsCsv = serializeObservations([
  {
    observationId: 'IMG001.JPG:0',
    mediaId: 'Collections/c/Uploads/u/IMG001.JPG',
    deploymentId: 'c:loc-a',
    timestamp: '',
    observationType: 'blank',
    scientificName: '',
    tags: '',
  },
]);

describe('buildTagImages', () => {
  const images = buildTagImages({ mediaCsv, observationsCsv: obsCsv });

  it('lists every media row in media order', () => {
    expect(images.map((i) => i.fileName)).toEqual(['IMG001.JPG', 'IMG002.JPG']);
  });

  it('seeds base species, common name, and count from existing observations', () => {
    expect(images[0]).toMatchObject({
      deploymentId: 'c:loc-a',
      baseTimestamp: '2024-01-01T08:00:00',
    });
    expect(images[0].baseObservations).toEqual([
      { scientificName: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: '', freeTags: '', classifiedBy: 'anita' },
    ]);
  });

  it('leaves untagged media with an empty base observation set', () => {
    expect(images[1].baseObservations).toEqual([]);
  });

  it('exposes BOTH observation rows for a multi-species image, in CSV order', () => {
    const multi = buildTagImages({ mediaCsv: multiMediaCsv, observationsCsv: multiObsCsv });
    expect(multi[0].baseObservations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
      'Canis latrans',
    ]);
    expect(multi[0].baseObservations[0].count).toBe(3);
  });

  it('preserves review events so the UI can distinguish reviewed identifications', () => {
    const reviewed = serializeObservations([
      {
        observationId: 'reviewed',
        mediaId: 'Collections/c/Uploads/u/IMG001.JPG',
        deploymentId: 'c:loc-a',
        timestamp: '2024-01-01T08:00:00',
        observationType: 'animal',
        scientificName: 'Canis latrans',
        count: 1,
        tags: '[COMMONNAME:Coyote][REVIEWED_BY:harold][REVIEWED_AT:2024-01-02T09:00:00.000Z]',
      },
    ]);
    expect(buildTagImages({ mediaCsv, observationsCsv: reviewed })[0].baseObservations[0].reviewEvents).toEqual([
      { reviewedBy: 'harold', reviewedAt: '2024-01-02T09:00:00.000Z' },
    ]);
  });

  it('treats a blank placeholder row as untagged (empty base observations)', () => {
    const blank = buildTagImages({ mediaCsv, observationsCsv: blankObsCsv });
    expect(blank[0].baseObservations).toEqual([]);
    expect(blank[1].baseObservations).toEqual([]);
  });
});

describe('isVideoKey', () => {
  it('matches video extensions case-insensitively', () => {
    for (const k of ['a/b/IMG.mp4', 'clip.MP4', 'x.avi', 'y.mov', 'z.m4v']) {
      expect(isVideoKey(k)).toBe(true);
    }
  });

  it('rejects image and non-media keys', () => {
    for (const k of ['p.jpg', 'q.jpeg', 'r.csv', 'noext', 'mp4.jpg']) {
      expect(isVideoKey(k)).toBe(false);
    }
  });
});
