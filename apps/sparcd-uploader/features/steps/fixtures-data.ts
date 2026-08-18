// Fixture payloads: the location registry, collection markers, published
// uploads, and synthetic media bytes. Everything is self-contained — no file on
// disk, no network — so a scenario can state exactly what storage holds.

import type { S3Mock } from './s3mock';

export const SETTINGS_BUCKET = 'sparcd-settings-test';
export const LOCATIONS_KEY = 'Settings/locations.json';

export const UUID_A = '11111111-1111-1111-1111-111111111111';
export const UUID_B = '22222222-2222-2222-2222-222222222222';
export const BUCKET_A = `sparcd-${UUID_A}`;
export const BUCKET_B = `sparcd-${UUID_B}`;

export const COLLECTION_A_NAME = 'Alpha Collection';
export const COLLECTION_B_NAME = 'Beta Collection';

/** The location the seeded prior upload of collection A already deployed. */
export const USED_LOCATION_ID = 'DEER3';
export const USED_LOCATION_NAME = 'Deer Springs';

export const PRIOR_UPLOAD_STAMP = '2026.01.02.09.00.00_priorperson';
export const PRIOR_UPLOAD_PREFIX = `Collections/${UUID_A}/Uploads/${PRIOR_UPLOAD_STAMP}/`;

type RawLocation = {
  nameProperty: string;
  idProperty: string;
  latProperty: number;
  lngProperty: number;
  elevationProperty: number;
};

const loc = (
  nameProperty: string,
  idProperty: string,
  latProperty: number,
  lngProperty: number,
  elevationProperty: number,
): RawLocation => ({ nameProperty, idProperty, latProperty, lngProperty, elevationProperty });

/**
 * Five valid locations plus the awkward cases the registry really contains: a
 * repeated id with different coordinates (two distinct locations), an exact
 * repeat (collapsed), and three entries that fail Location.java's rules.
 */
export const RAW_LOCATIONS: RawLocation[] = [
  loc('Bear Canyon', 'BEAR1', 32.4, -110.7, 1200),
  loc('Coyote Wash', 'COY2', 32.1, -110.9, 900),
  loc(USED_LOCATION_NAME, USED_LOCATION_ID, 31.9, -111.2, 1500),
  loc('Elk Meadow', 'DUP9', 33.0, -110.0, 2000),
  loc('Elk Meadow (retired)', 'DUP9', 33.5, -110.5, 2100),
  // Mid-Atlantic: its coordinates resolve (via tz-lookup) to "Etc/GMT+2", a
  // zone Intl does not list — the case where the chosen zone has to be added to
  // the picker.
  loc('Offshore Buoy', 'OFFSHORE1', 0, -30, 0),
  loc('Bear Canyon', 'BEAR1', 32.4, -110.7, 1200), // exact repeat — collapsed
  loc('', 'NONAME', 32.0, -110.0, 800), // skipped: empty name
  loc('Impossible Latitude', 'BADLAT', 99, -110.0, 800), // skipped: lat out of range
  loc('Unset Elevation', 'BADELEV', 32.0, -110.0, -20000), // skipped: elevation sentinel
];

export const VALID_LOCATION_NAMES = [
  'Bear Canyon',
  'Coyote Wash',
  'Deer Springs',
  'Elk Meadow',
  'Elk Meadow (retired)',
  'Offshore Buoy',
];

/** The zone tz-lookup returns for "Offshore Buoy" — absent from Intl's list. */
export const LEGACY_ZONE = 'Etc/GMT+2';

export const SKIPPED_LOCATION_NAMES = ['Impossible Latitude', 'Unset Elevation'];

export const locationsJson = (entries: RawLocation[] = RAW_LOCATIONS): string =>
  JSON.stringify(entries, null, 2);

const collectionJson = (name: string, org: string, contact: string, description: string) =>
  JSON.stringify(
    {
      nameProperty: name,
      organizationProperty: org,
      contactInfoProperty: contact,
      descriptionProperty: description,
    },
    null,
    2,
  );

const csvRow = (fields: string[]): string =>
  fields.map((f) => `"${f.replace(/"/g, '""')}"`).join(',') + '\n';

