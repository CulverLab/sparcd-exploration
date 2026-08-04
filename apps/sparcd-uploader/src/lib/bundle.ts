// In-memory Camtrap-DP bundle generation for the Assign-step preview. Pure
// (apart from Web Crypto for the integrity hash) and S3-free — it produces the
// exact byte payloads P4 will upload, so the preview is truthful.
//
// Layout decision (P3, verified): image blobs live UNDER the upload prefix,
// because the existing SPARC'd reader lists objects under that prefix and
// ignores `media.csv`'s media_path. So `media_path` is
// `Collections/<uuid>/Uploads/<stamp>_<slug>/<relpath>` — not a separate
// UploadBlobs key. See plan "Persistence — S3 sync".

import type { Media, Observation } from '@sparcd/camtrap';
import {
  serializeDeployments,
  serializeMedia,
  serializeObservations,
  buildUploadMeta,
  serializeUploadMeta,
  serializeUploadComplete,
  uploadStamp,
  type UploadCompleteJson,
} from '@sparcd/camtrap';
import { locationToDeployment, type Location } from './locations';
import { sanitizeRelPath, nameCounts, resolveOneName } from './normalize';
import { naiveInZoneToUtcNaive } from './exifTime';
import type { MediaKind } from './scanFiles';
import type { FileEntry } from '../store';

/** One blob to stream: the full object key (= media_path) plus its source. */
export type UploadItem = {
  id: string; // FileEntry id (= relPath within the chosen folder)
  localPath: string; // source path within the chosen folder; resume reconciles on it
  fileName: string;
  objectName: string; // resolved bundle-relative object name (the key's tail)
  key: string; // full S3 object key, identical to media_path
  file: File;
  size: number;
  sha256: string;
  captureTimestamp?: string; // resolved ISO 8601 UTC capture time (post-tz), media.csv col 4
  mediaKind: MediaKind;
  mimeType: string;
};

export type BundlePreview = {
  uploadPath: string;
  bucket: string;
  deploymentId: string;
  fileCount: number;
  totalBytes: number;
  metadataBundleSha256: string;
  deploymentsCsv: string;
  mediaCsv: string;
  observationsCsv: string;
  uploadMetaJson: string;
  uploadCompleteJson: string;
  /** Per-file upload plan; the orchestrator (P4) streams these to `key`. */
  items: UploadItem[];
};

const enc = new TextEncoder();

