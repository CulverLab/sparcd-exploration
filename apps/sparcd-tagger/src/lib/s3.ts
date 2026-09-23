// The tagger's single point of contact with `@sparcd/s3-safe`. Static BYO-S3:
// bucket access is discovered at runtime from the connected credentials, never
// baked into the bundle. IAM/CORS + the wrapper's reviewed methods are the real
// safety boundary. Collection discovery and read-error translation come from
// `@sparcd/s3-safe` so the tagger and uploader cannot diverge on what a
// collection is or how a failed read is reported.

import {
  SafeS3Client,
  listCollections as listCollectionsWith,
  parseCollectionKey,
  translateReadError,
  type CollectionRef,
} from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import { parseUploadMeta, parseDeployments, type Deployment } from '@sparcd/camtrap';
import { sha256Hex } from './hash';
import type { CanonicalState, SyncIO, SnapshotManifest } from './sync';
import type { SyncJournal, CanonicalRole } from './syncJournal';

// Not a security boundary in a static app — the wrapper just requires an
// explicit scope. The connected key's IAM policy and bucket CORS gate access.
const RUNTIME_BUCKET_SCOPE = ['*'];

let cached: { config: S3Config; client: SafeS3Client } | null = null;
let writeCached: { config: S3Config; client: SafeS3Client } | null = null;

export function clearClientCache(): void {
  cached = null;
  writeCached = null;
}

export function getClient(cfg: S3Config): SafeS3Client {
  if (cached?.config === cfg) return cached.client;
  // Read scope only: every read path goes through this client, which has no
  // write grant, so it physically cannot write to S3.
  const client = new SafeS3Client(cfg, RUNTIME_BUCKET_SCOPE);
  cached = { config: cfg, client };
  return client;
}

/**
 * A separate, write-capable client used *only* by the live (non-dry-run) sync
 * path. Kept distinct from the read client so the entire browse/tag read surface
 * runs on a client with no write grant — the only code that can construct a
 * write client is the sync IO below, behind the dry-run gate.
 */
export function getWriteClient(cfg: S3Config): SafeS3Client {
  if (writeCached?.config === cfg) return writeCached.client;
  const client = new SafeS3Client(cfg, RUNTIME_BUCKET_SCOPE, RUNTIME_BUCKET_SCOPE);
  writeCached = { config: cfg, client };
  return client;
}

// --- Collections -----------------------------------------------------------
// Discovery, keying, and the `CollectionRef` shape live in `@sparcd/s3-safe` so
// the tagger and uploader never diverge on what a collection is. We re-export
// them through this facade (the app's single S3 contact point) and keep the
// `cfg`-based entry so callers stay on the local, read-only client cache.

export { parseCollectionKey, type CollectionRef };

export function listCollections(cfg: S3Config): Promise<CollectionRef[]> {
  return listCollectionsWith(getClient(cfg));
}

// --- Uploads + images within a collection ----------------------------------

export type UploadRef = {
  prefix: string; // full `Collections/<uuid>/Uploads/<stamp>/`
  stamp: string; // the `<stamp>` folder name
};

/** Upload folders for a collection, enumerated with a delimiter (no image walk). */
export async function listUploads(cfg: S3Config, bucket: string, uuid: string): Promise<UploadRef[]> {
  const client = getClient(cfg);
  const dirs = await client.listCommonPrefixes(bucket, `Collections/${uuid}/Uploads/`);
  return dirs
    .map((prefix) => ({ prefix, stamp: prefix.replace(/\/$/, '').split('/').pop() ?? prefix }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp)); // newest stamp first
}

// A cheap per-upload summary for the Browse list: the canonical tally from
// `UploadMeta.json` (image count + how many already carry a species) plus the
// deployment location label(s) from `deployments.csv`. Two small GETs — no image
// walk — so the list can render Date / Deployment / Images / Tagged per row.
export type UploadSummary = {
  imageCount: number;
  imagesWithSpecies: number;
  uploadUser: string;
  description: string;
  deployments: string[]; // location names, deduped; usually one
};

