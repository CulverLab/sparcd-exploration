// Glue between the React layer and the pure `runSync` orchestrator: it pulls the
// grounded base + time offset + any resume journal out of Dexie, builds the
// injected S3 IO, runs the sync, and re-grounds on the freshly written canonical
// state so the next sync starts clean. The UI keeps the result and drives the
// store/query side-effects (it owns those React handles).

import type { S3Config } from '@sparcd/types';
import { buildSyncPlan, runSync, runRestore, type SyncResult } from './sync';
import { makeSyncIO, loadCanonicalState, loadSnapshotBodies } from './s3';
import {
  getUpload,
  groundUpload,
  setUploadTimeOffset,
  setUploadPendingLocation,
  loadSyncJournal,
  saveSyncJournal,
  clearSyncJournal,
  type DraftRecord,
} from './db';
import type { TagImage } from './workspace';

export type SyncArgs = {
  cfg: S3Config;
  bucket: string;
  uploadPrefix: string;
  user: string;
  images: TagImage[];
  drafts: Record<string, DraftRecord>;
  dryRun: boolean;
};

/**
 * Run one sync (dry-run or live). Resumes a prior partial sync if a journal
 * exists for this upload; otherwise diffs drafts against the grounded base and
 * writes. On a successful live write it re-grounds on the new canonical state.
 */
export async function performSync(args: SyncArgs): Promise<SyncResult> {
  const { cfg, bucket, uploadPrefix, user, images, drafts, dryRun } = args;

  // The workspace grounds on load; ground here too as a fallback so a sync is
  // never run against a missing base. `deploymentsETag === undefined` (as
  // opposed to '', which means "grounded, no deployments.csv exists") catches
  // a record grounded before this role existed — without this, its base would
  // default to '' and mismatch a real remote deployments.csv, reporting a
  // false conflict on a sync that touches nothing location-related.
  let base = await getUpload(bucket, uploadPrefix);
  if (!base?.mediaETag || base.deploymentsETag === undefined) {
    const state = await loadCanonicalState(cfg, bucket, uploadPrefix);
    await groundUpload(bucket, uploadPrefix, state);
    base = await getUpload(bucket, uploadPrefix);
  }

  const plan = buildSyncPlan(images, drafts, base?.timeOffset ?? null, base?.pendingLocation ?? null);
  const resumeJournal = await loadSyncJournal(bucket, uploadPrefix);

  const io = makeSyncIO(cfg, bucket, uploadPrefix, {
    save: saveSyncJournal,
    clear: () => clearSyncJournal(bucket, uploadPrefix),
  });

  const result = await runSync(
    {
      bucket,
      uploadPrefix,
      user,
      base: {
        media: { etag: base?.mediaETag ?? '', hash: base?.mediaHash ?? '' },
        observations: { etag: base?.observationsETag ?? '', hash: base?.observationsHash ?? '' },
        deployments: { etag: base?.deploymentsETag ?? '', hash: base?.deploymentsHash ?? '' },
        uploadMeta: { etag: base?.uploadMetaETag ?? '', hash: base?.uploadMetaHash ?? '' },
      },
      plan,
      dryRun,
      resumeJournal,
    },
    io,
  );

  if (result.status === 'synced' && !dryRun) {
    const fresh = await loadCanonicalState(cfg, bucket, uploadPrefix);
    await groundUpload(bucket, uploadPrefix, fresh);
    // A successful live sync bakes the upload offset into canonical `media.csv`
    // (every shifted image's col 4 was rewritten). The new base IS the corrected
    // time, so the standing offset must be cleared — leaving it would re-apply it
    // on top of already-corrected timestamps at the next sync (double shift). The
    // offset is relative; per-image overrides are absolute, so they need no reset.
    await setUploadTimeOffset(bucket, uploadPrefix, null);
    // Same reasoning as the offset clear above: a location correction is baked
    // into the new canonical `deployments.csv` / media+observation rows, so the
    // pending correction must not be re-applied on top of the next sync.
    if (plan.locationEdit) await setUploadPendingLocation(bucket, uploadPrefix, null);
  }
  return result;
}

export type RestoreArgs = {
  cfg: S3Config;
  bucket: string;
  uploadPrefix: string;
  user: string;
  /** Full snapshot prefix `<uploadPrefix>.sparcd-tagger-snapshots/<user>/<stamp>/`. */
  snapshotPrefix: string;
  dryRun: boolean;
};

/**
 * Restore a chosen snapshot (dry-run or live). Loads the snapshot bodies, runs
 * them back through the conditional-replacement flow, and — on a successful live
 * write — re-grounds on the now-restored canonical state. Resumes a prior
 * partial sync/restore journal if one exists for this upload (the journal must
 * be finished before a new write begins).
 */
export async function performRestore(args: RestoreArgs): Promise<SyncResult> {
  const { cfg, bucket, uploadPrefix, user, snapshotPrefix, dryRun } = args;

  const bodies = await loadSnapshotBodies(cfg, bucket, snapshotPrefix);
  const resumeJournal = await loadSyncJournal(bucket, uploadPrefix);

  const io = makeSyncIO(cfg, bucket, uploadPrefix, {
    save: saveSyncJournal,
    clear: () => clearSyncJournal(bucket, uploadPrefix),
  });

  const result = await runRestore({ bucket, uploadPrefix, user, bodies, dryRun, resumeJournal }, io);

  if (result.status === 'synced' && !dryRun) {
    const fresh = await loadCanonicalState(cfg, bucket, uploadPrefix);
    await groundUpload(bucket, uploadPrefix, fresh);
  }
  return result;
}
