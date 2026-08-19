// Edit-after-publish (Stage B) — the uploader's only in-place write path. A
// published upload's description or its misassigned deployment/location can be
// corrected here, guarded exactly the way the tagger's sync guards its canonical
// writes: every change is gated by `IfMatch` against the ETag the user reviewed,
// a stale ETag is a CONFLICT (reload, re-review, retry) and NEVER a blind
// overwrite, and an immutable pre-change snapshot is written first so the edit
// is recoverable.
//
// Two layers, mirroring `sync.ts`:
//   1. Pure body builders — `buildDescriptionEdit` / `restampDeployment` turn the
//      current canonical bytes into the next bytes, touching only what the edit
//      changes (every unrelated row/byte survives via parseCsvRows→serializeCsvRows
//      and serializeUploadMeta's insertion-order key preservation). No I/O.
//   2. `runPublishedEdit` — the orchestrator. All S3 effects come through an
//      injected `EditIO`, so the conflict / snapshot-collision behaviour is
//      testable with fakes and never touches a real bucket.
//
// Driven by the store's `dryRun` flag: a dry-run returns the planned writes
// and touches nothing — not even a snapshot.
//
// Unlike the tagger's sync there is no Dexie journal: an edit is at most four
// small files, so a mid-write conflict is resolved by reload + retry, and the
// pre-edit snapshot already makes the edit recoverable.

import {
  parseUploadMeta,
  serializeUploadMeta,
  serializeDeployments,
  parseCsvRows,
  serializeCsvRows,
  MEDIA_COL,
  OBS_COL,
  DEPLOY_COL,
  javaEditStamp,
  type Deployment,
} from '@sparcd/camtrap';

// --- Roles -----------------------------------------------------------------

/** The canonical files an edit can touch. A description edit touches only
 *  `uploadMeta`; a deployment correction touches the three CSVs. */
export type EditRole = 'deployments' | 'media' | 'observations' | 'uploadMeta';

const FILE: Record<EditRole, string> = {
  deployments: 'deployments.csv',
  media: 'media.csv',
  observations: 'observations.csv',
  uploadMeta: 'UploadMeta.json',
};

const CONTENT_TYPE: Record<EditRole, string> = {
  deployments: 'text/csv',
  media: 'text/csv',
  observations: 'text/csv',
  uploadMeta: 'application/json',
};

// Snapshot + replace order. CSVs first, UploadMeta.json last, matching the
// tagger's role ordering so recovery reasons about a stable sequence.
const ROLE_ORDER: EditRole[] = ['deployments', 'media', 'observations', 'uploadMeta'];

// --- Canonical state -------------------------------------------------------

/** One canonical file as loaded for an edit: bytes + the ETag/hash to ground on. */
export type CanonicalFile = { text: string; etag: string; hash: string };
/** Only the roles a given edit needs are loaded. */
export type EditCanonical = Partial<Record<EditRole, CanonicalFile>>;

// --- Pure body builders ----------------------------------------------------

/**
 * Description edit: replace `UploadMeta.description` and append the mandatory
 * Java edit comment. Every other key keeps its position, so the serialized bytes
 * stay aligned with the live file (`serializeUploadMeta` preserves insertion
 * order).
 */
export function buildDescriptionEdit(
  metaText: string,
  opts: { description: string; user: string; editStamp: string },
): string {
  const meta = parseUploadMeta(metaText);
  // Older/foreign UploadMeta.json (Java, pre-editComments) may omit the field;
  // parseUploadMeta is a bare cast, so default it before spreading.
  const prior = Array.isArray(meta.editComments) ? meta.editComments : [];
  return serializeUploadMeta({
    ...meta,
    description: opts.description,
    editComments: [...prior, `Edited by ${opts.user} on ${opts.editStamp}`],
  });
}

export type RestampInput = {
  /** Only rows currently carrying this deployment_id are re-pointed; when
   *  omitted (the single-deployment upload), every row is re-pointed. */
  fromDeploymentId?: string;
  toDeploymentId: string;
  /** The chosen location's full deployment row (re-points coords/name too). */
  location: Deployment;
};