async function sha256Hex(parts: Uint8Array[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Frozen naming decisions for a batch: the deployment stamp/upload path, and
 * every scanned file's pre-suffix sanitized name plus collision counts. Names
 * depend only on relPath/fileName (known at Drop), never on file content, so
 * this can — and for a streamed run, must — be computed once, before any file
 * has finished processing, and reused verbatim thereafter: no file's key ever
 * has to change once it's been decided. */
export type BatchNaming = {
  uploadPath: string;
  nameFor: Map<string, string>; // FileEntry.id -> sanitized (pre-suffix) name
  counts: Map<string, number>; // sanitized-name occurrence counts, whole batch
};

export function resolveBatchNaming(input: {
  collectionUuid: string;
  uploaderSlug: string;
  now: Date;
  files: { id: string; relPath: string; fileName: string }[];
}): BatchNaming {
  const stamp = uploadStamp(input.now);
  const uploadPath = `Collections/${input.collectionUuid}/Uploads/${stamp}_${input.uploaderSlug}`;
  const nameFor = new Map<string, string>();
  for (const f of input.files) {
    const safe = sanitizeRelPath(f.relPath);
    nameFor.set(f.id, safe.ok ? safe.name : f.fileName);
  }
  const counts = nameCounts([...nameFor.values()].map((name) => ({ name })));
  return { uploadPath, nameFor, counts };
}

/** Resolve one file's final object name/key once it has a hash, against a
 * frozen `BatchNaming`. Stable from the moment it's returned — safe to upload
 * a blob under this key immediately, it will never need to change. */
export function objectKeyFor(
  id: string,
  sha256: string,
  naming: BatchNaming,
): { objectName: string; key: string } {
  const name = naming.nameFor.get(id)!;
  const objectName = resolveOneName(name, sha256, naming.counts);
  return { objectName, key: `${naming.uploadPath}/${objectName}` };
}

const mimeFor = (f: FileEntry): string =>
  f.mimeType ?? (f.mediaKind === 'video' ? 'video/mp4' : 'image/jpeg');

// Resolve a naive capture time to the DST-correct UTC naive wall-clock, the
// exact media.csv col-4 byte shape. EXIF (or video container) metadata wins;
// a manual Assign entry fills the gap for a file that has none.
const captureFor = (f: FileEntry, timeZone: string): string => {
  const src = f.exifNaive ?? f.manualNaive;
  return src ? naiveInZoneToUtcNaive(src, timeZone) : '';
};

/**
 * Resolve one ready file's full upload item — key, capture time, mime type —
 * against a frozen `BatchNaming`. Used both by `buildBundle`'s final pass
 * (over the complete ready set) and by a streamed run enqueueing one file the
 * moment it individually finishes Inspect.
 */
export function planItemFor(f: FileEntry, naming: BatchNaming, timeZone: string): UploadItem {
  const { objectName, key } = objectKeyFor(f.id, f.sha256!, naming);
  return {
    id: f.id,
    localPath: f.relPath,
    fileName: f.fileName,
    objectName,
    key,
    file: f.file,
    size: f.size,
    sha256: f.sha256!,
    captureTimestamp: captureFor(f, timeZone) || undefined,
    mediaKind: f.mediaKind,
    mimeType: mimeFor(f),
  };
}

export type BuildInput = {
  location: Location;
  collectionUuid: string;
  bucket: string;
  uploaderSlug: string;
  description: string;
  timeZone: string; // IANA zone the EXIF naive wall-clock is interpreted in
  files: FileEntry[];
  now: Date;
  /** Reuse an already-frozen naming resolution (a streamed run) instead of
   * resolving fresh from the currently-ready subset (the Assign preview). */
  naming?: BatchNaming;
};

/**
 * Build the five bundle payloads from the chosen deployment, identity, and the
 * processed files. Only files that finished processing with a hash are
 * included; collisions in the bundle-relative name get a deterministic suffix.
 */
export async function buildBundle(input: BuildInput): Promise<BundlePreview> {
  const { location, collectionUuid, bucket, uploaderSlug, description, timeZone, files, now } = input;

  const ready = files.filter((f) => f.processState === 'ready' && f.sha256);

  const naming =
    input.naming ??
    resolveBatchNaming({
      collectionUuid,
      uploaderSlug,
      now,
      files: ready,
    });
  const uploadPath = naming.uploadPath;

  const deployment = locationToDeployment(location, collectionUuid);

  // Resolve each file's capture time in the chosen zone: naive components →
  // DST-correct full ISO 8601 UTC timestamp, the media.csv col-4 shape. EXIF
  // (or video container) metadata wins; a manual Assign entry fills the gap for a
  // file that has none, so a real camera time is never clobbered. Publish is
  // gated on every file having one, so col 4 is never empty for a published batch.
  const mimeFor = (f: FileEntry): string =>
    f.mimeType ?? (f.mediaKind === 'video' ? 'video/mp4' : 'image/jpeg');
  const captureFor = (f: FileEntry): string => {
    const src = f.exifNaive ?? f.manualNaive;
    return src ? naiveInZoneToUtcIso(src, timeZone) : '';
  };

  const media: Media[] = uploadItems.map((it) => ({
    mediaId: it.key,
    deploymentId: deployment.deploymentId,
    mediaPath: r.mediaPath,
    fileName: r.f.fileName,
    timestamp: r.capture,
    mimeType: r.mimeType,
  }));

  // One placeholder observation row per file, so every uploaded image is
  // present in observations.csv from the start. Species-related columns
  // (scientific_name, count) are left blank — nothing has been identified yet;
  // the tagger fills them in later via `mergeObservations`.
  const observations: Observation[] = resolved.map((r) => ({
    observationId: r.f.fileName,
    mediaId: r.mediaPath,
    deploymentId: deployment.deploymentId,
    timestamp: r.capture,
    scientificName: '',
    tags: '',
  }));

  const uploadItems: UploadItem[] = resolved.map((r) => ({
    id: r.f.id,
    localPath: r.f.relPath,
    fileName: r.f.fileName,
    objectName: r.objectName,
    key: r.mediaPath,
    file: r.f.file,
    size: r.f.size,
    sha256: r.f.sha256!,
    captureTimestamp: r.capture || undefined,
    mediaKind: r.f.mediaKind,
    mimeType: r.mimeType,
  }));

  const deploymentsCsv = serializeDeployments([deployment]);
  const mediaCsv = serializeMedia(media);
  const observationsCsv = serializeObservations(observations);

  const uploadMetaJson = serializeUploadMeta(
    buildUploadMeta({
      uploadUser: uploaderSlug,
      date: now,
      imageCount: ready.length,
      imagesWithSpecies: 0,
      bucket,
      uploadPath,
      description,
    }),
  );

  // metadataBundleSha256 commits the bundle's index: the exact bytes of
  // UploadMeta.json followed by the three CSVs, in that order.
  const metadataBundleSha256 = await sha256Hex([
    enc.encode(uploadMetaJson),
    enc.encode(deploymentsCsv),
    enc.encode(mediaCsv),
    enc.encode(observationsCsv),
  ]);

  const complete: UploadCompleteJson = {
    schemaVersion: 1,
    uploadPath,
    fileCount: ready.length,
    metadataBundleSha256,
    files: media.map((m, i) => ({
      media_path: m.mediaPath,
      size: ready[i].size,
      sha256: ready[i].sha256!,
    })),
    completedAt: now.toISOString(),
  };

  return {
    uploadPath,
    bucket,
    deploymentId: deployment.deploymentId,
    fileCount: ready.length,
    totalBytes: ready.reduce((n, f) => n + f.size, 0),
    metadataBundleSha256,
    deploymentsCsv,
    mediaCsv,
    observationsCsv,
    uploadMetaJson,
    uploadCompleteJson: serializeUploadComplete(complete),
    items: uploadItems,
  };
}
