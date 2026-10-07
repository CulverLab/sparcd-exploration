// The compatibility sync — the tagger's only S3 write path (P4). It turns local
// drafts into the canonical Camtrap output the Java app, sparcd-web, and the
// marimo explorer already read: it replaces upload-level `media.csv`,
// `observations.csv`, `deployments.csv`, and `UploadMeta.json` in place,
// guarded by `IfMatch` against the ETags the user reviewed, after writing an
// immutable pre-change snapshot.
//
// Two layers:
//   1. Pure planning — `buildSyncPlan` diffs drafts against the canonical base
//      into `@sparcd/camtrap` `MediaEdit`s. No I/O, fully testable.
//   2. `runSync` — the orchestrator. All S3/Dexie effects come through an
//      injected `SyncIO`, so the conflict / snapshot-collision / partial-resume
//      behaviour is testable with fakes and never touches a real bucket.
//
// Dry-run is opt-in (see the store): a dry-run returns the planned writes
// and touches nothing — not even a snapshot.

import {
  mergeMedia,
  mergeObservations,
  computeSpeciesDelta,
  applyUploadMetaEdit,
  parseUploadMeta,
  serializeUploadMeta,
  javaEditStamp,
  correctedTimestamp,
  hasSpeciesPresent,
  serializeDeployments,
  parseDeployments,
  parseCsvRows,
  mediaObjectName,
  serializeCsvRows,
  rebaseCaptureTimestamp,
  MEDIA_COL,
  OBS_COL,
  type MediaEdit,
  type TimeOffset,
  type Deployment,
  type ReviewEvent,
} from '@sparcd/camtrap';
import tzlookup from 'tz-lookup';
import type { TagImage } from './workspace';
import type { DraftRecord, DraftObservation } from './db';
import { sha256Hex } from './hash';
import {
  ROLE_ORDER,
  planResume,
  collectNewETags,
  type CanonicalRole,
  type SyncJournal,
  type JournalObject,
  type RemoteState,
} from './syncJournal';

// --- Canonical state -------------------------------------------------------

/** One canonical file as loaded for a sync: bytes + the ETag/hash to ground on. */
export type CanonicalFile = { text: string; etag: string; hash: string };
export type CanonicalState = Record<CanonicalRole, CanonicalFile>;

const SNAPSHOT_FILE: Record<CanonicalRole, string> = {
  media: 'media.csv',
  observations: 'observations.csv',
  deployments: 'deployments.csv',
  uploadMeta: 'UploadMeta.json',
};

const CONTENT_TYPE: Record<CanonicalRole, string> = {
  media: 'text/csv',
  observations: 'text/csv',
  deployments: 'text/csv',
  uploadMeta: 'application/json',
};

// --- Pure planning ---------------------------------------------------------

export type DiffSummary = {
  additions: number; // untagged → tagged
  modifications: number; // tagged → different species/count
  removals: number; // tagged → detagged
  timeCorrections: number; // images whose capture time changes
  confirmations: number; // species/count unchanged, but explicitly re-reviewed (#368)
};

export type SyncPlan = {
  /** Images whose observation rows change — drive `mergeObservations` + the delta. */
  tagEdits: MediaEdit[];
  /** Images whose `media.csv` col-4 timestamp changes but whose tags don't. */
  timeEdits: MediaEdit[];
  /** A whole-upload location correction — the wrong camera location was
   *  recorded. Rewrites `deployments.csv` to this single row and every media/
   *  observation row's deployment id to `locationEdit.deploymentId`. */
  locationEdit: Deployment | null;
  summary: DiffSummary;
};

/** Order-insensitive multiset equality of two observation arrays, comparing the
 *  fields a sync actually writes: `{scientificName, count(≥1), commonName,
 *  requested}`. Counts are floored to ≥1 on both sides so a base zero-count row
 *  (`positiveCount` drops it on write) and a re-tag at count 1 compare equal on
 *  count alone. */
function observationsEqual(a: DraftObservation[], b: DraftObservation[]): boolean {
  if (a.length !== b.length) return false;
  const key = (o: DraftObservation): string =>
    JSON.stringify([o.scientificName, Math.max(1, o.count), o.commonName ?? '', o.requestedSpecies ?? '']);
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (const o of a) { const k = key(o); ca.set(k, (ca.get(k) ?? 0) + 1); }
  for (const o of b) { const k = key(o); cb.set(k, (cb.get(k) ?? 0) + 1); }
  if (ca.size !== cb.size) return false;
  for (const [k, n] of ca) if (cb.get(k) !== n) return false;
  return true;
}