/** Re-stamp one CSV's deployment_id column, touching only rows that match. */
function restampCsv(csv: string, col: number, from: string | undefined, to: string): string {
  const rows = parseCsvRows(csv);
  for (const row of rows) {
    if (from === undefined || row[col] === from) row[col] = to;
  }
  return serializeCsvRows(rows);
}

/**
 * Re-stamp `deployment_id` consistently across the three CSVs to fix a
 * misassigned camera site. Touches ONLY the deployment_id column in `media.csv`
 * and `observations.csv`; the matching `deployments.csv` row is re-serialized
 * from the chosen location (re-pointing deployment_id + location_id/name/coords/
 * elevation — the full correction). Every unrelated row/byte is preserved.
 */
export function restampDeployment(
  csv: { deployments: string; media: string; observations: string },
  opts: RestampInput,
): { deployments: string; media: string; observations: string } {
  // deployments.csv: replace only the row(s) for the old deployment with the
  // chosen location's full row; any unrelated deployment rows survive verbatim.
  const depRows = parseCsvRows(csv.deployments);
  const correctedRow = parseCsvRows(serializeDeployments([opts.location]))[0];
  const out: string[][] = [];
  let placed = false;
  for (const row of depRows) {
    if (opts.fromDeploymentId === undefined || row[DEPLOY_COL.deploymentId] === opts.fromDeploymentId) {
      if (!placed) {
        out.push(correctedRow);
        placed = true;
      }
      // Drop additional matching rows (a single corrected deployment replaces them).
    } else {
      out.push(row);
    }
  }
  if (!placed) out.push(correctedRow); // empty/unmatched file → write the corrected row

  return {
    deployments: serializeCsvRows(out),
    media: restampCsv(csv.media, MEDIA_COL.deploymentId, opts.fromDeploymentId, opts.toDeploymentId),
    observations: restampCsv(
      csv.observations,
      OBS_COL.deploymentId,
      opts.fromDeploymentId,
      opts.toDeploymentId,
    ),
  };
}

