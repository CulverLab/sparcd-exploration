// The mock collection the whole feature suite runs against. Shapes follow the
// v016 Camtrap-DP-flavoured contract in `@sparcd/camtrap` (fixed-position CSV
// columns; `media.csv` col 0 is the full object key, col 4 the capture time).

import { MockS3 } from './s3mock';
import { makePng } from './png';

export const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
export const BUCKET = `sparcd-${UUID}`;
export const COLLECTION_KEY = `${BUCKET}::${UUID}`;
export const COLLECTION_NAME = 'Educational Test';

export const UUID_B = '11111111-2222-3333-4444-555555555555';
export const BUCKET_B = `sparcd-${UUID_B}`;
export const COLLECTION_B_NAME = 'Backcountry Survey';

export const SETTINGS_BUCKET = 'sparcd-settings-test';

export const STAMP_A = '2024.01.15.10.00.00_priortagger';
export const STAMP_B = '2023.06.01.09.30.00_fielduser';
export const PREFIX_A = `Collections/${UUID}/Uploads/${STAMP_A}/`;
export const PREFIX_B = `Collections/${UUID}/Uploads/${STAMP_B}/`;

export const DEPLOYMENT = `${UUID}:SAN15`;
export const LOCATION_NAME = 'San Pedro 15';

const q = (v: string): string => `"${v.replace(/"/g, '""')}"`;
const row = (cells: string[], width: number): string =>
  Array.from({ length: width }, (_, i) => q(cells[i] ?? '')).join(',');

const MEDIA_WIDTH = 11;
const OBS_WIDTH = 20;
const DEPLOY_WIDTH = 23;

export type MediaSpec = { file: string; timestamp: string; mime: string };

/** Upload A — the workhorse: six frames, mixed tagging, one clip, one untimed. */
export const MEDIA_A: MediaSpec[] = [
  { file: 'IMG001.JPG', timestamp: '2024-01-10T08:00:00', mime: 'image/jpeg' },
  { file: 'IMG002.JPG', timestamp: '2024-01-10T08:00:30', mime: 'image/jpeg' },
  { file: 'IMG003.JPG', timestamp: '2024-01-10T22:15:00', mime: 'image/jpeg' },
  { file: 'IMG004.JPG', timestamp: '2024-01-11T06:00:00', mime: 'image/jpeg' },
  { file: 'IMG005.JPG', timestamp: '2024-01-11T06:00:30', mime: 'image/jpeg' },
  { file: 'VID001.MP4', timestamp: '', mime: 'video/mp4' },
];

export const MEDIA_B: MediaSpec[] = [
  { file: 'FOX001.JPG', timestamp: '2023-05-30T19:00:00', mime: 'image/jpeg' },
  { file: 'FOX002.JPG', timestamp: '2023-05-30T19:00:20', mime: 'image/jpeg' },
];

export const mediaKey = (prefix: string, file: string): string => `${prefix}${file}`;

export function mediaCsv(prefix: string, specs: MediaSpec[]): string {
  return specs
    .map((m) => {
      const key = mediaKey(prefix, m.file);
      const cells: string[] = [];
      cells[0] = key;
      cells[1] = DEPLOYMENT;
      cells[2] = key;
      cells[3] = '';
      cells[4] = m.timestamp;
      cells[5] = key;
      cells[6] = m.file;
      cells[7] = m.mime;
      cells[8] = '';
      cells[9] = 'false';
      cells[10] = '';
      return row(cells, MEDIA_WIDTH);
    })
    .join('\n');
}

export type ObsSpec = {
  id: string;
  file: string;
  timestamp: string;
  scientificName: string;
  count: number;
  comments: string;
  /** Columns the tagger does not model, carried through a sync verbatim. */
  extras?: Record<number, string>;
};

/** Existing identifications on upload A, from three different producers. */
export const OBS_A: ObsSpec[] = [
  {
    id: 'obs-img1-0',
    file: 'IMG001.JPG',
    timestamp: '2024-01-10T08:00:00',
    scientificName: 'Odocoileus hemionus',
    count: 2,
    comments: '[COMMONNAME:Mule Deer]',
  },
  {
    id: 'obs-img3-0',
    file: 'IMG003.JPG',
    timestamp: '2024-01-10T22:15:00',
    scientificName: 'Casper',
    count: 1,
    comments: '[COMMONNAME:Ghost]',
  },
  {
    id: 'obs-img4-0',
    file: 'IMG004.JPG',
    timestamp: '2024-01-11T06:00:00',
    scientificName: 'Puma concolor',
    count: 1,
    comments: '[COMMONNAME:Mountain Lion]',
    extras: {
      7: 'ITIS:552479',
      11: 'Adult',
      12: 'Unknown',
      13: 'Walking',
      14: 'ind-7',
      15: 'human',
      16: 'jdoe',
      17: '2024-01-12T09:00:00',
      18: '0.95',
    },
  },
  {
    id: 'obs-img4-1',
    file: 'IMG004.JPG',
    timestamp: '2024-01-11T06:00:00',
    scientificName: 'Canis latrans',
    count: 3,
    comments: '[COMMONNAME:Coyote][REQUESTED_SPECIES:Grey Wolf]',
  },
];

