// Overlay badges for an image's classification state. Not a tab stop: dozens
// of these can be on screen at once in Overview, and the container each one
// sits in either already carries an equivalent accessible name (list rows) or
// has none at all (grid cells, Focus) — a focusable role here would just add
// keyboard stops without surfacing anything a screen-reader user doesn't
// already get from this span's own aria-label.
export function ImageStatusBadges({
  hasSpecies,
  questionable,
  size = 'md',
  className = '',
  ariaHidden = false,
}: {
  hasSpecies: boolean;
  questionable: boolean;
  size?: 'sm' | 'md';
  className?: string;
  ariaHidden?: boolean;
}) {
  if (!hasSpecies && !questionable) return null;
  const box = size === 'sm' ? 'w-4 h-4 text-[10px]' : 'w-5 h-5 text-[11px]';
  return (
    <span aria-hidden={ariaHidden || undefined} className={`inline-flex items-center gap-1 ${className}`}>
      {hasSpecies && (
        <span
          role="img"
          aria-label="Has species — one or more species, or an explicit no-species classification"
          title="Has species — one or more species, or an explicit no-species classification"
          className={`inline-flex items-center justify-center shrink-0 ${box} border border-ink bg-panel/90 text-ink font-mono leading-none shadow-sm`}
        >
          <span aria-hidden>✓</span>
        </span>
      )}
      {questionable && (
        <span
          role="img"
          aria-label="Questionable"
          title="questionable"
          className={`inline-flex items-center justify-center shrink-0 ${box} border border-warn bg-panel/90 text-warn font-mono leading-none shadow-sm`}
        >
          <span aria-hidden>?</span>
        </span>
      )}
    </span>
  );
}
