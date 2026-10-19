// Synthetic collections for the feature suite. Every name, ID and coordinate
// is made up; the positions sit in open ocean. Files follow the fixed-column
// Camtrap-DP-flavoured layout `@sparcd/camtrap` reads (no header rows).

import { readFileSync } from 'node:fs';
import { cameraJpeg, thumbColor } from './images';
import { MockS3 } from './s3mock';

// Two seconds of a synthetic test pattern, 96×64 VP8 (which every Chromium
// build plays, unlike H.264), made with
// `ffmpeg -f lavfi -i testsrc=size=96x64:rate=10 -t 2 -c:v libvpx -b:v 60k -an clip.webm`.
const CLIP = readFileSync(new URL('./clip.webm', import.meta.url));

export const ALPHA = { name: 'Alpha Basin', uuid: 'aaaaaaaa-0000-4000-8000-000000000001' };
export const BRAVO = { name: 'Bravo Flats', uuid: 'bbbbbbbb-0000-4000-8000-000000000002' };
export const CHARLIE = { name: 'Charlie Pond', uuid: 'cccccccc-0000-4000-8000-000000000003' };
export const bucketOf = (c: { uuid: string }) => `sparcd-${c.uuid}`;
export const uploadPrefix = (c: { uuid: string }, stamp: string) => `Collections/${c.uuid}/Uploads/${stamp}/`;

type Deployment = { id: string; name: string; lat: number | null; lon: number | null; elevation: number | null };
type Photo = {
  file: string;
  time: string;
  species?: { sci: string; common: string; count?: number }[];
  /** `image/jpeg` unless given. */
  mime?: string;
  /** Whether the JPEG embeds an EXIF thumbnail; it does unless false. */
  thumbnail?: boolean;
};
export type Upload = { stamp: string; deployment: Deployment; photos: Photo[]; complete?: boolean };

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const row = (cells: Record<number, string>, width: number) => Array.from({ length: width }, (_, i) => q(cells[i] ?? '')).join(',');

function putUpload(s3: MockS3, c: { uuid: string }, u: Upload): void {
  const bucket = bucketOf(c);
  const prefix = uploadPrefix(c, u.stamp);
  const dep = `${c.uuid}:${u.deployment.id || 'none'}:${u.stamp}`;
  const { lat, lon, elevation } = u.deployment;
  if (u.complete !== false) s3.put(bucket, `${prefix}UploadMeta.json`, JSON.stringify({ uploadUser: 'fielduser', imageCount: u.photos.length }), 'application/json');
  s3.put(
    bucket,
    `${prefix}deployments.csv`,
    row(
      {
        0: dep,
        1: u.deployment.id,
        2: u.deployment.name,
        3: lon === null ? '' : lon.toFixed(6),
        4: lat === null ? '' : lat.toFixed(6),
        12: elevation === null ? '' : elevation.toFixed(6),
      },
      23,
    ),
  );
  s3.put(
    bucket,
    `${prefix}media.csv`,
    u.photos
      .map((p) => {
        const key = `${prefix}${p.file}`;
        return row({ 0: key, 1: dep, 2: key, 4: p.time, 5: key, 6: p.file, 7: p.mime ?? 'image/jpeg', 9: 'false' }, 11);
      })
      .join('\n'),
  );
  s3.put(
    bucket,
    `${prefix}observations.csv`,
    u.photos
      .flatMap((p) =>
        (p.species ?? []).map((s, i) =>
          row(
            { 0: `${p.file}-${i}`, 1: dep, 3: `${prefix}${p.file}`, 4: p.time, 5: 'animal', 8: s.sci, 9: String(s.count ?? 1), 19: `[COMMONNAME:${s.common}]` },
            20,
          ),
        ),
      )
      .join('\n'),
  );
  putMediaFiles(s3, c, u);
}

const seedOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** The photo and video files themselves. */
function putMediaFiles(s3: MockS3, c: { uuid: string }, u: Upload): void {
  for (const p of u.photos) {
    const key = `${uploadPrefix(c, u.stamp)}${p.file}`;
    if (p.mime?.startsWith('video/')) {
      s3.put(bucketOf(c), key, CLIP, p.mime);
      continue;
    }
    const hour = Number(p.time.slice(11, 13));
    const night = hour >= 19 || hour < 6;
    let thumbnail: ReturnType<typeof thumbColor> | false = false;
    if (p.thumbnail !== false) {
      thumbnail = thumbColor(s3.thumbColors.size);
      s3.thumbColors.set(p.time.replace('T', ' '), thumbnail);
    }
    s3.put(bucketOf(c), key, cameraJpeg(seedOf(p.file), { animal: Boolean(p.species?.length), night, thumbnail }), 'image/jpeg');
  }
}

export function putCollection(s3: MockS3, c: { name: string; uuid: string }, uploads: Upload[]): void {
  s3.put(bucketOf(c), `Collections/${c.uuid}/collection.json`, JSON.stringify({ nameProperty: c.name }), 'application/json');
  for (const u of uploads) putUpload(s3, c, u);
}

const BOBCAT = { sci: 'Lynx rufus', common: 'Bobcat' };
const DEER = { sci: 'Odocoileus hemionus', common: 'Mule Deer' };
const COYOTE = { sci: 'Canis latrans', common: 'Coyote' };
const FOX = { sci: 'Urocyon cinereoargenteus', common: 'Gray Fox' };