export async function loadUploadSummary(
  cfg: S3Config,
  bucket: string,
  uploadPrefix: string,
): Promise<UploadSummary> {
  const client = getClient(cfg);
  const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

  let meta;
  try {
    meta = parseUploadMeta(decode(await client.getObject(bucket, `${uploadPrefix}${CANONICAL_FILE.uploadMeta}`)));
  } catch (err) {
    throw translateReadError(err, 'UploadMeta.json');
  }

  // The location label is secondary — a missing or unreadable `deployments.csv`
  // must not blank an otherwise-good row, so it degrades to no label.
  let deployments: string[] = [];
  try {
    const rows = parseDeployments(decode(await client.getObject(bucket, `${uploadPrefix}deployments.csv`)));
    deployments = [...new Set(rows.map((d) => d.locationName.trim()).filter(Boolean))];
  } catch {
    // No deployment label for this row.
  }

  return {
    imageCount: meta.imageCount,
    imagesWithSpecies: meta.imagesWithSpecies,
    uploadUser: meta.uploadUser,
    description: meta.description,
    deployments,
  };
}

/** The upload's current recorded location, straight from `deployments.csv`
 *  (row 0 — an upload has exactly one location by convention). `null` when the
 *  file is missing/unreadable or empty, so a display caller can degrade to "no
 *  location on file" instead of throwing. Distinct from `loadCanonicalState`,
 *  which grounds the sync base — this is read-only, UI-display plumbing. */
