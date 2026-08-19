import type { SyncState } from '../store';

// Distinct by shape + glyph, not color alone (design-prompt requirement). P0 is
// read-only so the live value is `local-only`; the full set is wired now so P4
// only has to flip the store value.
const PILLS: Record<SyncState, { label: string; glyph: string }> = {
  'local-only': { label: 'local-only', glyph: '○' },
  unsynced: { label: 'unsynced edits', glyph: '◔' },
  syncing: { label: 'syncing…', glyph: '◐' },
  synced: { label: 'synced', glyph: '●' },
  conflict: { label: 'conflict', glyph: '▲' },
  'dry-run': { label: 'dry-run', glyph: '◇' },
  error: { label: 'error', glyph: '✕' },
};

export function StatePill({ state }: { state: SyncState }) {
  const p = PILLS[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 border border-rule px-2.5 h-7 text-[12px] font-mono text-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      tabIndex={0}
      title="Current sync status"
      aria-label={`Sync status: ${p.label}`}
    >
      <span aria-hidden>{p.glyph}</span>
      {p.label}
    </span>
  );
}
