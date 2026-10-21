// Grid/list names already describe these statuses. Focus exposes the glyphs'
// descriptions directly; neither presentation adds keyboard stops or hit areas.
export function ImageStatusBadges({
  hasSpecies,
  questionable,
  presentation = 'grid',
  className = '',
  ariaHidden = false,
}: {
  hasSpecies: boolean;
  questionable: boolean;
  presentation?: 'grid' | 'list' | 'focus';
  className?: string;
  ariaHidden?: boolean;
}) {
  if (!hasSpecies && !questionable) return null;
  const inline = presentation === 'list';
  // Thumbnails are 4:3: a quarter of their width is a third of the short side.
  const checkSize = inline ? 'w-5 h-5' : presentation === 'grid'
    ? 'w-1/4 aspect-square' : 'w-[clamp(28px,4vw,56px)] aspect-square max-w-[12%] max-h-[20%]';
  return (
    <span aria-hidden={ariaHidden || undefined} className={`pointer-events-none ${inline ? 'inline-flex shrink-0 items-center gap-1' : 'absolute inset-0'} ${className}`}>
      {hasSpecies && (
        <span
          data-testid="classification-checkmark"
          role="img"
          aria-label="Has species — one or more species, or an explicit no-species classification"
          title="Has species — one or more species, or an explicit no-species classification"
          className={`inline-flex items-center justify-center shrink-0 text-ok ${checkSize} ${inline ? '' : 'absolute top-1 left-1'}`}
        >
          <svg aria-hidden viewBox="0 0 32 32" fill="none" className="w-full h-full" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 16 7 7L26 8" stroke="#172018" strokeWidth="9" />
            <path d="m6 16 7 7L26 8" stroke="white" strokeWidth="7" />
            <path d="m6 16 7 7L26 8" stroke="currentColor" strokeWidth="4" />
          </svg>
        </span>
      )}
      {questionable && (
        <span
          role="img"
          aria-label="Questionable"
          title="questionable"
          className={`inline-flex items-center justify-center shrink-0 w-5 h-5 text-[11px] border border-warn bg-panel/90 text-warn font-mono leading-none shadow-sm ${inline ? '' : 'absolute top-1 right-1'}`}
        >
          <span aria-hidden>?</span>
        </span>
      )}
    </span>
  );
}