/** A `deployments.csv` in the writer's 23-column shape. */
export const deploymentsCsv = (uuid: string, locationId: string, name: string, lat = 31.9, lng = -111.2, elev = 1500): string =>
  csvRow([
    `${uuid}:${locationId}`,
    locationId,
    name,
    lng.toFixed(6),
    lat.toFixed(6),
    '0',
    '',
    '',
    '',
    '',
    '',
    '0',
    elev.toFixed(6),
    '0.000000',
    '0',
    'false',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);

export const mediaCsv = (uuid: string, locationId: string, prefix: string, names: string[]): string =>
  names
    .map((n) =>
      csvRow([
        `${prefix}${n}`,
        `${uuid}:${locationId}`,
        `${prefix}${n}`,
        '',
        '2026-01-02T09:00:00',
        `${prefix}${n}`,
        n,
        'image/jpeg',
        '',
        'false',
        '',
      ]),
    )
    .join('');

export const uploadMetaJson = (opts: {
  user: string;
  description: string;
  imageCount: number;
  imagesWithSpecies: number;
  bucket: string;
  uploadPath: string;
  editComments?: string[];
}): string =>
  JSON.stringify(
    {
      uploadUser: opts.user,
      uploadDate: {
        date: { year: 2026, month: 1, day: 2 },
        time: { hour: 9, minute: 0, second: 0, nano: 0 },
      },
      imagesWithSpecies: opts.imagesWithSpecies,
      imageCount: opts.imageCount,
      editComments: opts.editComments ?? [],
      bucket: opts.bucket,
      uploadPath: opts.uploadPath,
      description: opts.description,
    },
    null,
    2,
  );

/** The default world: a settings bucket, two collections, one prior upload. */
export function seedDefaultStorage(s3: S3Mock): void {
  s3.buckets = [SETTINGS_BUCKET, BUCKET_A, BUCKET_B, 'unrelated-bucket'];
  s3.put(SETTINGS_BUCKET, LOCATIONS_KEY, locationsJson(), { contentType: 'application/json' });
  s3.put(BUCKET_A, `Collections/${UUID_A}/collection.json`, collectionJson(COLLECTION_A_NAME, 'Alpha Org', 'alpha@example.org', 'The alpha test collection'), { contentType: 'application/json' });
  s3.put(BUCKET_B, `Collections/${UUID_B}/collection.json`, collectionJson(COLLECTION_B_NAME, 'Beta Org', 'beta@example.org', 'The beta test collection'), { contentType: 'application/json' });
  seedPriorUpload(s3);
}

/** One published upload in collection A, deployed at DEER3. */
export function seedPriorUpload(s3: S3Mock): void {
  s3.put(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}deployments.csv`, deploymentsCsv(UUID_A, USED_LOCATION_ID, USED_LOCATION_NAME), { contentType: 'text/csv' });
  s3.put(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}media.csv`, mediaCsv(UUID_A, USED_LOCATION_ID, PRIOR_UPLOAD_PREFIX, ['IMG_0001.JPG', 'IMG_0002.JPG']), { contentType: 'text/csv' });
  s3.put(BUCKET_A, `${PRIOR_UPLOAD_PREFIX}observations.csv`, '', { contentType: 'text/csv' });
  s3.put(
    BUCKET_A,
    `${PRIOR_UPLOAD_PREFIX}UploadMeta.json`,
    uploadMetaJson({
      user: 'priorperson',
      description: 'Original description',
      imageCount: 2,
      imagesWithSpecies: 0,
      bucket: BUCKET_A,
      uploadPath: PRIOR_UPLOAD_PREFIX.replace(/\/$/, ''),
    }),
    { contentType: 'application/json' },
  );
}

// --- synthetic media -------------------------------------------------------

/**
 * A real 64×48 baseline JPEG carrying an EXIF APP1 with a single
 * DateTimeOriginal (`2026:07:01 12:00:00`). Small enough to inline, real enough
 * that `exifr` reads it and `createImageBitmap` decodes it.
 */
export const BASE_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QBERXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAZADAAIAAAAUAAAAKDIwMjY6MDc6MDEgMTI6MDA6MDAA/9sAQwAGBAQFBAQGBQUFBgYGBwkOCQkICAkSDQ0KDhUSFhYVEhQUFxohHBcYHxkUFB0nHR8iIyUlJRYcKSwoJCshJCUk/9sAQwEGBgYJCAkRCQkRJBgUGCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk/8AAEQgAMABAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8Ar0UUV7h4wUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/9kAAAAA';

export const BASE_JPEG_EXIF_DATE = '2026:07:01 12:00:00';

const baseJpeg = (): Buffer => Buffer.from(BASE_JPEG_B64, 'base64');

/** The same JPEG with its EXIF DateTimeOriginal rewritten (`YYYY:MM:DD HH:mm:ss`). */
export function jpegWithExifDate(date: string, salt = ''): Buffer {
  const buf = baseJpeg();
  const at = buf.indexOf(BASE_JPEG_EXIF_DATE, 0, 'latin1');
  if (at < 0) throw new Error('EXIF date not found in base JPEG');
  buf.write(date.padEnd(BASE_JPEG_EXIF_DATE.length, ' ').slice(0, BASE_JPEG_EXIF_DATE.length), at, 'latin1');
  return salt ? Buffer.concat([buf, Buffer.from(salt, 'utf8')]) : buf;
}

/** The same JPEG with its whole APP1 EXIF segment removed — no capture time. */
export function jpegWithoutExif(salt = ''): Buffer {
  const buf = baseJpeg();
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1) {
      const stripped = Buffer.concat([buf.subarray(0, i), buf.subarray(i + 2 + len)]);
      return salt ? Buffer.concat([stripped, Buffer.from(salt, 'utf8')]) : stripped;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  throw new Error('no APP1 segment to strip');
}

const MP4_EPOCH_OFFSET_S = 2_082_844_800;

/** A minimal fast-start MP4: `ftyp` + `moov`/`mvhd` with a creation time. */
export function mp4WithCreationTime(utc: Date | null, salt = ''): Buffer {
  const ftyp = Buffer.alloc(20);
  ftyp.writeUInt32BE(20, 0);
  ftyp.write('ftypisom', 4, 'latin1');
  ftyp.writeUInt32BE(512, 12);
  ftyp.write('isom', 16, 'latin1');

  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0);
  mvhd.write('mvhd', 4, 'latin1');
  mvhd.writeUInt32BE(0, 8); // version 0, flags 0
  const secs = utc ? Math.floor(utc.getTime() / 1000) + MP4_EPOCH_OFFSET_S : 0;
  mvhd.writeUInt32BE(secs, 12); // creation_time
  mvhd.writeUInt32BE(secs, 16); // modification_time
  mvhd.writeUInt32BE(1000, 20); // timescale
  mvhd.writeUInt32BE(1000, 24); // duration

  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0);
  moov.write('moov', 4, 'latin1');

  const parts = [ftyp, moov, mvhd];
  if (salt) parts.push(Buffer.from(salt, 'utf8'));
  return Buffer.concat(parts);
}

export const textFile = (content: string): Buffer => Buffer.from(content, 'utf8');