export const OBS_B: ObsSpec[] = [
  {
    id: 'obs-fox1-0',
    file: 'FOX001.JPG',
    timestamp: '2023-05-30T19:00:00',
    scientificName: 'Canis latrans',
    count: 1,
    comments: '[COMMONNAME:Coyote]',
  },
  {
    id: 'obs-fox2-0',
    file: 'FOX002.JPG',
    timestamp: '2023-05-30T19:00:20',
    scientificName: 'Canis latrans',
    count: 1,
    comments: '[COMMONNAME:Coyote]',
  },
];

export function observationsCsv(prefix: string, specs: ObsSpec[]): string {
  return specs
    .map((o) => {
      const cells: string[] = [];
      cells[0] = o.id;
      cells[1] = DEPLOYMENT;
      cells[2] = '';
      cells[3] = mediaKey(prefix, o.file);
      cells[4] = o.timestamp;
      cells[5] = 'animal';
      cells[6] = 'false';
      cells[7] = '';
      cells[8] = o.scientificName;
      cells[9] = String(o.count);
      cells[10] = '0';
      cells[19] = o.comments;
      for (const [i, v] of Object.entries(o.extras ?? {})) cells[Number(i)] = v;
      return row(cells, OBS_WIDTH);
    })
    .join('\n');
}

export function deploymentsCsv(): string {
  const cells: string[] = [];
  cells[0] = DEPLOYMENT;
  cells[1] = 'SAN15';
  cells[2] = LOCATION_NAME;
  cells[3] = '-110.200000';
  cells[4] = '31.500000';
  cells[12] = '1200.000000';
  return row(cells, DEPLOY_WIDTH);
}

export function uploadMetaJson(input: {
  bucket: string;
  prefix: string;
  user: string;
  imageCount: number;
  imagesWithSpecies: number;
  description: string;
}): string {
  return JSON.stringify(
    {
      uploadUser: input.user,
      uploadDate: {
        date: { year: 2024, month: 1, day: 15 },
        time: { hour: 10, minute: 0, second: 0, nano: 0 },
      },
      imagesWithSpecies: input.imagesWithSpecies,
      imageCount: input.imageCount,
      editComments: [`Uploaded by ${input.user} on 2024.01.15.10.00.00`],
      bucket: input.bucket,
      uploadPath: input.prefix.replace(/\/$/, ''),
      description: input.description,
    },
    null,
    2,
  );
}

export const SPECIES_JSON = JSON.stringify(
  [
    {
      name: 'Mule Deer',
      scientificName: 'Odocoileus hemionus',
      speciesIconURL: 'https://example.org/muledeer.png',
      keyBinding: 'D',
    },
    {
      name: 'Coyote',
      scientificName: 'Canis latrans',
      speciesIconURL: 'https://example.org/coyote.png',
      keyBinding: null,
    },
    {
      name: 'Mountain Lion',
      scientificName: 'Puma concolor',
      speciesIconURL: 'https://example.org/puma.png',
      keyBinding: 'P',
    },
    {
      name: 'Javelina',
      scientificName: 'Pecari tajacu',
      speciesIconURL: 'https://example.org/javelina.png',
      keyBinding: null,
    },
    {
      name: 'Ghost',
      scientificName: 'Casper',
      speciesIconURL: '',
      keyBinding: 'G',
    },
    // A deliberately malformed entry — the Browse rail reports skipped rows.
    { name: '', scientificName: '', speciesIconURL: '', keyBinding: null },
  ],
  null,
  2,
);

export const SNAPSHOT_STAMP = '2024-02-01T12-00-00';
export const SNAPSHOT_USER = 'priortagger';
export const SNAPSHOT_PREFIX = `${PREFIX_A}.sparcd-tagger-snapshots/${SNAPSHOT_USER}/${SNAPSHOT_STAMP}/`;
/** A snapshot whose manifest was never written — recovery must ignore it. */
export const PARTIAL_SNAPSHOT_PREFIX = `${PREFIX_A}.sparcd-tagger-snapshots/${SNAPSHOT_USER}/2024-03-01T09-00-00/`;

