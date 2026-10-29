import { db } from './db';
import type { SaveView } from './automaticSaver';

export type BrowseSaveStatus = 'checking' | 'saved' | 'saving' | 'retrying' | 'recheck' | 'retry' | 'conflict' | 'repair' | 'recover';
export const SAVE_STATUS: Record<BrowseSaveStatus, { label: string; help: string }> = {
  checking: { label: 'Checking…', help: 'Checking save status' },
  saved: { label: 'Saved', help: 'All changes are saved. Nothing to do.' },
  saving: { label: 'Saving', help: 'Saving your changes' },
  retrying: { label: 'Retrying', help: 'Saving is retrying now' },
  recheck: { label: 'Recheck', help: 'Save status is unknown. Select to check status again.' },
  retry: { label: 'Retry save', help: 'Changes weren’t saved. Select to try again.' },
  conflict: { label: 'Conflict', help: 'Changes could not be saved because stored data changed. Use Open to review unsaved changes.' },
  repair: { label: 'Repair', help: 'Saving was previously denied. Use Open to resolve the access problem.' },
  recover: { label: 'Recover', help: 'Earlier changes remain unsaved. Use Open to recover them.' },
};

/** Read recovery without adopting, clearing, or attempting any remote write. */
export async function readBrowseSaveStates(bucket: string, scope: string): Promise<Map<string, BrowseSaveStatus>> {
  const states = new Map<string, BrowseSaveStatus>();
  const priority = { retry: 1, recover: 2, repair: 3, conflict: 4 } as const;
  const put = (prefix: string, status: keyof typeof priority) => {
    const previous = states.get(prefix) as keyof typeof priority | undefined;
    if (!previous || priority[status] > priority[previous]) states.set(prefix, status);
  };
  await db.transaction('r', db.drafts, db.uploads, db.automatic, db.syncJournals, async () => {
    const records = await db.automatic.filter(r => r.bucket === bucket).toArray();
    const owned = new Set(records.filter(r => r.scope === scope).map(r => r.uploadPrefix));
    for (const draft of await db.drafts.filter(d => d.bucket === bucket && d.dirty).toArray())
      put(draft.uploadPrefix, owned.has(draft.uploadPrefix) ? 'retry' : 'recover');
    for (const upload of await db.uploads.filter(u => u.bucket === bucket && (u.pendingLocation != null || u.timeOffset != null)).toArray())
      put(upload.uploadPrefix, owned.has(upload.uploadPrefix) ? 'retry' : 'recover');
    for (const journal of await db.syncJournals.filter(j => j.bucket === bucket).toArray())
      put(journal.uploadPrefix, owned.has(journal.uploadPrefix) ? 'retry' : 'recover');
    for (const record of records) {
      const pending = record.actions.length || record.flight || record.adoptionRequired || record.recoveryBranches?.length;
      if (!pending && !record.conflictReason) continue;
      if (record.scope !== scope) { put(record.uploadPrefix, 'recover'); continue; }
      if (record.conflictReason || record.recoveryBranches?.length) put(record.uploadPrefix, 'conflict');
      else if (record.adoptionRequired) put(record.uploadPrefix, 'recover');
      else put(record.uploadPrefix, record.saveFailure === 'repair' ? 'repair' : 'retry');
    }
  });
  // An inactive upload has no running retry coordinator: offer Retry save,
  // rather than claiming that a retry is currently happening.
  return states;
}

type Check = { fetching: boolean; failed: boolean; ready: boolean };
export function browseSaveStatus(local: Check, stored: Check, pending?: BrowseSaveStatus, live?: SaveView, scanStartedAt?: number): BrowseSaveStatus {
  if (live?.setupFailed) return 'recheck';
  if (live?.phase === 'recovery') return 'recover';
  if (live?.phase === 'conflict') return 'conflict';
  if (live && (live.pending || live.phase === 'failed' || live.phase === 'loading')) {
    if (live.phase === 'failed' && (!live.pending || !live.failure)) return pending ?? 'recheck';
    if (live.phase === 'failed') return live.failure === 'repair' ? 'repair' : 'retry';
    if (live.phase === 'pending' || live.retrying) return 'retrying';
    if (live.phase === 'saving') return 'saving';
    return 'checking';
  }
  // A completed active save is newer than a polling scan taken before its receipt.
  if (pending && !(live?.phase === 'saved' && !live.pending && scanStartedAt !== undefined && live.updatedAt !== undefined && scanStartedAt <= live.updatedAt && ['retry', 'repair'].includes(pending))) return pending;
  if (local.fetching || stored.fetching) return 'checking';
  if (local.failed || stored.failed) return 'recheck';
  return local.ready && stored.ready ? 'saved' : 'checking';
}