/** Canonical review events plus any new ones from the draft. A draft left clean
 *  by an earlier sync carries none, so the stored history must not depend on it. */
function mergeReviewEvents(base: ReviewEvent[] = [], draft: ReviewEvent[] = []): ReviewEvent[] | undefined {
  const out = [...base];
  for (const e of draft) {
    if (!out.some((b) => b.reviewedBy === e.reviewedBy && b.reviewedAt === e.reviewedAt)) out.push(e);
  }
  return out.length ? out : undefined;
}

/**
 * Diff the loaded drafts against the canonical base into the edits the merge
 * helpers consume. A draft whose observation multiset equals its base produces
 * no tag edit (re-applying the same species, or a questionable-only toggle, is
 * not a canonical change). The full observation array flows through, so a
 * multi-species image is never collapsed to one row.
 */
export function buildSyncPlan(
  images: TagImage[],
  drafts: Record<string, DraftRecord>,
  offset: TimeOffset | null,
  pendingLocation: Deployment | null = null,
  user = '',
  timeZone?: string,
): SyncPlan {
  const tagEdits: MediaEdit[] = [];
  const timeEdits: MediaEdit[] = [];
  const summary: DiffSummary = {
    additions: 0,
    modifications: 0,
    removals: 0,
    timeCorrections: 0,
    confirmations: 0,
  };

  for (const img of images) {
    // Only a dirty draft carries pending intent; a clean (already-synced) draft
    // must defer to the canonical base so it is never re-applied over a remote
    // change it didn't make.
    const d = drafts[img.key]?.dirty ? drafts[img.key] : undefined;
    const obs = d ? d.observations : img.baseObservations;
    // A pending location correction applies to every image uniformly — a
    // freshly-written observation row must carry the corrected deployment id,
    // not the stale one the image loaded with.
    const deploymentId = pendingLocation?.deploymentId ?? img.deploymentId;

    const corrected = correctedTimestamp(img.baseTimestamp, offset, d?.timeOverride ?? null, timeZone);
    const timeChanged = !!img.baseTimestamp && corrected !== img.baseTimestamp;
    // A Tagger correction replaces an uploader estimate with a user-provided
    // time. Keep the marker so downstream readers still know the camera did
    // not supply it, but make its source accurately say "manual".
    const timestampSource = timeChanged && img.timestampSource ? 'manual' : undefined;
    const tagChanged = !observationsEqual(obs, img.baseObservations);
    const confirmedSpecies = d?.confirmedSpecies ?? [];
    // Match provenance by the stable species key even when count/name fields
    // changed. A count correction must retain the canonical review history and
    // original attribution for that species.
    const baseForObservation = (o: (typeof obs)[number]) => img.baseObservations.find(
      (candidate) => candidate.scientificName === o.scientificName,
    );
    // Re-applying an existing species is an explicit confirmation action. The
    // draft records that action directly; comparing attribution fields would
    // mistake legacy drafts that lack those fields for confirmations.
    const confirmedUnchanged = !!d && !tagChanged &&
      (d.confirmedSpecies ?? []).some((name) => obs.some((o) => o.scientificName === name));

    // Removals already on the canonical rows are re-emitted on every rewrite of
    // this image; a species that is present again no longer counts as removed.
    const removedSpecies = [...new Set([
      ...(img.baseRemovedSpecies ?? []),
      ...(d?.removedSpecies ?? []).filter((name) => img.baseObservations.some((o) => o.scientificName === name)),
    ])].filter((name) => !obs.some((o) => o.scientificName === name));

    if (timeChanged) summary.timeCorrections++;

    if (tagChanged) {
      const wasTagged = hasSpeciesPresent(img.baseObservations);
      const nowTagged = obs.length > 0;
      if (!wasTagged && nowTagged) summary.additions++;
      else if (wasTagged && !nowTagged) summary.removals++;
      else summary.modifications++;

      summary.confirmations += confirmedSpecies.filter((name) =>
        obs.some((o) => o.scientificName === name) &&
        img.baseObservations.some((o) => o.scientificName === name),
      ).length;

      // A species replacement is the one-to-one case where an existing name
      // disappeared and a different name was added on the same image. Keep
      // that relationship on the replacement row so the canonical record
      // explains what was corrected. Additions, removals, and count-only edits
      // deliberately remain unmarked.
      const baseNames = new Set(img.baseObservations.map((o) => o.scientificName));
      const nextNames = new Set(obs.map((o) => o.scientificName));
      const removedNames = img.baseObservations
        .map((o) => o.scientificName)
        .filter((name) => !nextNames.has(name));
      const addedNames = obs
        .map((o) => o.scientificName)
        .filter((name) => !baseNames.has(name));
      const replacementFrom = removedNames.length === 1 && addedNames.length === 1
        ? removedNames[0]
        : undefined;
      // The swapped-out species is recorded once, as the correction, not also
      // as a removal.
      const removed = removedSpecies.filter((name) => name !== replacementFrom);

      tagEdits.push({
        mediaId: img.key,
        deploymentId,
        timestamp: corrected,
        mediaTimestamp: timeChanged ? corrected : undefined,
        timestampSource,
        removedSpecies: removed,
        observations: obs.map((o) => {
          const base = baseForObservation(o);
          // The editor is credited only for a species changed or re-applied
          // here, never for one that rides along with another species' edit.
          const touched = !base || Math.max(1, base.count) !== Math.max(1, o.count) ||
            confirmedSpecies.includes(o.scientificName);
          // Drafts written before classifiedBy/classificationTimestamp were
          // modeled can omit them. Preserve the canonical values rather than
          // blanking them when another observation on the image is edited.
          const classifiedBy = base
            ? base.classifiedBy ?? o.classifiedBy ?? (touched ? user.trim() || undefined : undefined)
            : o.classifiedBy ?? (user.trim() || undefined);
          const classificationTimestamp = base
            ? base.classificationTimestamp ?? o.classificationTimestamp
            : o.classificationTimestamp;
          return {
            scientificName: o.scientificName,
            count: Math.max(1, o.count),
            commonName: o.commonName || undefined,
            requestedSpecies: o.requestedSpecies || undefined,
            removedSpecies: obs[0] === o ? removed : undefined,
            reviewEvents: mergeReviewEvents(base?.reviewEvents, o.reviewEvents),
            // A clean draft left by an earlier sync no longer holds the marker,
            // so the canonical row is the source, as for attribution.
            correctedFrom: base?.correctedFrom ?? o.correctedFrom ??
              (replacementFrom && o.scientificName === addedNames[0] ? replacementFrom : undefined),
            classifiedBy,
            classificationTimestamp,
          };
        }),
      });
    } else if (confirmedUnchanged) {
      summary.confirmations++;
      tagEdits.push({
        mediaId: img.key,
        deploymentId,
        timestamp: corrected,
        mediaTimestamp: timeChanged ? corrected : undefined,
        timestampSource,
        // Content is identical to base by definition (tagChanged is false),
        // so no delta/summary bookkeeping runs here — only the attribution
        // `addObservation` already refreshed at apply time is written through.
        removedSpecies,
        observations: obs.map((o) => {
          const base = baseForObservation(o);
          const explicitlyConfirmed = confirmedSpecies.includes(o.scientificName);
          return {
            scientificName: o.scientificName,
            count: Math.max(1, o.count),
            commonName: o.commonName || undefined,
            requestedSpecies: o.requestedSpecies || undefined,
            removedSpecies: obs[0] === o ? removedSpecies : undefined,
            // Only the explicitly re-applied species receives the current
            // reviewer identity. Other legacy rows keep their canonical
            // attribution (or remain unattributed).
            classifiedBy: base?.classifiedBy ?? o.classifiedBy ??
              (explicitlyConfirmed ? user.trim() || undefined : undefined),
            classificationTimestamp: base?.classificationTimestamp ?? o.classificationTimestamp ??
              (explicitlyConfirmed ? new Date().toISOString() : undefined),
            reviewEvents: mergeReviewEvents(base?.reviewEvents, o.reviewEvents),
            correctedFrom: base?.correctedFrom ?? o.correctedFrom,
          };
        }),
      });
    } else if (timeChanged) {
      // Time correction on an image whose species rows don't change. Goes to
      // `mergeMedia` only (it reads `mediaTimestamp`); `observations` stays `[]`
      // here and is never handed to `mergeObservations`, so its rows survive.
      timeEdits.push({
        mediaId: img.key,
        deploymentId,
        timestamp: corrected,
        mediaTimestamp: corrected,
        timestampSource,
        observations: [],
      });
    }
  }

  return { tagEdits, timeEdits, locationEdit: pendingLocation, summary };
}

