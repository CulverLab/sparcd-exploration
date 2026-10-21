import type { SyncState } from '../store';

// Explain the existing states without promising that every local draft was
// written: a successful sync can intentionally leave questionable-only edits.
export const SYNC_EXPLANATIONS: Record<SyncState, string> = {
  'local-only': 'Not yet synced — edits stay in this browser until you sync',
  unsynced: "This upload has edits that haven't been synced to the collection yet",
  syncing: 'Sync in progress',
  synced: 'The last sync completed',
  conflict: 'The collection changed elsewhere since your last sync — resolve this before syncing again',
  'dry-run': 'Previewed what a sync would write, without writing anything',
  error: 'The last sync attempt failed',
};
