import type { SyncState } from '../store';
import { SYNC_EXPLANATIONS } from '../lib/syncExplanations';
import { useFocusExplanation } from './useFocusExplanation';

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
  const explanation = SYNC_EXPLANATIONS[state];
  const help = useFocusExplanation(explanation);
  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 border border-rule px-2.5 h-7 text-[12px] font-mono text-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        role="status"
        tabIndex={0}
        title={explanation}
        aria-describedby={help.id}
        {...help.triggerProps}
        aria-label={`Sync status: ${p.label}`}
      >
        <span aria-hidden>{p.glyph}</span>
        {p.label}
      </span>
      {help.explanation}
    </>
  );
}
