export type UploadState =
  | 'ready'
  | 'uploading'
  | 'publishing'
  | 'complete'
  | 'failed'
  | 'dry-run';

// Distinct by shape + glyph, not color alone (design requirement).
const config: Record<UploadState, { label: string; glyph: string; cls: string; description: string }> = {
  ready: { label: 'ready', glyph: '○', cls: 'border-rule text-inkSoft', description: 'No upload in progress' },
  uploading: {
    label: 'uploading…',
    glyph: '↑',
    cls: 'border-accent text-accent',
    description: 'Upload in progress',
  },
  publishing: {
    label: 'publishing…',
    glyph: '⇡',
    cls: 'border-accent text-accent',
    description: 'Publishing upload metadata',
  },
  complete: { label: 'complete', glyph: '●', cls: 'border-ok text-ok', description: 'Upload complete' },
  failed: { label: 'failed', glyph: '✕', cls: 'border-warn text-warn', description: 'Upload failed' },
  'dry-run': {
    label: 'dry-run',
    glyph: '◇',
    cls: 'border-warn text-warn',
    description: 'Dry run — nothing was written',
  },
};

export function StatePill({ state }: { state: UploadState }) {
  const c = config[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[12px] leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${c.cls}`}
      role="status"
      tabIndex={0}
      aria-label={`Upload status: ${c.description}`}
    >
      <span aria-hidden>{c.glyph}</span>
      {c.label}
    </span>
  );
}