export function planIsEmpty(plan: SyncPlan): boolean {
  return plan.tagEdits.length === 0 && plan.timeEdits.length === 0 && plan.locationEdit === null;
}

// --- Snapshot stamp --------------------------------------------------------

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Filesystem-friendly snapshot stamp `uuuu-MM-ddTHH-mm-ss` (colons → dashes). */
export function snapshotStamp(d: Date): string {
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T` +
    `${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`
  );
}

// The connected account or local handoff identity is percent-encoded into the
// key — a `/` or other path-significant character can't break the two-level
// `<identity>/<stamp>/` layout the snapshot reader walks. The reader decodes it
// back.
export const snapshotPrefixOf = (uploadPrefix: string, user: string, stamp: string): string =>
  `${uploadPrefix}.sparcd-tagger-snapshots/${encodeURIComponent(user)}/${stamp}/`;

/** Prefix for the one immutable copy of the upload's initial canonical state. */
export const originalBaselinePrefixOf = (uploadPrefix: string): string =>
  `${uploadPrefix}.sparcd-tagger-original/`;

// --- Orchestrator ----------------------------------------------------------

/** Every S3/Dexie effect the sync performs, injected so it is fully testable. */
export type SyncIO = {
  /** Re-HEAD/GET the three canonical files with current ETag + SHA-256. */
  loadCanonical: () => Promise<CanonicalState>;
  /** Conditional `writeImmutable` of one snapshot object; rejects with a 412-typed error if the key exists. */
  writeSnapshot: (key: string, body: string, contentType: string) => Promise<void>;
  /** Create the immutable first-state baseline if this upload has none yet. */
  ensureOriginalBaseline?: (current: CanonicalState) => Promise<void>;
  /** `replaceIfUnchanged` of one canonical object; rejects with a conflict-typed error on a stale ETag. */
  replace: (key: string, body: string, etag: string, contentType: string) => Promise<{ etag?: string }>;
  saveJournal: (journal: SyncJournal) => Promise<void>;
  clearJournal: () => Promise<void>;
  now: () => Date;
};

export type PlannedWrite = { role: CanonicalRole; key: string; bytes: number; baseETag: string };

/** A canonical body prepared for writing: the bytes + their SHA-256, by role. */
type PreparedWrite = { role: CanonicalRole; body: string; hash: string };

/** The snapshot's `manifest.json`, written last so recovery ignores partial
 *  prefixes. The shape both the writer (`writeSnapshotSet`) and the reader
 *  (`s3.listSnapshots`) agree on. */
export type SnapshotManifest = {
  schemaVersion: 1;
  user: string;
  editStamp: string;
  files: { name: string; etag: string; sha256: string }[];
};

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

export type SyncResult =
  | { status: 'noop' }
  | { status: 'dry-run'; summary: DiffSummary; snapshotPrefix: string; writes: PlannedWrite[] }
  | {
      status: 'synced';
      summary: DiffSummary;
      newETags: Partial<Record<CanonicalRole, string>>;
      /** The media IDs written to canonical, so the caller can clear exactly
       *  those drafts. Absent on a journal resume (the journal carries bodies,
       *  not per-image edits). */
      syncedMediaIds?: string[];
    }
  | { status: 'conflict'; role: CanonicalRole; reason: string }
  | { status: 'unsupported'; message: string };

export type SyncParams = {
  bucket: string;
  uploadPrefix: string;
  user: string;
  /** The grounded base ETag + content hash the user reviewed (per role). Both
   *  are checked pre-write so a remote change is caught even if the backend's
   *  ETag scheme is unreliable. */
  base: Record<CanonicalRole, { etag: string; hash: string }>;
  plan: SyncPlan;
  dryRun: boolean;
  /** A journal left by a prior partial sync, to resume instead of starting fresh. */
  resumeJournal?: SyncJournal;
};

const key = (uploadPrefix: string, role: CanonicalRole): string =>
  `${uploadPrefix}${SNAPSHOT_FILE[role]}`;

/** Thrown error looks like a 412 (snapshot key already exists)? */
function isPrecondition(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'PreconditionFailedError' || e?.$metadata?.httpStatusCode === 412;
}

function isReplaceConflict(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalReplaceConflictError';
}

function isUnsupported(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalPutUnsupportedError';
}

function rewriteDeploymentAndRebase(
  csv: string,
  deploymentColumn: number,
  timestampColumn: number,
  fromDeploymentId: string | undefined,
  toDeploymentId: string,
  fromTimeZone: string | undefined,
  recoveryTimeZone: string | undefined,
  toTimeZone: string,
  // Rows this sync just wrote already carry the new deployment id but still
  // hold timestamps in the old zone.
  isFreshRow: (row: string[]) => boolean = () => false,
): string {
  const rows = parseCsvRows(csv);
  for (const row of rows) {
    if (fromDeploymentId !== undefined && row[deploymentColumn] !== fromDeploymentId && !isFreshRow(row)) continue;
    const timestamp = row[timestampColumn] ?? '';
    if (timestamp && fromTimeZone && fromTimeZone !== toTimeZone) {
      try {
        row[timestampColumn] = rebaseCaptureTimestamp(timestamp, recoveryTimeZone, toTimeZone);
      } catch {
        // Preserve malformed legacy values while still correcting the location.
      }
    }
    row[deploymentColumn] = toDeploymentId;
  }
  return serializeCsvRows(rows);
}

function replaceDeploymentRow(csv: string, fromDeploymentId: string | undefined, replacement: string[]): string {
  const rows = parseCsvRows(csv);
  const replacementId = replacement[0] ?? '';
  const targetExists = replacementId !== fromDeploymentId && rows.some((row) => row[0] === replacementId);
  const out: string[][] = [];
  let placed = false;
  for (const row of rows) {
    if (fromDeploymentId === undefined || row[0] === fromDeploymentId) {
      if (!placed && !targetExists) {
        out.push(replacement);
        placed = true;
      }
    } else {
      out.push(row);
    }
  }
  if (!placed && !targetExists) out.push(replacement);
  return serializeCsvRows(out);
}

/**
 * Build the merged canonical bodies and which roles actually change. The merge
 * runs against `current` (verified equal to the grounded base), so unrelated
 * rows and unmodelled columns survive verbatim. `UploadMeta.json` always
 * changes — every successful sync appends its mandatory edit comment. A
 * pending location correction rewrites matching media/observation rows and
 * replaces the matching deployment row while preserving other deployments —
 * applied on top of the tag/time merge, not instead of it, so a location
 * change and species edits in the same sync both land correctly.
 */
async function buildWrites(
  current: CanonicalState,
  plan: SyncPlan,
  user: string,
  editStamp: string,
  uploadPrefix: string,
): Promise<PreparedWrite[]> {
  const allMediaEdits = [...plan.tagEdits, ...plan.timeEdits];
  let mediaBody = mergeMedia(current.media.text, allMediaEdits);
  let observationsBody = mergeObservations(current.observations.text, plan.tagEdits, {
    observationId: (mediaId, i) => `${mediaObjectName(mediaId, uploadPrefix)}:${i}`,
  });
  let deploymentsBody = current.deployments.text;
  if (plan.locationEdit) {
    const currentDeployment = parseDeployments(current.deployments.text)[0];
    const fromDeploymentId = currentDeployment?.deploymentId;
    const fromTimeZone = currentDeployment
      ? tzlookup(currentDeployment.latitude, currentDeployment.longitude)
      : undefined;
    const toTimeZone = tzlookup(plan.locationEdit.latitude, plan.locationEdit.longitude);
    const legacyTimeZone = parseUploadMeta(current.uploadMeta.text).captureTimeZone ?? fromTimeZone;
    const tagged = new Set(plan.tagEdits.map((e) => e.mediaId));
    mediaBody = rewriteDeploymentAndRebase(
      mediaBody,
      MEDIA_COL.deploymentId,
      MEDIA_COL.timestamp,
      fromDeploymentId,
      plan.locationEdit.deploymentId,
      fromTimeZone,
      legacyTimeZone,
      toTimeZone,
    );
    observationsBody = rewriteDeploymentAndRebase(
      observationsBody,
      OBS_COL.deploymentId,
      OBS_COL.timestamp,
      fromDeploymentId,
      plan.locationEdit.deploymentId,
      fromTimeZone,
      legacyTimeZone,
      toTimeZone,
      (row) => tagged.has(row[OBS_COL.mediaId]),
    );
    const replacement = parseCsvRows(serializeDeployments([plan.locationEdit]))[0];
    deploymentsBody = replaceDeploymentRow(current.deployments.text, fromDeploymentId, replacement);
  }
  const bodies: Record<CanonicalRole, string> = {
    media: mediaBody,
    observations: observationsBody,
    deployments: deploymentsBody,
    uploadMeta: '',
  };
  const delta = computeSpeciesDelta(current.observations.text, plan.tagEdits);
  const meta = applyUploadMetaEdit(parseUploadMeta(current.uploadMeta.text), {
    delta,
    user,
    editStamp,
  });
  bodies.uploadMeta = serializeUploadMeta(meta);

  return prepareWrites(current, bodies);
}

/** Keep only the roles whose bytes actually change, hashing each kept body. A
 *  role absent from `bodies` (an old snapshot missing `deployments.csv`) is
 *  treated as unchanged, not rewritten. */
async function prepareWrites(
  current: CanonicalState,
  bodies: Partial<Record<CanonicalRole, string>>,
): Promise<PreparedWrite[]> {
  const out: PreparedWrite[] = [];
  for (const role of ROLE_ORDER) {
    const body = bodies[role];
    if (body === undefined || body === current[role].text) continue; // unchanged → don't rewrite
    out.push({ role, body, hash: await sha256Hex(body) });
  }
  return out;
}

/** Write the canonical objects of a journal that are still pending, in order. */
async function writePending(
  io: SyncIO,
  journal: SyncJournal,
  fromIndex: number,
): Promise<SyncResult> {
  for (let i = fromIndex; i < journal.objects.length; i++) {
    const obj = journal.objects[i];
    if (obj.status === 'written') continue;
    try {
      const res = await io.replace(obj.key, obj.body, obj.baseETag, CONTENT_TYPE[obj.role]);
      obj.status = 'written';
      obj.newETag = res.etag;
      await io.saveJournal(journal);
    } catch (err) {
      if (isReplaceConflict(err))
        return { status: 'conflict', role: obj.role, reason: 'a canonical object changed mid-sync' };
      if (isUnsupported(err))
        return {
          status: 'unsupported',
          message: 'The endpoint does not enforce IfMatch — canonical sync is disabled here.',
        };
      throw err;
    }
  }
  await io.clearJournal();
  return { status: 'synced', summary: EMPTY_SUMMARY, newETags: collectNewETags(journal) };
}

const EMPTY_SUMMARY: DiffSummary = {
  additions: 0,
  modifications: 0,
  removals: 0,
  timeCorrections: 0,
  confirmations: 0,
};

/**
 * Write the pre-change snapshot set (old canonical bodies, then `manifest.json`
 * last). On a 412 collision the caller re-stamps +1s and retries once. The
 * manifest is written last so recovery ignores incomplete snapshot prefixes.
 */
async function writeSnapshotSet(
  io: SyncIO,
  snapshotPrefix: string,
  current: CanonicalState,
  user: string,
  editStamp: string,
): Promise<void> {
  for (const role of ROLE_ORDER) {
    await io.writeSnapshot(`${snapshotPrefix}${SNAPSHOT_FILE[role]}`, current[role].text, CONTENT_TYPE[role]);
  }
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    user,
    editStamp,
    files: ROLE_ORDER.map((role) => ({
      name: SNAPSHOT_FILE[role],
      etag: current[role].etag,
      sha256: current[role].hash,
    })),
  };
  await io.writeSnapshot(`${snapshotPrefix}manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
}

/**
 * The first live edit needs a durable copy of the upload as it arrived. This
 * is deliberately separate from timestamped rollback snapshots: the baseline
 * is created once and is never replaced or removed. The storage adapter owns
 * the idempotent conditional-write details.
 */
async function ensureOriginalBaseline(io: SyncIO, current: CanonicalState): Promise<void> {
  await io.ensureOriginalBaseline?.(current);
}

/**
 * Resume a prior partial sync/restore: verify written/pending objects against
 * the current remote, then continue from the first pending one. Returns the
 * terminal `SyncResult` when a journal is present (whether it conflicts,
 * completes, or describes a dry-run), or `null` when there is no journal and the
 * caller should plan a fresh write. The journal carries the exact bodies, so a
 * resume completes the originally-intended write even after a browser reload —
 * and a pending sync or restore journal must be finished (or its conflict
 * resolved) before a new operation begins.
 */
async function tryResume(
  io: SyncIO,
  resumeJournal: SyncJournal | undefined,
  dryRun: boolean,
): Promise<SyncResult | null> {
  if (!resumeJournal) return null;
  const journal = resumeJournal;
  const cur = await io.loadCanonical();
  const decision = planResume(journal, remoteStates(cur));
  if (decision.kind === 'conflict')
    return { status: 'conflict', role: decision.role, reason: decision.reason };
  // A journal may have been created by an older version before the immutable
  // baseline was introduced. Establish the baseline before completing any
  // resumed canonical write; the S3 adapter can use any available pre-change
  // snapshot when one exists.
  if (!dryRun) await ensureOriginalBaseline(io, cur);
  if (decision.kind === 'done') {
    if (dryRun)
      return { status: 'dry-run', summary: EMPTY_SUMMARY, snapshotPrefix: journal.snapshotPrefix, writes: [] };
    await io.clearJournal();
    return { status: 'synced', summary: EMPTY_SUMMARY, newETags: collectNewETags(journal) };
  }
  if (dryRun) {
    // A dry-run never writes — describe the pending objects a real resume would.
    return {
      status: 'dry-run',
      summary: EMPTY_SUMMARY,
      snapshotPrefix: journal.snapshotPrefix,
      writes: journal.objects
        .slice(decision.fromIndex)
        .filter((o) => o.status === 'pending')
        .map((o) => ({ role: o.role, key: o.key, bytes: byteLen(o.body), baseETag: o.baseETag })),
    };
  }
  return writePending(io, journal, decision.fromIndex);
}

type CommitCtx = {
  bucket: string;
  uploadPrefix: string;
  user: string;
  current: CanonicalState;
  writes: PreparedWrite[];
  editStamp: string;
  snapshotPrefix: string;
};

/**
 * The shared live-write path for both sync and restore: snapshot the current
 * canonical state immutably (manifest last, +1s re-stamp once on a 412
 * collision), journal the intended writes, then conditionally replace each
 * changed canonical object in order. The journal is left in place on a mid-write
 * conflict so the next attempt resumes instead of restarting.
 */
async function commitWrites(io: SyncIO, c: CommitCtx, summary: DiffSummary): Promise<SyncResult> {
  // 1. Preserve the first uploaded state before creating any later snapshot.
  await ensureOriginalBaseline(io, c.current);

  // 2. Immutable pre-change snapshot, with a single +1s re-stamp on collision.
  let activePrefix = c.snapshotPrefix;
  try {
    await writeSnapshotSet(io, activePrefix, c.current, c.user, c.editStamp);
  } catch (err) {
    if (!isPrecondition(err)) throw err;
    const bumped = snapshotStamp(new Date(io.now().getTime() + 1000));
    activePrefix = snapshotPrefixOf(c.uploadPrefix, c.user, bumped);
    await writeSnapshotSet(io, activePrefix, c.current, c.user, c.editStamp);
  }

  // 3. Journal the intended writes before the first canonical PUT.
  const journal: SyncJournal = {
    id: `${c.bucket}::${c.uploadPrefix}`,
    bucket: c.bucket,
    uploadPrefix: c.uploadPrefix,
    snapshotPrefix: activePrefix,
    user: c.user,
    startedAt: io.now().toISOString(),
    objects: c.writes.map<JournalObject>((w) => ({
      role: w.role,
      key: key(c.uploadPrefix, w.role),
      baseETag: c.current[w.role].etag,
      baseHash: c.current[w.role].hash,
      body: w.body,
      intendedHash: w.hash,
      status: 'pending',
    })),
  };
  await io.saveJournal(journal);

  // 4. Conditional canonical replacement, in order, recording each new ETag.
  const result = await writePending(io, journal, 0);
  if (result.status === 'synced') return { ...result, summary };
  return result;
}

export async function runSync(params: SyncParams, io: SyncIO): Promise<SyncResult> {
  const { bucket, uploadPrefix, user, plan, dryRun } = params;

  const resumed = await tryResume(io, params.resumeJournal, dryRun);
  if (resumed) return resumed;

  if (planIsEmpty(plan)) return { status: 'noop' };

  const current = await io.loadCanonical();

  // Pre-write conflict detection: the grounded base (ETag *and* content hash)
  // must still be the remote.
  for (const role of ROLE_ORDER) {
    if (current[role].etag !== params.base[role].etag || current[role].hash !== params.base[role].hash) {
      return {
        status: 'conflict',
        role,
        reason: 'the canonical file changed since this upload was loaded',
      };
    }
  }

  const editStamp = javaEditStamp(io.now());
  const writes = await buildWrites(current, plan, user, editStamp, uploadPrefix);
  const snapshotPrefix = snapshotPrefixOf(uploadPrefix, user, snapshotStamp(io.now()));

  if (dryRun) {
    return {
      status: 'dry-run',
      summary: plan.summary,
      snapshotPrefix,
      writes: writes.map((w) => ({
        role: w.role,
        key: key(uploadPrefix, w.role),
        bytes: byteLen(w.body),
        baseETag: current[w.role].etag,
      })),
    };
  }

  const result = await commitWrites(
    io,
    { bucket, uploadPrefix, user, current, writes, editStamp, snapshotPrefix },
    plan.summary,
  );
  if (result.status === 'synced') {
    const syncedMediaIds = [...plan.tagEdits, ...plan.timeEdits].map((e) => e.mediaId);
    return { ...result, syncedMediaIds };
  }
  return result;
}

// --- Restore (P5) ----------------------------------------------------------

export type RestoreParams = {
  bucket: string;
  uploadPrefix: string;
  /** Who is performing the restore — stamps the new pre-restore snapshot path. */
  user: string;
  /** The snapshot bodies to write back, by role. A role absent (an old
   *  snapshot predating that role) is left untouched rather than restored. */
  bodies: Partial<Record<CanonicalRole, string>>;
  dryRun: boolean;
  /** A journal left by a prior partial sync/restore, to resume instead of starting fresh. */
  resumeJournal?: SyncJournal;
};

/**
 * Restore a prior snapshot: write its `media.csv` / `observations.csv` /
 * `deployments.csv` / `UploadMeta.json` back verbatim through the same
 * conditional-replacement flow
 * a sync uses. The snapshot bytes are restored exactly (no merge, no re-derived
 * `UploadMeta` tally) — an exact rollback — and `IfMatch` is taken against the
 * *current* remote ETags, so a concurrent write since the restore was started is
 * caught as a conflict rather than silently clobbered. The current (pre-restore)
 * state is itself snapshotted first, so a restore is as recoverable as a sync.
 * Only the files whose bytes differ from the current canonical are rewritten.
 */
export async function runRestore(params: RestoreParams, io: SyncIO): Promise<SyncResult> {
  const { bucket, uploadPrefix, user, bodies, dryRun } = params;

  const resumed = await tryResume(io, params.resumeJournal, dryRun);
  if (resumed) return resumed;

  const current = await io.loadCanonical();
  // Legacy snapshots predate deployments.csv. They are safe only when every
  // deployment referenced by their media/observations still exists in the
  // current deployment file; otherwise restoring them would create dangling
  // references after a later location correction.
  if (bodies.deployments === undefined && current.deployments.text) {
    const available = new Set(parseDeployments(current.deployments.text).map((deployment) => deployment.deploymentId));
    const referenced = new Set([
      ...parseCsvRows(bodies.media ?? '').map((row) => row[MEDIA_COL.deploymentId]),
      ...parseCsvRows(bodies.observations ?? '').map((row) => row[OBS_COL.deploymentId]),
    ].filter(Boolean));
    if ([...referenced].some((deploymentId) => !available.has(deploymentId))) {
      throw new Error('This snapshot predates deployment records and cannot be restored safely after a location change.');
    }
  }
  const writes = await prepareWrites(current, bodies);
  if (writes.length === 0) return { status: 'noop' };

  const editStamp = javaEditStamp(io.now());
  const snapshotPrefix = snapshotPrefixOf(uploadPrefix, user, snapshotStamp(io.now()));

  if (dryRun) {
    return {
      status: 'dry-run',
      summary: EMPTY_SUMMARY,
      snapshotPrefix,
      writes: writes.map((w) => ({
        role: w.role,
        key: key(uploadPrefix, w.role),
        bytes: byteLen(w.body),
        baseETag: current[w.role].etag,
      })),
    };
  }

  return commitWrites(io, { bucket, uploadPrefix, user, current, writes, editStamp, snapshotPrefix }, EMPTY_SUMMARY);
}

function remoteStates(state: CanonicalState): Record<CanonicalRole, RemoteState> {
  return {
    media: { etag: state.media.etag, hash: state.media.hash },
    observations: { etag: state.observations.etag, hash: state.observations.hash },
    deployments: { etag: state.deployments.etag, hash: state.deployments.hash },
    uploadMeta: { etag: state.uploadMeta.etag, hash: state.uploadMeta.hash },
  };
}
