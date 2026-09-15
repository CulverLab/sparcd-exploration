// IndexedDB-backed local draft state. Dexie owns the schema. P1 is local-only:
// nothing here ever writes to S3. Drafts persist every tag edit so a closed tab
// recovers exactly where the tagger left off, and P4 sync reads these rows.
//
// Schema versioning rule (shared with the uploader): Dexie's versioning API with
// forward-carrying upgrade callbacks, no ad-hoc store mutations. v1 is the
// initial schema. The `base*ETag` / `base*Hash` / `auditSnapshotKey` fields are
// the P4 grounding/sync surface; P1 leaves them undefined and only writes the
// edit fields. They live in the v1 shape now so P4 adds no schema bump.

import Dexie, { type Table } from 'dexie';
import type { Deployment } from '@sparcd/camtrap';
import type { CanonicalState } from './sync';
import type { SyncJournal } from './syncJournal';

/** One applied species on an image — the unit of the multi-species set. Identity
 *  within an image is `scientificName` (Ghost = `Casper`). The single source of
 *  truth for the shape; `drafts.ts` and `workspace.ts` re-use it. */
export type DraftObservation = {
  scientificName: string; // species or non-animal label; never '' once stored
  commonName: string; // → [COMMONNAME:…] at sync; '' when none / requested-only
  count: number; // ≥1 always
  requestedSpecies: string; // free-text request → [REQUESTED_SPECIES:…]; '' otherwise
  freeTags: string; // extra raw markers, preserved verbatim (per-observation)
};

/** One image's local edit. `id` = `${bucket}::${uploadPrefix}::${mediaPath}`.
 *  `observations` is the ordered set of applied species; `[]` means detagged /
 *  no species. A SPARC'd observation is species + count only — no behaviour field. */
export interface DraftRecord {
  id: string;
  bucket: string;
  uploadPrefix: string;
  mediaPath: string; // full object key = media.csv col 0
  deploymentId: string; // carried from canonical media for the eventual obs row

  // The full intended species set for this image, in apply order.
  observations: DraftObservation[];
  questionable: boolean;
  timeOverride: string | null; // per-image corrected ISO timestamp; null when unset

  lastEdited: string; // ISO
  dirty: boolean; // true once edited locally; cleared on a future successful sync

  // P4 grounding (undefined until sync grounds the draft on canonical files).
  baseMediaETag?: string;
  baseMediaHash?: string;
  baseObservationsETag?: string;
  baseObservationsHash?: string;
  baseUploadMetaETag?: string;
  baseUploadMetaHash?: string;
  auditSnapshotKey?: string;
}

/** One upload's session-level state (time offset + the canonical base it grounds on). */
export interface UploadRecord {
  id: string; // `${bucket}::${uploadPrefix}`
  bucket: string;
  uploadPrefix: string;
  loadedAt: string; // ISO
  timeOffset: TimeOffsetRecord | null; // signed Δ applied to every image; null when unset
  pendingLocation: Deployment | null; // whole-upload location correction; null when unset

  // P4 grounding, undefined until sync.
  mediaETag?: string;
  mediaHash?: string;
  observationsETag?: string;
  observationsHash?: string;
  deploymentsETag?: string;
  deploymentsHash?: string;
  uploadMetaETag?: string;
  uploadMetaHash?: string;
}

