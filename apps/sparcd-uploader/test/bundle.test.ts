// The uploader contract: `buildBundle` must emit valid v016 Camtrap data that
// the shared `@sparcd/camtrap` readers parse, and an *empty* canonical
// observations base — the same golden the tagger tests rely on. This test
// reuses the shared fixtures and readers from `packages/camtrap/test`, so the
// uploader and tagger prove the same data contract against the same bytes.

import { describe, it, expect } from 'vitest';
import {
  parseDeployments,
  parseMedia,
  parseObservations,
  parseUploadMeta,
  parseCsvRows,
  serializeCsvRows,
  validateColumnCount,
  DEPLOY_COLUMN_COUNT,
  MEDIA_COLUMN_COUNT,
  OBS_COLUMN_COUNT,
  MEDIA_COL,
} from '@sparcd/camtrap';
import { fixture } from '../../../packages/camtrap/test/fixtures';
import {
  buildBundle,
  resolveBatchNaming,
  namingForUploadPath,
  objectKeyFor,
  buildBundleFromRecords,
  type BuildInput,
  type ResolvedFileRecord,
} from '../src/lib/bundle';
import type { Location } from '../src/lib/locations';
import type { FileEntry } from '../src/store';

const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';

const SAN15: Location = {
  key: `SAN15|31.5,-110.2`,
  id: 'SAN15',
  name: 'San Pedro 15',
  latitude: 31.5,
  longitude: -110.2,
  elevation: 1200,
};

import type { NaiveDateTime } from '../src/lib/exifTime';

// A naive wall-clock with no zone (the camera's local time, as EXIF stores it).
const naive = (over: Partial<NaiveDateTime> = {}): NaiveDateTime => ({
  year: 2024,
  month: 1,
  day: 10,
  hour: 8,
  minute: 0,
  second: 0,
  ...over,
});

// A ready FileEntry backed by a real File so `crypto.subtle` has bytes to hash.
function ready(
  relPath: string,
  opts: {
    exifNaive?: NaiveDateTime;
    manualNaive?: NaiveDateTime;
    mediaKind?: FileEntry['mediaKind'];
  } = {},
): FileEntry {
  const mediaKind = opts.mediaKind ?? 'image';
  const mimeType = mediaKind === 'video' ? 'video/mp4' : 'image/jpeg';
  const bytes = new TextEncoder().encode(`fake:${relPath}`);
  const file = new File([bytes], relPath.split('/').pop()!, { type: mimeType });
  return {
    id: relPath,
    file,
    relPath,
    fileName: file.name,
    size: bytes.length,
    mediaKind,
    mimeType,
    processState: 'ready',
    sha256: `sha-${relPath}`,
    exifNaive: 'exifNaive' in opts ? opts.exifNaive : naive(),
    manualNaive: opts.manualNaive,
  };
}

function build(
  files: FileEntry[],
  timeZone = 'America/Phoenix',
): ReturnType<typeof buildBundle> {
  const input: BuildInput = {
    location: SAN15,
    collectionUuid: UUID,
    bucket: `sparcd-${UUID}`,
    uploaderSlug: 'jdoe',
    description: 'Educational Test — uploader bundle',
    timeZone,
    files,
    now: new Date(2024, 0, 15, 10, 0, 0),
  };
  return buildBundle(input);
}