// --- Snapshot stamp + prefix ----------------------------------------------

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Filesystem-friendly snapshot stamp `uuuu-MM-ddTHH-mm-ss` (colons → dashes). */
export function snapshotStamp(d: Date): string {
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T` +
    `${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`
  );
}

// Uploader-namespaced snapshot dir so an edit snapshot never collides with a
// tagger snapshot under the same upload prefix. The user id is percent-encoded
// so a `/` in a free-text identity can't break the `<user>/<stamp>/` layout.
export const snapshotPrefixOf = (uploadPrefix: string, user: string, stamp: string): string =>
  `${uploadPrefix}.sparcd-uploader-snapshots/${encodeURIComponent(user)}/${stamp}/`;

// --- Orchestrator ----------------------------------------------------------

/** Every S3 effect the edit performs, injected so it is fully testable. */
export type EditIO = {
  /** Re-GET/HEAD the named roles with current ETag + SHA-256. */
  loadCanonical: (roles: EditRole[]) => Promise<EditCanonical>;
  /** Conditional `writeImmutable` of one snapshot object; rejects 412-typed if the key exists. */
  writeSnapshot: (key: string, body: string, contentType: string) => Promise<void>;
  /** `replaceIfUnchanged` of one canonical object; rejects conflict-typed on a stale ETag. */
  replace: (key: string, body: string, etag: string, contentType: string) => Promise<{ etag?: string }>;
  now: () => Date;
};

export type PlannedWrite = { role: EditRole; key: string; bytes: number; baseETag: string };

/** The snapshot's `manifest.json`, written last so recovery ignores partial
 *  prefixes — same shape the tagger writes (and its reader walks). */
export type SnapshotManifest = {
  schemaVersion: 1;
  user: string;
  editStamp: string;
  files: { name: string; etag: string; sha256: string }[];
};

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

export type EditResult =
  | { status: 'noop' }
  | { status: 'dry-run'; snapshotPrefix: string; writes: PlannedWrite[] }
  | { status: 'edited'; newETags: Partial<Record<EditRole, string>> }
  | { status: 'conflict'; role: EditRole; reason: string }
  | { status: 'unsupported'; message: string };

export type EditParams = {
  bucket: string;
  uploadPrefix: string;
  user: string;
  /** The grounded base ETag + content hash the user reviewed (per touched role). */
  base: Partial<Record<EditRole, { etag: string; hash: string }>>;
  /** The pre-built next body for each role the edit changes. */
  bodies: Partial<Record<EditRole, string>>;
  dryRun: boolean;
};

const key = (uploadPrefix: string, role: EditRole): string => `${uploadPrefix}${FILE[role]}`;

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

const rolesOf = (bodies: Partial<Record<EditRole, string>>): EditRole[] =>
  ROLE_ORDER.filter((r) => bodies[r] !== undefined);

/**
 * Write the immutable pre-change snapshot set (current bodies of the touched
 * roles, then `manifest.json` last). The manifest lists the pre-edit ETags so a
 * snapshot is an exact rollback source. On a 412 key collision the caller
 * re-stamps +1s and retries once.
 */
async function writeSnapshotSet(
  io: EditIO,
  snapshotPrefix: string,
  current: EditCanonical,
  roles: EditRole[],
  user: string,
  editStamp: string,
): Promise<void> {
  for (const role of roles) {
    await io.writeSnapshot(`${snapshotPrefix}${FILE[role]}`, current[role]!.text, CONTENT_TYPE[role]);
  }
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    user,
    editStamp,
    files: roles.map((role) => ({
      name: FILE[role],
      etag: current[role]!.etag,
      sha256: current[role]!.hash,
    })),
  };
  await io.writeSnapshot(`${snapshotPrefix}manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
}

export async function runPublishedEdit(params: EditParams, io: EditIO): Promise<EditResult> {
  const { bucket, uploadPrefix, user, base, bodies, dryRun } = params;
  void bucket; // bucket is bound into the injected IO closures; kept on params for symmetry.

  const roles = rolesOf(bodies);
  if (roles.length === 0) return { status: 'noop' };

  const current = await io.loadCanonical(roles);

  // Pre-write conflict detection: the grounded base (ETag *and* content hash)
  // must still be the remote, for every touched role — else write nothing.
  for (const role of roles) {
    const cur = current[role];
    const b = base[role];
    if (!cur || !b || cur.etag !== b.etag || cur.hash !== b.hash) {
      return {
        status: 'conflict',
        role,
        reason: 'the canonical file changed since this upload was loaded',
      };
    }
  }

  // Keep only roles whose bytes actually change; an unchanged role is skipped.
  const changed = roles.filter((role) => bodies[role] !== current[role]!.text);
  if (changed.length === 0) return { status: 'noop' };

  const editStamp = javaEditStamp(io.now());
  const snapshotPrefix = snapshotPrefixOf(uploadPrefix, user, snapshotStamp(io.now()));

  if (dryRun) {
    return {
      status: 'dry-run',
      snapshotPrefix,
      writes: changed.map((role) => ({
        role,
        key: key(uploadPrefix, role),
        bytes: byteLen(bodies[role]!),
        baseETag: current[role]!.etag,
      })),
    };
  }

  // 1. Immutable pre-change snapshot, with a single +1s re-stamp on collision.
  let activePrefix = snapshotPrefix;
  try {
    await writeSnapshotSet(io, activePrefix, current, changed, user, editStamp);
  } catch (err) {
    if (!isPrecondition(err)) throw err;
    activePrefix = snapshotPrefixOf(uploadPrefix, user, snapshotStamp(new Date(io.now().getTime() + 1000)));
    await writeSnapshotSet(io, activePrefix, current, changed, user, editStamp);
  }

  // 2. Conditional canonical replacement, in order, recording each new ETag. A
  //    mid-write 412 stops here and returns a conflict (the snapshot already
  //    makes prior writes recoverable); 501 means the backend won't enforce
  //    IfMatch, so the edit is unsupported there.
  const newETags: Partial<Record<EditRole, string>> = {};
  for (const role of changed) {
    try {
      const res = await io.replace(key(uploadPrefix, role), bodies[role]!, current[role]!.etag, CONTENT_TYPE[role]);
      newETags[role] = res.etag;
    } catch (err) {
      if (isReplaceConflict(err))
        return { status: 'conflict', role, reason: 'a canonical object changed mid-edit' };
      if (isUnsupported(err))
        return {
          status: 'unsupported',
          message: 'The endpoint does not enforce IfMatch — published edits are disabled here.',
        };
      throw err;
    }
  }
  return { status: 'edited', newETags };
}
