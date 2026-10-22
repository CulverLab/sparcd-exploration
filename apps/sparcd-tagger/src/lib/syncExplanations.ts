import type { SyncState } from '../store';

// Legacy state keys remain compatible with stored upload summaries.
export const SYNC_EXPLANATIONS: Record<SyncState, string> = {
  'local-only': 'Stored collection data; no pending edits in this browser',
  unsynced: 'This upload has pending changes awaiting automatic saving',
  syncing: 'Saving changes to storage',
  synced: 'All required writes to storage completed',
  conflict: 'Stored data changed elsewhere. Review retained changes before continuing.',
  'dry-run': 'A legacy preview did not change stored data',
  error: 'Saving failed. Pending work is retained for retry.',
};