describe('uploader bundle is valid v016 Camtrap data', () => {
  it('writes an empty observations.csv base — the tagger golden', async () => {
    const b = await build([ready('a/IMG001.JPG', { exifNaive: naive() })]);
    expect(b.observationsCsv).toBe('');
    expect(b.observationsCsv).toBe(fixture('uploader-empty-v016', 'observations.csv'));
    expect(parseObservations(b.observationsCsv)).toEqual([]);
  });

  it('media.csv carries the DST-corrected naive capture time in col 4', async () => {
    // The uploader is the writer-of-record for capture time: the naive EXIF
    // wall-clock 08:00 interpreted in America/Phoenix (UTC-7, no DST) is 15:00Z,
    // written as a naive-UTC string (no `Z`) — the exact byte shape readers want.
    const b = await build([ready('a/IMG001.JPG', { exifNaive: naive({ hour: 8 }) })], 'America/Phoenix');
    const rows = parseMedia(b.mediaCsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].timestamp).toBe('2024-01-10T15:00:00');
  });

  it('capture time is independent of the chosen zone going in (proves tz applied)', async () => {
    // Same naive wall-clock, two different zones → two different UTC instants.
    const phx = await build([ready('a/IMG001.JPG', { exifNaive: naive({ hour: 8 }) })], 'America/Phoenix');
    const utc = await build([ready('a/IMG001.JPG', { exifNaive: naive({ hour: 8 }) })], 'UTC');
    expect(parseMedia(phx.mediaCsv)[0].timestamp).toBe('2024-01-10T15:00:00');
    expect(parseMedia(utc.mediaCsv)[0].timestamp).toBe('2024-01-10T08:00:00');
  });

  it('a video media row carries the video media type', async () => {
    const b = await build([ready('a/CLIP.MP4', { mediaKind: 'video', exifNaive: naive() })]);
    const rows = parseMedia(b.mediaCsv);
    expect(rows[0].mimeType).toBe('video/mp4');
  });

  it('a file with no capture time leaves col 4 empty', async () => {
    const b = await build([ready('a/CLIP.MP4', { mediaKind: 'video', exifNaive: undefined })]);
    expect(parseMedia(b.mediaCsv)[0].timestamp).toBe('');
  });

  it('a manual capture time fills col 4 (DST-corrected) when EXIF is absent', async () => {
    const b = await build(
      [ready('a/IMG001.JPG', { exifNaive: undefined, manualNaive: naive({ hour: 8 }) })],
      'America/Phoenix',
    );
    expect(parseMedia(b.mediaCsv)[0].timestamp).toBe('2024-01-10T15:00:00');
  });

  it('prefers EXIF over a stray manual time so a real camera time is never clobbered', async () => {
    const b = await build(
      [ready('a/IMG001.JPG', { exifNaive: naive({ hour: 8 }), manualNaive: naive({ hour: 20 }) })],
      'America/Phoenix',
    );
    expect(parseMedia(b.mediaCsv)[0].timestamp).toBe('2024-01-10T15:00:00');
  });

  it('media rows carry the full object key as media_id and round-trip', async () => {
    const b = await build([ready('a/IMG001.JPG'), ready('b/IMG002.JPG')]);
    const media = parseMedia(b.mediaCsv);
    expect(media).toHaveLength(2);
    for (const m of media) {
      expect(m.mediaId).toBe(m.mediaPath);
      expect(m.mediaPath.startsWith(`${b.uploadPath}/`)).toBe(true);
      expect(m.mimeType).toBe('image/jpeg');
    }
    expect(serializeCsvRows(parseCsvRows(b.mediaCsv))).toBe(b.mediaCsv);
    expect(validateColumnCount(parseCsvRows(b.mediaCsv), MEDIA_COLUMN_COUNT)).toBeNull();
  });

  it('deployments.csv reads back the chosen location and round-trips', async () => {
    const b = await build([ready('a/IMG001.JPG')]);
    const [d] = parseDeployments(b.deploymentsCsv);
    expect(d.locationId).toBe('SAN15');
    expect(d.locationName).toBe('San Pedro 15');
    expect(d.longitude).toBeCloseTo(-110.2, 5);
    expect(d.latitude).toBeCloseTo(31.5, 5);
    expect(d.elevation).toBeCloseTo(1200, 5);
    expect(d.deploymentId).toBe(`${UUID}:SAN15`);
    expect(serializeCsvRows(parseCsvRows(b.deploymentsCsv))).toBe(b.deploymentsCsv);
    expect(validateColumnCount(parseCsvRows(b.deploymentsCsv), DEPLOY_COLUMN_COUNT)).toBeNull();
  });

  it('UploadMeta.json starts at zero species and no edits', async () => {
    const b = await build([ready('a/IMG001.JPG'), ready('b/IMG002.JPG')]);
    const meta = parseUploadMeta(b.uploadMetaJson);
    expect(meta.imagesWithSpecies).toBe(0);
    expect(meta.imageCount).toBe(2);
    expect(meta.editComments).toEqual([]);
    expect(meta.bucket).toBe(`sparcd-${UUID}`);
  });
});

describe('bundle only includes processed files', () => {
  it('excludes queued/errored files and those without a hash', async () => {
    const files: FileEntry[] = [
      ready('a/IMG001.JPG'),
      { ...ready('b/IMG002.JPG'), processState: 'queued', sha256: undefined },
      { ...ready('c/IMG003.JPG'), processState: 'error', processError: 'boom' },
    ];
    const b = await build(files);
    expect(b.fileCount).toBe(1);
    expect(b.items).toHaveLength(1);
    expect(parseMedia(b.mediaCsv)).toHaveLength(1);
    expect(parseMedia(b.mediaCsv)[0].fileName).toBe('IMG001.JPG');
  });
});

