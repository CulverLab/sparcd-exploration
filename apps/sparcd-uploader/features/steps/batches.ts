// Ready-made batches the steps drop onto the page. Each file carries real JPEG
// (or MP4) bytes so the Inspect worker does real EXIF/hash/decode work.

import type { FileSpec } from './app';
import { jpegWithExifDate, jpegWithoutExif, mp4WithCreationTime, textFile } from './fixtures-data';

export const FOLDER = 'SDCARD';

export const jpegAt = (name: string, exifDate: string, salt = name): FileSpec => ({
  path: `${FOLDER}/${name}`,
  mime: 'image/jpeg',
  bytes: jpegWithExifDate(exifDate, salt),
});

export const jpegNoTime = (name: string, salt = name): FileSpec => ({
  path: `${FOLDER}/${name}`,
  mime: 'image/jpeg',
  bytes: jpegWithoutExif(salt),
});

export const mp4At = (name: string, when: Date | null, salt = name): FileSpec => ({
  path: `${FOLDER}/${name}`,
  mime: 'video/mp4',
  bytes: mp4WithCreationTime(when, salt),
});

export const other = (name: string, content = 'not media'): FileSpec => ({
  path: `${FOLDER}/${name}`,
  mime: '',
  bytes: textFile(content),
});

/** Three timestamped JPEGs — the default "a folder of media" batch. */
export const standardBatch = (): FileSpec[] => [
  jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
  jpegAt('IMG_0002.JPG', '2026:07:01 12:05:00'),
  jpegAt('IMG_0003.JPG', '2026:07:01 12:10:00'),
];

export const batchWithMissingTimes = (): FileSpec[] => [
  jpegAt('IMG_0001.JPG', '2026:07:01 12:00:00'),
  jpegNoTime('IMG_0002.JPG'),
  jpegNoTime('IMG_0003.JPG'),
];

/** A small MP4 fixture for normal four-object publish flows. */
export const clipVideo = (name = 'BIG_CLIP.MP4'): FileSpec => ({
  path: `${FOLDER}/${name}`,
  mime: 'video/mp4',
  bytes: mp4WithCreationTime(new Date(Date.UTC(2026, 6, 1, 12, 30, 0)), name),
});

/**
 * A file big enough that its Inspect pass is still running by the time the
 * wizard reaches the Upload step. Use only for scenarios whose behavior is
 * specifically about background examination continuing during upload.
 */
export const SLOW_PAD_BYTES = 160 * 1024 * 1024;

export const slowVideo = (name = 'BIG_CLIP.MP4'): FileSpec => ({
  path: `${FOLDER}/${name}`,
  mime: 'video/mp4',
  bytes: mp4WithCreationTime(new Date(Date.UTC(2026, 6, 1, 12, 30, 0)), name),
  padBytes: SLOW_PAD_BYTES,
});

/** The default batch plus one video, for normal publish flows. */
export const publishableBatch = (): FileSpec[] => [...standardBatch(), clipVideo()];

/** A four-object batch whose final video keeps Inspect busy. */
export const slowPublishableBatch = (): FileSpec[] => [...standardBatch(), slowVideo()];

export const manyJpegs = (count: number, prefix = 'IMG'): FileSpec[] =>
  Array.from({ length: count }, (_, i) =>
    jpegAt(`${prefix}_${String(i).padStart(4, '0')}.JPG`, '2026:07:01 12:00:00', `${prefix}-${i}`),
  );
