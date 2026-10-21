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
  const badgeSize = inline ? 'w-5 h-5' : presentation === 'grid'
    ? 'w-1/4 aspect-square' : 'w-[clamp(28px,4vw,56px)] aspect-square max-w-[12%] max-h-[20%]';
  return (
    <span aria-hidden={ariaHidden || undefined} className={`pointer-events-none ${inline ? 'inline-flex shrink-0 items-center gap-1' : 'absolute inset-0'} ${className}`}>
      {hasSpecies && (
        <span
          data-testid="classification-checkmark"
          role="img"
          aria-label="Has species — one or more species, or an explicit no-species classification"
          title="Has species — one or more species, or an explicit no-species classification"
          className={`inline-flex items-center justify-center shrink-0 text-ok ${badgeSize} ${inline ? '' : 'absolute top-1 left-1'}`}
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
          data-testid="need-expert-badge"
          role="img"
          aria-label="Needs expert opinion"
          title="Needs expert opinion"
          className={`inline-flex items-center justify-center shrink-0 text-[#b8860b] dark:text-[#e7b84a] ${badgeSize} ${inline ? '' : 'absolute top-1 right-[var(--expert-badge-inset,0.25rem)]'}`}
        >
          <svg aria-hidden viewBox="0 0 32 32" fill="none" className="w-full h-full" strokeLinecap="round" strokeLinejoin="round">
            {[
              { stroke: '#241c08', width: 6 },
              { stroke: 'white', width: 4.5 },
              { stroke: 'currentColor', width: 2.5 },
            ].map(({ stroke, width }) => <path key={stroke}
              d="M28 16a12 12 0 1 1-24 0a12 12 0 1 1 24 0M12 12a4 4 0 0 1 8 0c0 3-4 3-4 6M16 23h.01"
              stroke={stroke} strokeWidth={width} />)}
          </svg>
        </span>
      )}
    </span>
  );
}