describe('bundle integrity hash', () => {
  it('is a stable 64-hex digest for identical input', async () => {
    const a = await build([ready('a/IMG001.JPG'), ready('b/IMG002.JPG')]);
    const c = await build([ready('a/IMG001.JPG'), ready('b/IMG002.JPG')]);
    expect(a.metadataBundleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.metadataBundleSha256).toBe(c.metadataBundleSha256);
  });

  it('every media row is reachable by its full key (reader listing parity)', async () => {
    const b = await build([ready('nested/deep/IMG009.JPG')]);
    const rows = parseCsvRows(b.mediaCsv);
    const keys = new Set(b.items.map((i) => i.key));
    for (const r of rows) expect(keys.has(r[MEDIA_COL.mediaId])).toBe(true);
  });
});

// Resume-before-bundle (a session interrupted before it ever reached publish)
// reconstructs naming from persisted records instead of live FileEntrys, and
// reuses the already-persisted upload path instead of stamping a fresh one.
// Both properties below are load-bearing: get either wrong and a resumed
// upload's keys diverge from what a from-scratch run of the same batch would
// have produced.
describe('resume: naming reconstructed from persisted records', () => {
  it('produces the same key as the original run, including a name collision', () => {
    const files = [
      { id: 'a/IMG.JPG', relPath: 'a/IMG.JPG', fileName: 'IMG.JPG' },
      { id: 'b/IMG.JPG', relPath: 'b/IMG.JPG', fileName: 'IMG.JPG' }, // same sanitized name — collides
    ];
    const original = resolveBatchNaming({
      collectionUuid: UUID,
      uploaderSlug: 'jdoe',
      now: new Date(2024, 0, 15, 10, 0, 0),
      files,
    });
    // The "resume" side only ever sees the fixed, already-persisted upload
    // path — never a fresh `now`.
    const reconstructed = namingForUploadPath(original.uploadPath, files);

    for (const f of files) {
      const seed = `sha-${f.id}`;
      const originalKey = objectKeyFor(f.id, seed, original);
      const reconstructedKey = objectKeyFor(f.id, seed, reconstructed);
      expect(reconstructedKey).toEqual(originalKey);
    }
  });
});

describe('resume: buildBundleFromRecords', () => {
  const record = (over: Partial<ResolvedFileRecord> = {}): ResolvedFileRecord => ({
    fileName: 'IMG001.JPG',
    size: 12,
    sha256: 'sha-a',
    remoteKey: `${UUID}-key/IMG001.JPG`,
    captureTimestamp: '2024-01-10T08:00:00',
    mimeType: 'image/jpeg',
    ...over,
  });

  it('emits a valid bundle from persisted records alone, one observation row per file', async () => {
    const b = await buildBundleFromRecords({
      location: SAN15,
      collectionUuid: UUID,
      bucket: `sparcd-${UUID}`,
      uploaderSlug: 'jdoe',
      description: 'Educational Test — resumed upload',
      uploadPath: `Collections/${UUID}/Uploads/2024.01.15.10.00.00_jdoe`,
      startedAt: new Date(2024, 0, 15, 10, 0, 0),
      files: [record()],
    });
    const observations = parseObservations(b.observationsCsv);
    expect(observations).toHaveLength(1);
    expect(observations[0].observationId).toBe('IMG001.JPG');
    expect(observations[0].mediaId).toBe(record().remoteKey);
    expect(observations[0].scientificName).toBe('');
    const media = parseMedia(b.mediaCsv);
    expect(media).toHaveLength(1);
    expect(media[0].fileName).toBe('IMG001.JPG');
    expect(media[0].mediaId).toBe(record().remoteKey);
    expect(b.metadataBundleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(validateColumnCount(parseCsvRows(b.deploymentsCsv), DEPLOY_COLUMN_COUNT)).toBeNull();
    expect(validateColumnCount(parseCsvRows(b.mediaCsv), MEDIA_COLUMN_COUNT)).toBeNull();
    expect(validateColumnCount(parseCsvRows(b.observationsCsv), OBS_COLUMN_COUNT)).toBeNull();
  });
});