const WILLOW = { id: 'AB01', name: 'Willow Seep', lat: 0.51234, lon: -150.12345, elevation: 1200 };

export const ALPHA_UPLOADS: Upload[] = [
  {
    stamp: '2023.05.01.10.00.00_fielduser',
    deployment: WILLOW,
    photos: [
      { file: 'IMG0001.JPG', time: '2023-04-02T06:10:00', species: [BOBCAT] },
      { file: 'IMG0002.JPG', time: '2023-04-02T22:40:00', species: [BOBCAT, { ...DEER, count: 2 }] },
      { file: 'IMG0003.JPG', time: '2023-04-03T12:00:00' },
    ],
  },
  {
    stamp: '2024.02.01.09.00.00_fielduser',
    deployment: { id: 'AB02', name: 'Cedar Draw', lat: 0.53, lon: -150.15, elevation: 1500 },
    photos: [
      { file: 'IMG0101.JPG', time: '2024-01-10T05:00:00', species: [COYOTE] },
      { file: 'IMG0102.JPG', time: '2024-01-11T05:30:00', species: [BOBCAT] },
      { file: 'IMG0103.JPG', time: '2024-01-12T14:00:00' },
    ],
  },
  {
    stamp: '2024.06.01.08.00.00_fielduser',
    deployment: { id: 'AB03', name: 'Juniper Flat', lat: 0.55, lon: -150.18, elevation: 1350 },
    photos: [{ file: 'IMG0201.JPG', time: '2024-05-20T07:00:00', species: [DEER] }],
  },
  {
    stamp: '2024.07.01.08.00.00_fielduser',
    deployment: { id: 'AB-03', name: 'Juniper Flat', lat: 0.55, lon: -150.18, elevation: 1350 },
    photos: [{ file: 'IMG0301.JPG', time: '2024-06-20T07:00:00' }],
  },
  {
    stamp: '2025.01.15.08.00.00_fielduser',
    deployment: { id: '0000', name: '', lat: null, lon: null, elevation: null },
    photos: [
      { file: 'IMG0401.JPG', time: '2025-01-05T19:00:00', species: [FOX] },
      { file: 'IMG0402.JPG', time: '2025-01-06T03:00:00' },
    ],
  },
  {
    // The Willow Seep camera, moved a little.
    stamp: '2025.04.01.08.00.00_fielduser',
    deployment: { ...WILLOW, lat: 0.52, lon: -150.13 },
    photos: [{ file: 'IMG0501.JPG', time: '2025-03-15T21:00:00', species: [BOBCAT] }],
  },
  {
    stamp: '2025.05.01.08.00.00_interrupted',
    deployment: WILLOW,
    photos: [{ file: 'IMG0601.JPG', time: '2025-04-20T10:00:00' }],
    complete: false,
  },
];

export const BRAVO_UPLOADS: Upload[] = [
  {
    stamp: '2025.03.01.10.00.00_otheruser',
    deployment: WILLOW,
    photos: [
      { file: 'IMG1001.JPG', time: '2025-02-10T08:00:00', species: [DEER] },
      { file: 'IMG1002.JPG', time: '2025-02-11T09:00:00' },
    ],
  },
  {
    stamp: '2025.06.01.10.00.00_otheruser',
    deployment: { id: 'BF01', name: 'Sandy Wash', lat: 0.6, lon: -150.3, elevation: 900 },
    photos: [{ file: 'IMG1101.JPG', time: '2025-05-02T23:15:00', species: [COYOTE] }],
  },
];

/** A later upload for the refresh scenario. */
export const NEW_UPLOAD: Upload = {
  stamp: '2025.08.01.10.00.00_fielduser',
  deployment: { id: 'AB09', name: 'Quail Spring', lat: 0.57, lon: -150.21, elevation: 1100 },
  photos: [{ file: 'IMG0901.JPG', time: '2025-07-30T06:00:00', species: [COYOTE] }],
};

/** A pond camera with a video and a photo whose JPEG has no thumbnail. */
export const CHARLIE_UPLOADS: Upload[] = [
  {
    stamp: '2025.02.01.10.00.00_fielduser',
    deployment: { id: 'CP01', name: 'Reed Bank', lat: 0.7, lon: -150.4, elevation: 800 },
    photos: [
      { file: 'IMG2001.JPG', time: '2025-01-20T09:00:00', species: [COYOTE] },
      { file: 'IMG2002.JPG', time: '2025-01-21T10:00:00', species: [DEER], thumbnail: false },
      { file: 'CLIP2003.WEBM', time: '2025-01-22T11:00:00', species: [FOX], mime: 'video/webm' },
    ],
  },
];

export function seedFixtures(s3: MockS3): void {
  putCollection(s3, ALPHA, ALPHA_UPLOADS);
  putCollection(s3, BRAVO, BRAVO_UPLOADS);
  putCollection(s3, CHARLIE, CHARLIE_UPLOADS);
}

export function addUpload(s3: MockS3, c: { uuid: string }, u: Upload): void {
  putUpload(s3, c, u);
}

/** Alpha's photos in view with nothing filtered: every complete upload. */
export const ALPHA_PHOTOS = ALPHA_UPLOADS.filter((u) => u.complete !== false).reduce((n, u) => n + u.photos.length, 0);