/** Populate a mock store with the whole fixture world. */
export function seedFixtures(s3: MockS3): void {
  s3.addBucket(BUCKET);
  s3.addBucket(BUCKET_B);
  s3.addBucket(SETTINGS_BUCKET);

  s3.put(
    BUCKET,
    `Collections/${UUID}/collection.json`,
    JSON.stringify({
      nameProperty: COLLECTION_NAME,
      organizationProperty: 'Culver Lab',
      contactInfoProperty: 'lab@example.org',
      descriptionProperty: 'Educational test collection',
    }),
    'application/json',
  );
  s3.put(
    BUCKET_B,
    `Collections/${UUID_B}/collection.json`,
    JSON.stringify({
      nameProperty: COLLECTION_B_NAME,
      organizationProperty: 'Field Office',
      contactInfoProperty: '',
      descriptionProperty: '',
    }),
    'application/json',
  );

  s3.put(SETTINGS_BUCKET, 'Settings/species.json', SPECIES_JSON, 'application/json');

  // --- Upload A: partially tagged, has a deployment file and a snapshot ------
  s3.put(BUCKET, `${PREFIX_A}media.csv`, mediaCsv(PREFIX_A, MEDIA_A), 'text/csv');
  s3.put(BUCKET, `${PREFIX_A}observations.csv`, observationsCsv(PREFIX_A, OBS_A), 'text/csv');
  s3.put(BUCKET, `${PREFIX_A}deployments.csv`, deploymentsCsv(), 'text/csv');
  s3.put(
    BUCKET,
    `${PREFIX_A}UploadMeta.json`,
    uploadMetaJson({
      bucket: BUCKET,
      prefix: PREFIX_A,
      user: 'priortagger',
      imageCount: MEDIA_A.length,
      imagesWithSpecies: 3,
      description: 'Educational Test — burst sample',
    }),
    'application/json',
  );
  MEDIA_A.forEach((m, i) => {
    s3.put(
      BUCKET,
      mediaKey(PREFIX_A, m.file),
      makePng(240, 180, i + 1),
      m.mime === 'video/mp4' ? 'video/mp4' : 'image/png',
    );
  });

  // --- Upload B: fully tagged ("Done"), and no readable deployments.csv ------
  s3.put(BUCKET, `${PREFIX_B}media.csv`, mediaCsv(PREFIX_B, MEDIA_B), 'text/csv');
  s3.put(BUCKET, `${PREFIX_B}observations.csv`, observationsCsv(PREFIX_B, OBS_B), 'text/csv');
  s3.put(
    BUCKET,
    `${PREFIX_B}UploadMeta.json`,
    uploadMetaJson({
      bucket: BUCKET,
      prefix: PREFIX_B,
      user: 'fielduser',
      imageCount: MEDIA_B.length,
      imagesWithSpecies: MEDIA_B.length,
      description: 'Fully identified upload',
    }),
    'application/json',
  );
  MEDIA_B.forEach((m, i) => {
    s3.put(BUCKET, mediaKey(PREFIX_B, m.file), makePng(240, 180, i + 20), 'image/png');
  });

  // --- A complete snapshot of upload A, plus an abandoned partial one --------
  const snapMedia = mediaCsv(PREFIX_A, MEDIA_A);
  const snapObs = observationsCsv(PREFIX_A, [OBS_A[0]]); // an older, thinner state
  const snapMeta = uploadMetaJson({
    bucket: BUCKET,
    prefix: PREFIX_A,
    user: 'priortagger',
    imageCount: MEDIA_A.length,
    imagesWithSpecies: 1,
    description: 'Educational Test — burst sample',
  });
  s3.put(BUCKET, `${SNAPSHOT_PREFIX}media.csv`, snapMedia, 'text/csv');
  s3.put(BUCKET, `${SNAPSHOT_PREFIX}observations.csv`, snapObs, 'text/csv');
  s3.put(BUCKET, `${SNAPSHOT_PREFIX}UploadMeta.json`, snapMeta, 'application/json');
  s3.put(
    BUCKET,
    `${SNAPSHOT_PREFIX}manifest.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        user: SNAPSHOT_USER,
        editStamp: '2024.02.01.12.00.00',
        files: [
          { name: 'media.csv', etag: 'x', sha256: 'x' },
          { name: 'observations.csv', etag: 'x', sha256: 'x' },
          { name: 'UploadMeta.json', etag: 'x', sha256: 'x' },
        ],
      },
      null,
      2,
    ),
    'application/json',
  );
  s3.put(BUCKET, `${PARTIAL_SNAPSHOT_PREFIX}media.csv`, snapMedia, 'text/csv');
}