/** Signed Δ y/mo/d/h/m/s — mirrors `@sparcd/camtrap` `TimeOffset`. */
export type TimeOffsetRecord = {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export interface SessionRecord {
  sessionId: string;
  userId: string;
  startedAt: string;
  finishedAt?: string;
  syncedAt?: string;
  syncedKey?: string;
  syncedCsvHash?: string;
}

class TaggerDb extends Dexie {
  drafts!: Table<DraftRecord, string>;
  uploads!: Table<UploadRecord, string>;
  sessions!: Table<SessionRecord, string>;
  syncJournals!: Table<SyncJournal, string>;

  constructor() {
    super('sparcd-tagger');
    this.version(1).stores({
      // Index by upload so loading a workspace is cheap. `dirty` is a boolean —
      // not a valid IndexedDB key — so the recovery scan filters in JS instead.
      drafts: 'id, [bucket+uploadPrefix]',
      uploads: 'id',
      sessions: 'sessionId, syncedAt',
    });
    // v2 adds the P4 per-object sync journal (resume-after-partial-write). A
    // purely additive store needs no upgrade callback; v1 drafts carry forward
    // untouched. Keyed `${bucket}::${uploadPrefix}` (= the journal's own `id`).
    this.version(2).stores({ syncJournals: 'id' });
    // v3 collapses the single-label tag fields into an `observations` array
    // (multi-species). Same indexes, restated so the upgrade callback attaches.
    // A non-empty `label` becomes exactly one observation (count floored to 1);
    // an empty label becomes `[]`. Ghost (`Casper`) is just one observation.
    this.version(3)
      .stores({ drafts: 'id, [bucket+uploadPrefix]' })
      .upgrade(async (tx) => {
        await tx
          .table('drafts')
          .toCollection()
          .modify((d: Record<string, unknown>) => {
            const label = (d.label as string) ?? '';
            d.observations = label
              ? [
                  {
                    scientificName: label,
                    commonName: (d.commonName as string) ?? '',
                    count: Math.max(1, (d.count as number) ?? 1),
                    requestedSpecies: (d.requestedSpecies as string) ?? '',
                    freeTags: (d.freeTags as string) ?? '',
                  },
                ]
              : [];
            delete d.label;
            delete d.commonName;
            delete d.count;
            delete d.requestedSpecies;
            delete d.freeTags;
          });
      });
  }
}

export const db = new TaggerDb();

export const draftId = (bucket: string, uploadPrefix: string, mediaPath: string): string =>
  `${bucket}::${uploadPrefix}::${mediaPath}`;

export const uploadId = (bucket: string, uploadPrefix: string): string =>
  `${bucket}::${uploadPrefix}`;

/** All drafts for one upload, by media path. Drives workspace hydration. */
export async function loadDraftsForUpload(
  bucket: string,
  uploadPrefix: string,
): Promise<DraftRecord[]> {
  return db.drafts.where('[bucket+uploadPrefix]').equals([bucket, uploadPrefix]).toArray();
}

/** Drafts still flagged `dirty` — surfaced on next open as unsaved recovery. */
export async function listDirtyDrafts(): Promise<DraftRecord[]> {
  return db.drafts.filter((d) => d.dirty).toArray();
}

/** Whether one upload has any unsaved (dirty) drafts — gates re-grounding so an
 *  in-progress edit's conflict base isn't advanced by a background refetch. */
export async function hasDirtyDraftsForUpload(
  bucket: string,
  uploadPrefix: string,
): Promise<boolean> {
  const n = await db.drafts
    .where('[bucket+uploadPrefix]')
    .equals([bucket, uploadPrefix])
    .filter((d) => d.dirty)
    .count();
  return n > 0;
}

export async function putDraft(record: DraftRecord): Promise<void> {
  await db.drafts.put(record);
}

/** Local-only edit state for an upload, used as the Browse list's Sync column. */
export type UploadDraftState = 'unsynced' | 'synced';

/**
 * One pass over a bucket's drafts → which uploads have local work, and whether
 * it is still `unsynced` (any dirty draft) or `synced` (drafts exist, all pushed).
 * Uploads with no local drafts are absent from the map; the caller treats those
 * as `local-only` — mirroring the design, where an untouched upload is local-only.
 * A full scan (no `bucket` index), but drafts are bounded by local tagging work.
 */
export async function uploadDraftStates(bucket: string): Promise<Map<string, UploadDraftState>> {
  const out = new Map<string, UploadDraftState>();
  await db.drafts
    .filter((d) => d.bucket === bucket)
    .each((d) => {
      if (out.get(d.uploadPrefix) === 'unsynced') return; // dirty wins, stays unsynced
      out.set(d.uploadPrefix, d.dirty ? 'unsynced' : 'synced');
    });
  return out;
}

/** Drop every local draft for one upload (the per-upload "Discard local changes"). */
export async function discardUploadDrafts(bucket: string, uploadPrefix: string): Promise<void> {
  await db.drafts.where('[bucket+uploadPrefix]').equals([bucket, uploadPrefix]).delete();
}

// --- P4 grounding + sync journal -------------------------------------------

/**
 * Record the canonical ETags/hashes the workspace just loaded as this upload's
 * sync ground. Called from the Tag workspace query so the base and the on-screen
 * data stay in lockstep: a remote change that triggers a refetch re-grounds at
 * the same time, and any existing `timeOffset` is preserved.
 */
export async function groundUpload(
  bucket: string,
  uploadPrefix: string,
  base: CanonicalState,
): Promise<void> {
  const id = uploadId(bucket, uploadPrefix);
  const existing = await db.uploads.get(id);
  await db.uploads.put({
    id,
    bucket,
    uploadPrefix,
    loadedAt: new Date().toISOString(),
    timeOffset: existing?.timeOffset ?? null,
    pendingLocation: existing?.pendingLocation ?? null,
    mediaETag: base.media.etag,
    mediaHash: base.media.hash,
    observationsETag: base.observations.etag,
    observationsHash: base.observations.hash,
    deploymentsETag: base.deployments.etag,
    deploymentsHash: base.deployments.hash,
    uploadMetaETag: base.uploadMeta.etag,
    uploadMetaHash: base.uploadMeta.hash,
  });
}

export function getUpload(bucket: string, uploadPrefix: string): Promise<UploadRecord | undefined> {
  return db.uploads.get(uploadId(bucket, uploadPrefix));
}

/**
 * Set (or clear) the upload-level time offset, upserting the `uploads` record so
 * an offset can be set before the workspace has grounded. Only `timeOffset` is
 * touched — the grounding ETags/hashes are preserved — mirroring how
 * `groundUpload` preserves an existing `timeOffset`. The sync path reads this
 * value back via `getUpload`, so persisting it here is what makes an upload-level
 * correction show up in the next sync's `media.csv` col-4 writes.
 */
export async function setUploadTimeOffset(
  bucket: string,
  uploadPrefix: string,
  offset: TimeOffsetRecord | null,
): Promise<void> {
  const id = uploadId(bucket, uploadPrefix);
  const existing = await db.uploads.get(id);
  await db.uploads.put({
    ...(existing ?? { id, bucket, uploadPrefix, loadedAt: new Date().toISOString(), pendingLocation: null }),
    timeOffset: offset,
  });
}

/** Set (or clear) the upload-level pending location correction — mirrors
 *  `setUploadTimeOffset` exactly; see its doc comment. */
export async function setUploadPendingLocation(
  bucket: string,
  uploadPrefix: string,
  location: Deployment | null,
): Promise<void> {
  const id = uploadId(bucket, uploadPrefix);
  const existing = await db.uploads.get(id);
  await db.uploads.put({
    ...(existing ?? { id, bucket, uploadPrefix, loadedAt: new Date().toISOString(), timeOffset: null }),
    pendingLocation: location,
  });
}

export function loadSyncJournal(
  bucket: string,
  uploadPrefix: string,
): Promise<SyncJournal | undefined> {
  return db.syncJournals.get(uploadId(bucket, uploadPrefix));
}

export async function saveSyncJournal(journal: SyncJournal): Promise<void> {
  await db.syncJournals.put(journal);
}

export async function clearSyncJournal(bucket: string, uploadPrefix: string): Promise<void> {
  await db.syncJournals.delete(uploadId(bucket, uploadPrefix));
}