export async function loadCurrentDeployment(
  cfg: S3Config,
  bucket: string,
  uploadPrefix: string,
): Promise<Deployment | null> {
  const client = getClient(cfg);
  try {
    const rows = parseDeployments(
      new TextDecoder().decode(await client.getObject(bucket, `${uploadPrefix}${CANONICAL_FILE.deployments}`)),
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export type UploadImage = {
  key: string; // full object key
  fileName: string;
  size: number;
};

// What the sparcd-web reader treats as an "image" under an upload prefix: it
// recurses subfolders but returns only these extensions. Matching it here means
// snapshot/CSV/JSON objects never show up as taggable images.
const IMAGE_EXT = /\.(jpe?g|mp4)$/i;

/** List the taggable images under an upload prefix (sparcd-web `get_s3_images` parity). */
export async function listUploadImages(
  cfg: S3Config,
  bucket: string,
  uploadPrefix: string,
): Promise<UploadImage[]> {
  const client = getClient(cfg);
  const images: UploadImage[] = [];
  for await (const obj of client.listObjects(bucket, uploadPrefix)) {
    if (!IMAGE_EXT.test(obj.key)) continue;
    images.push({ key: obj.key, fileName: obj.key.split('/').pop() ?? obj.key, size: obj.size });
  }
  return images.sort((a, b) => a.key.localeCompare(b.key));
}

const THUMB_TTL_SEC = 60 * 60; // 1h presigned GET, plenty for a tagging session

/** A presigned GET URL an `<img>` can render directly (no canvas/CORS needs). */
export function presignImage(cfg: S3Config, bucket: string, key: string): Promise<string> {
  return getClient(cfg).presignedGet(bucket, key, THUMB_TTL_SEC);
}

// --- Canonical Camtrap state (the Tag workspace base + sync ground) ----------

// The Tag workspace grounds on the same upload-level files the Java app and
// sparcd-web read. `media.csv` is the authoritative image list (col 0 = full
// object key, col 4 = capture time, col 1 = deployment); `observations.csv`
// carries existing species rows; `UploadMeta.json` holds the tally + comments.
// Each file is loaded with its current ETag (the `IfMatch` ground for sync) and
// a SHA-256 of its bytes (the journal's integrity check).

const CANONICAL_FILE = {
  media: 'media.csv',
  observations: 'observations.csv',
  deployments: 'deployments.csv',
  uploadMeta: 'UploadMeta.json',
} as const;

/** Load one canonical object with its ETag + content hash, preserving raw S3
 * errors for callers that need to distinguish a missing optional object. */
async function loadObjectRaw(
  cfg: S3Config,
  bucket: string,
  key: string,
): Promise<{ text: string; etag: string; hash: string }> {
  // HEAD first for the ETag, then GET the bytes. The ETag is the IfMatch
  // ground; a concurrent change between the two only risks a spurious sync
  // conflict (safe-fail), never a bad write — the write re-checks IfMatch.
  const client = getClient(cfg);
  const stat = await client.statObject(bucket, key);
  const bytes = await client.getObject(bucket, key);
  return { text: new TextDecoder().decode(bytes), etag: stat.etag ?? '', hash: await sha256Hex(bytes) };
}

/** Load one required canonical object, translating any S3 read failure. */
async function loadObject(cfg: S3Config, bucket: string, key: string, what: string) {
  try { return await loadObjectRaw(cfg, bucket, key); }
  catch (err) { throw translateReadError(err, what); }
}

/** Load the four canonical files an upload grounds on, with ETags + hashes.
 *  `deployments.csv` is the one optional file — some uploads have none (see
 *  `loadUploadSummary`'s same tolerance) — so a missing/unreadable one grounds
 *  as an empty file rather than failing the whole workspace load. A location
 *  correction on such an upload writes a brand-new `deployments.csv`. */
export async function loadCanonicalState(
  cfg: S3Config,
  bucket: string,
  uploadPrefix: string,
): Promise<CanonicalState> {
  const [media, observations, deployments, uploadMeta] = await Promise.all([
    loadObject(cfg, bucket, `${uploadPrefix}${CANONICAL_FILE.media}`, 'media.csv'),
    loadObject(cfg, bucket, `${uploadPrefix}${CANONICAL_FILE.observations}`, 'observations.csv'),
    loadObjectRaw(cfg, bucket, `${uploadPrefix}${CANONICAL_FILE.deployments}`).catch(
      async (err) => {
        if (!isNotFound(err)) throw translateReadError(err, 'deployments.csv');
        return { text: '', etag: '', hash: await sha256Hex('') };
      },
    ),
    loadObject(cfg, bucket, `${uploadPrefix}${CANONICAL_FILE.uploadMeta}`, 'UploadMeta.json'),
  ]);
  return { media, observations, deployments, uploadMeta };
}

// --- Snapshots (P5 recovery source) ----------------------------------------

// Every sync/restore writes an immutable pre-change snapshot under this prefix,
// with `manifest.json` last. A prefix without a complete manifest is an
// abandoned partial snapshot and is ignored on recovery.
const SNAPSHOTS_DIR = '.sparcd-tagger-snapshots/';

// The `<user>/` path segment is percent-encoded on write (see `snapshotPrefixOf`);
// decode it back, tolerating a malformed value rather than throwing and hiding
// the whole listing.
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** One recoverable snapshot: where it lives + who/when, plus its manifest. */
export type SnapshotRef = {
  prefix: string; // full `<uploadPrefix>.sparcd-tagger-snapshots/<user>/<stamp>/`
  user: string;
  stamp: string;
  manifest: SnapshotManifest;
};

/**
 * List the recoverable snapshots under an upload prefix, newest first. Walks the
 * two snapshot levels (`<user>/<stamp>/`) with a delimiter and reads each
 * `manifest.json`; a stamp prefix whose manifest is absent or unparseable is an
 * incomplete snapshot and is skipped (the manifest is written last, so a partial
 * write leaves none).
 */
export async function listSnapshots(
  cfg: S3Config,
  bucket: string,
  uploadPrefix: string,
): Promise<SnapshotRef[]> {
  const client = getClient(cfg);
  const root = `${uploadPrefix}${SNAPSHOTS_DIR}`;
  let userDirs: string[];
  try {
    userDirs = await client.listCommonPrefixes(bucket, root);
  } catch (err) {
    throw translateReadError(err, 'snapshots');
  }
  const refs: SnapshotRef[] = [];
  await Promise.all(
    userDirs.map(async (userDir) => {
      const user = safeDecode(userDir.slice(root.length).replace(/\/$/, ''));
      const stampDirs = await client.listCommonPrefixes(bucket, userDir);
      await Promise.all(
        stampDirs.map(async (stampDir) => {
          try {
            const bytes = await client.getObject(bucket, `${stampDir}manifest.json`);
            const manifest = JSON.parse(new TextDecoder().decode(bytes)) as SnapshotManifest;
            if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) return;
            const stamp = stampDir.replace(/\/$/, '').split('/').pop() ?? '';
            refs.push({ prefix: stampDir, user, stamp, manifest });
          } catch {
            // No manifest (incomplete) or unreadable — not a recoverable snapshot.
          }
        }),
      );
    }),
  );
  // Stamp is `uuuu-MM-ddTHH-mm-ss`, lexically sortable; newest first.
  return refs.sort((a, b) => b.stamp.localeCompare(a.stamp) || a.user.localeCompare(b.user));
}

export type UploadSnapshots = {
  uploadPrefix: string;
  uploadStamp: string;
  snapshots: SnapshotRef[];
};

/**
 * List recoverable snapshots across every upload in a collection — the History
 * section's cross-upload browser. Reads only; the actual restore still happens
 * per-upload in the Tag workspace's Snapshots dialog. Uploads with no complete
 * snapshot are omitted. A per-upload listing failure (e.g. a CORS-blocked
 * prefix) is swallowed so one bad upload doesn't hide the rest.
 */
export async function listCollectionSnapshots(
  cfg: S3Config,
  bucket: string,
  uuid: string,
): Promise<UploadSnapshots[]> {
  const uploads = await listUploads(cfg, bucket, uuid);
  const out = await Promise.all(
    uploads.map(async (u) => {
      let snapshots: SnapshotRef[] = [];
      try {
        snapshots = await listSnapshots(cfg, bucket, u.prefix);
      } catch {
        // Keep aggregating; an unreadable upload contributes no snapshots.
      }
      return { uploadPrefix: u.prefix, uploadStamp: u.stamp, snapshots };
    }),
  );
  return out.filter((u) => u.snapshots.length > 0);
}

export function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** Load the canonical bodies of one snapshot, to restore them in place. A
 *  snapshot written before location-change support has no `deployments.csv`
 *  — that role comes back absent rather than erroring, so the caller can
 *  treat it as "leave the current location alone" instead of a read failure. */
export async function loadSnapshotBodies(
  cfg: S3Config,
  bucket: string,
  snapshotPrefix: string,
): Promise<Partial<Record<CanonicalRole, string>>> {
  const client = getClient(cfg);
  const read = async (name: string, what: string): Promise<string> => {
    try {
      return new TextDecoder().decode(await client.getObject(bucket, `${snapshotPrefix}${name}`));
    } catch (err) {
      throw translateReadError(err, what);
    }
  };
  const [media, observations, uploadMeta] = await Promise.all([
    read(CANONICAL_FILE.media, 'snapshot media.csv'),
    read(CANONICAL_FILE.observations, 'snapshot observations.csv'),
    read(CANONICAL_FILE.uploadMeta, 'snapshot UploadMeta.json'),
  ]);
  let deployments: string | undefined;
  try {
    deployments = new TextDecoder().decode(
      await client.getObject(bucket, `${snapshotPrefix}${CANONICAL_FILE.deployments}`),
    );
  } catch (err) {
    if (!isNotFound(err)) throw translateReadError(err, 'snapshot deployments.csv');
  }
  return { media, observations, deployments, uploadMeta };
}

/**
 * Assemble the injected `SyncIO` for one upload. The write client is built
 * lazily *inside* the write closures, so a dry-run (which calls neither
 * `writeSnapshot` nor `replace`) never even constructs a write-capable client.
 */
export function makeSyncIO(
  cfg: S3Config,
  bucket: string,
  uploadPrefix: string,
  journal: { save: (j: SyncJournal) => Promise<void>; clear: () => Promise<void> },
): SyncIO {
  return {
    loadCanonical: () => loadCanonicalState(cfg, bucket, uploadPrefix),
    writeSnapshot: async (key, body, contentType) => {
      await getWriteClient(cfg).writeImmutable(bucket, key, body, { contentType });
    },
    replace: (key, body, etag, contentType) =>
      getWriteClient(cfg).replaceIfUnchanged(bucket, key, body, { etag, contentType }),
    saveJournal: journal.save,
    clearJournal: journal.clear,
    now: () => new Date(),
  };
}

// --- Error translation -----------------------------------------------------
// The read-error → message mapping (including the static-app CORS case) lives
// in `@sparcd/s3-safe`; re-export it so other tagger modules reach it through
// this facade.

export { translateReadError };
