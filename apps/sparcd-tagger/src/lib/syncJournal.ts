// The per-object sync journal and its resume planner. S3 has no atomic
// three-object transaction, so a sync that fails after writing media.csv (but
// before observations.csv / UploadMeta.json) must be resumable — not blindly
// retried. The journal is persisted (Dexie) before the first canonical write;
// each object records the ETag it will write against, the bytes it will write,
// that body's SHA-256, and whether it has been written yet.
//
// This module is pure: it owns the journal shape and the resume decision. The
// orchestrator (`sync.ts`) drives the actual I/O.

/** Which canonical file an object is. Order here is the write order. */
export type CanonicalRole = 'media' | 'observations' | 'deployments' | 'uploadMeta';

export const ROLE_ORDER: CanonicalRole[] = ['media', 'observations', 'deployments', 'uploadMeta'];

export type JournalObjectStatus = 'pending' | 'written';

export type JournalObject = {
  role: CanonicalRole;
  key: string; // full object key
  baseETag: string; // the IfMatch ETag this object writes against
  baseHash: string; // sha256 of the base bytes — verified on resume for pending objects
  body: string; // the exact bytes to write (canonical CSVs/JSON are small)
  intendedHash: string; // sha256(body) — verified on resume for written objects
  status: JournalObjectStatus;
  newETag?: string; // set once written
};

export type SyncJournal = {
  id: string; // `${bucket}::${uploadPrefix}`
  bucket: string;
  uploadPrefix: string;
  snapshotPrefix: string; // where the pre-write snapshot landed
  user: string;
  startedAt: string; // ISO
  objects: JournalObject[]; // in ROLE_ORDER
};

/** The freshly re-loaded remote state for one canonical file. */
export type RemoteState = { etag: string; hash: string };

export type ResumeDecision =
  | { kind: 'continue'; fromIndex: number } // resume writing from this object
  | { kind: 'done' } // every object already written + verified
  | { kind: 'conflict'; role: CanonicalRole; reason: string };

/**
 * Decide how to resume a journaled sync against the current remote state.
 *
 *  - A `written` object must still hash to its intended content; if it changed
 *    remotely, another writer touched a partially-synced object → conflict
 *    repair, never a blind continue.
 *  - A `pending` object must still match the base ETag *and* hash it was
 *    journaled against; if either changed, the base the user reviewed is stale
 *    → conflict.
 *  - Otherwise continue from the first pending object forward.
 */
export function planResume(
  journal: SyncJournal,
  current: Record<CanonicalRole, RemoteState>,
): ResumeDecision {
  let firstPending = -1;
  for (let i = 0; i < journal.objects.length; i++) {
    const obj = journal.objects[i];
    const remote = current[obj.role];
    if (obj.status === 'written') {
      if (remote.hash !== obj.intendedHash) {
        return {
          kind: 'conflict',
          role: obj.role,
          reason: 'an already-written object was changed remotely',
        };
      }
    } else {
      if (firstPending === -1) firstPending = i;
      if (remote.etag !== obj.baseETag || remote.hash !== obj.baseHash) {
        return {
          kind: 'conflict',
          role: obj.role,
          reason: 'a pending object changed since the draft was grounded',
        };
      }
    }
  }
  if (firstPending === -1) return { kind: 'done' };
  return { kind: 'continue', fromIndex: firstPending };
}

/** New ETags keyed by role from a completed (or completing) journal. */
export function collectNewETags(journal: SyncJournal): Partial<Record<CanonicalRole, string>> {
  const out: Partial<Record<CanonicalRole, string>> = {};
  for (const o of journal.objects) if (o.newETag) out[o.role] = o.newETag;
  return out;
}
