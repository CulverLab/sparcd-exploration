// Off-main-thread per-file processing: EXIF/container parse, streamed SHA-256,
// and (for images) a downscaled thumbnail. One file per message. The hash
// streams the file chunk-by-chunk so memory stays flat regardless of batch
// size; the digest must be known before any future PUT, which is why hashing
// happens here, up front.
//
// Capture time is returned as NAIVE wall-clock components, never an instant:
// EXIF datetimes have no zone, so reinterpreting them with `new Date(localStr)`
// would silently bind them to the uploader browser's zone. The chosen IANA zone
// is applied later (main thread) to derive the true UTC timestamp.

import exifr from 'exifr';
import { createSHA256 } from 'hash-wasm';

export type NaiveExif = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type MediaKind = 'image' | 'video';

export type ProcessRequest = { id: string; file: File; fileKind: MediaKind };

export type ProcessResponse = {
  id: string;
  sha256?: string;
  exifNaive?: NaiveExif; // naive wall-clock components, no zone
  /** ModifyDate is metadata-edit time, not a camera capture-time assertion. */
  exifTimestampSource?: 'exif-modify';
  exifCamera?: string;
  gps?: { lat: number; lon: number };
  width?: number;
  height?: number;
  thumbnail?: Blob; // images only; video poster is generated main-thread
  mediaKind?: MediaKind;
  mimeType?: string; // worker-authoritative media type for media.csv
  error?: string;
};

const THUMB_MAX = 64; // longest edge, CSS px doubled for crisp 32px rows

// Window-typed `self` in this lib config; cast to the dedicated-worker shape we
// actually use for posting structured-clone messages.
const post = (msg: ProcessResponse) => (self as unknown as Worker).postMessage(msg);

async function streamSha256(file: File): Promise<string> {
  const hasher = await createSHA256();
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest('hex');
}

const EXIF_FIELDS = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'Make', 'Model'] as const;

// EXIF datetimes are `YYYY:MM:DD HH:MM:SS`. Parse the raw string into naive
// components directly so the browser zone never enters (reviveValues:false
// keeps exifr from handing back a zone-bound Date).
const EXIF_DT_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

function parseNaive(value: unknown): NaiveExif | undefined {
  if (typeof value !== 'string') return undefined;
  const m = EXIF_DT_RE.exec(value);
  if (!m) return undefined;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6]),
  };
}

async function readExif(file: File): Promise<Partial<ProcessResponse>> {
  try {
    // reviveValues:false keeps date tags as their raw EXIF strings (no Date,
    // no browser-zone reinterpretation). GPS is a separate call: exifr only
    // computes decimal lat/lon via .gps().
    const [tags, gps] = await Promise.all([
      exifr.parse(file, { pick: EXIF_FIELDS as unknown as string[], reviveValues: false }),
      exifr.gps(file).catch(() => undefined),
    ]);
    if (!tags) return gpsToResult(gps);
    const primary = parseNaive(tags.DateTimeOriginal) ?? parseNaive(tags.CreateDate);
    const modified = primary ? undefined : parseNaive(tags.ModifyDate);
    const exifNaive = primary ?? modified;
    const exifCamera = [tags.Make, tags.Model].filter(Boolean).join(' ').trim() || undefined;
    return { exifNaive, exifTimestampSource: modified ? 'exif-modify' : undefined, exifCamera, ...gpsToResult(gps) };
  } catch {
    return {}; // missing/corrupt EXIF is a validation concern, not a hard failure
  }
}

function gpsToResult(
  gps: { latitude: number; longitude: number } | undefined,
): Partial<ProcessResponse> {
  if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
    return { gps: { lat: gps.latitude, lon: gps.longitude } };
  }
  return {};
}

async function makeThumbnail(file: File): Promise<Partial<ProcessResponse>> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return { width, height };
    }
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();
    const thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return { width, height, thumbnail };
  } catch {
    return {}; // undecodable preview is non-fatal; the file still uploads
  }
}

// MP4 `moov/mvhd` creation time, best-effort. Times are seconds since 1904-01-01
// UTC (the QuickTime epoch). Returns naive components in UTC; a missing/zero time
// or any read failure → undefined (routes to manual entry, like a timestamp-absent
// image). We do not validate malformed atoms beyond "no usable time".
const MP4_EPOCH_OFFSET_S = 2_082_844_800; // seconds between 1904-01-01 and 1970-01-01

// Only the leading slice is read: a fast-start MP4 keeps `moov` (and `mvhd`) at the
// front, so this avoids allocating a multi-GB clip on the worker heap. A
// non-fast-start (moov-at-end) file won't be found here and falls through to manual
// entry — the same path as a timestamp-absent file.
const MP4_META_SCAN_BYTES = 4 * 1024 * 1024;

async function readMp4Meta(file: File): Promise<Partial<ProcessResponse>> {
  try {
    const buf = await file.slice(0, MP4_META_SCAN_BYTES).arrayBuffer();
    const view = new DataView(buf);
    const len = view.byteLength;

    // Find the top-level moov box, then mvhd inside it.
    const findBox = (start: number, end: number, type: string): { start: number; end: number } | null => {
      let off = start;
      while (off + 8 <= end) {
        let size = view.getUint32(off);
        const boxType = String.fromCharCode(
          view.getUint8(off + 4),
          view.getUint8(off + 5),
          view.getUint8(off + 6),
          view.getUint8(off + 7),
        );
        let headerSize = 8;
        if (size === 1) {
          // 64-bit largesize
          size = Number(view.getBigUint64(off + 8));
          headerSize = 16;
        } else if (size === 0) {
          size = end - off; // extends to end
        }
        if (size < headerSize || off + size > end) break;
        if (boxType === type) return { start: off + headerSize, end: off + size };
        off += size;
      }
      return null;
    };

    const moov = findBox(0, len, 'moov');
    if (!moov) return {};
    const mvhd = findBox(moov.start, moov.end, 'mvhd');
    if (!mvhd) return {};

    const version = view.getUint8(mvhd.start);
    let creationSecs: number;
    if (version === 1) {
      creationSecs = Number(view.getBigUint64(mvhd.start + 4));
    } else {
      creationSecs = view.getUint32(mvhd.start + 4);
    }
    if (!creationSecs) return {};

    const unixMs = (creationSecs - MP4_EPOCH_OFFSET_S) * 1000;
    if (!Number.isFinite(unixMs)) return {};
    const d = new Date(unixMs);
    if (Number.isNaN(d.getTime())) return {};
    return {
      exifNaive: {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
      },
    };
  } catch {
    return {}; // no container time → manual entry
  }
}

self.onmessage = async (e: MessageEvent<ProcessRequest>) => {
  const { id, file, fileKind } = e.data;
  try {
    if (fileKind === 'video') {
      // Hash is mandatory; container metadata is best-effort. No frame decode in
      // a worker — the poster (if any) is captured main-thread.
      const [sha256, meta] = await Promise.all([streamSha256(file), readMp4Meta(file)]);
      post({ id, sha256, mediaKind: 'video', mimeType: 'video/mp4', ...meta });
      return;
    }
    // Image: hash mandatory; EXIF and thumbnail best-effort.
    const [sha256, exif, thumb] = await Promise.all([
      streamSha256(file),
      readExif(file),
      makeThumbnail(file),
    ]);
    post({ id, sha256, mediaKind: 'image', mimeType: 'image/jpeg', ...exif, ...thumb });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : 'Processing failed' });
  }
};
