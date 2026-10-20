import { useId, useState } from 'react';
import type { DraftObservation } from '../lib/db';
import { isGhostObs, reviewStatus, reviewSummary } from '../lib/effective';

// The compact applied-species strip under the SpeciesPanel header. A single
// wrapping line of chips for the focused image — the 99% single-species case is
// just one small chip. ≥2 species collapse to a one-line summary that expands
// (accordion). Editing happens here (count, remove, detag all); ADDING stays the
// job of the dominant SpeciesPanel list. Chips edit the focused image; Clear
// Species follows the view-specific target scope supplied by the workspace.

export type AppliedSpeciesProps = {
  observations: DraftObservation[]; // effective set for the focused image
  disabled: boolean; // no image focused
  onSetCount: (scientificName: string, count: number) => void;
  onRemove: (scientificName: string) => void;
  onDetagAll: () => void;
  // Clear Species is view-scoped: in Focus this is always 1 (the current
  // image); in the Overview with a selection it can be more. These describe
  // what Clear Species is actually about to affect, which may include images
  // beyond the focused one even when the focused image itself has none.
  canDetag: boolean;
  detagCount: number;
  detagSelection: boolean;
};

function labelOf(o: DraftObservation): string {
  return isGhostObs(o) ? 'Ghost' : o.commonName || o.scientificName;
}

function reviewLabel(o: DraftObservation): string | null {
  const reviewEvents = o.reviewEvents ?? [];
  const review = reviewEvents[reviewEvents.length - 1];
  return review ? `Reviewed by ${review.reviewedBy} at ${review.reviewedAt}` : null;
}

function reviewStateLabel(o: DraftObservation): string {
  const reviewEvents = o.reviewEvents ?? [];
  if (!reviewEvents.length) return 'Not reviewed';
  return reviewLabel(o) ?? 'Reviewed';
}

export function AppliedSpecies(props: AppliedSpeciesProps) {
  const [expanded, setExpanded] = useState(false);
  const clearHelpId = useId();
  const obs = props.observations;
  const clearHelp = props.detagSelection
    ? `Remove all species from ${props.detagCount === 1 ? 'this selected image' : `these ${props.detagCount} selected images`}`
    : 'Remove all species from this image';

  // The strip itself still reflects the focused image's own species. Clear
  // Species stays available even when the focused image has none, as long as
  // it would still clear species elsewhere in the current selection.
  if (props.disabled || (obs.length === 0 && !props.canDetag)) return null;

  const multi = obs.length > 1;
  // Collapsed multi-species summary: first chip + "+N more".
  const summary = multi ? `${labelOf(obs[0])}${obs[0].count > 1 ? ` ×${obs[0].count}` : ''}` : '';
  const summaryReview = multi ? reviewSummary(obs) : null;

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {multi && !expanded ? (
        <button
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="min-w-11 min-h-11 inline-flex items-center gap-1.5 text-[12px] border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent px-2 py-1"
          title="Show all applied species"
          aria-label="Show all applied species"
          data-testid="applied-species-summary"
        >
          <span className="text-[20px] leading-none">▸</span>
          <span>{summary}</span>
          <span className="text-inkMute">+{obs.length - 1} more</span>
          {summaryReview && <span className="text-inkMute">· {summaryReview}</span>}
        </button>
      ) : multi ? (
        <button
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="min-w-11 min-h-11 grid place-items-center text-[20px] leading-none text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          title="Collapse applied species"
          aria-label="Collapse applied species"
        >
          ▾
        </button>
      ) : null}
      {(!multi || expanded) ? (
        obs.map((o) => (
          <Chip
            key={o.scientificName}
            obs={o}
            onSetCount={(n) => props.onSetCount(o.scientificName, n)}
            onRemove={() => props.onRemove(o.scientificName)}
          />
        ))
      ) : null}

      {props.canDetag && (
        <span className="inline-flex group">
          <button
            type="button"
            onClick={props.onDetagAll}
            aria-describedby={clearHelpId}
            onKeyDown={(event) => {
              // Native button activation owns these keys instead of Overview's
              // Enter-to-Focus and Space-to-species-filter shortcuts.
              if ((event.key === 'Enter' || event.key === ' ') &&
                  !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) event.stopPropagation();
            }}
            className="min-h-11 inline-flex items-center text-[11px] font-mono text-inkMute hover:text-warn underline decoration-dotted focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Clear Species
          </button>
          <span
            id={clearHelpId}
            role="tooltip"
            className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1 w-56 max-w-[calc(100vw-2rem)] border border-rule bg-panel px-2 py-1 text-[11px] font-mono text-ink shadow-lg group-hover:visible group-focus-within:visible"
          >
            {clearHelp}
          </span>
        </span>
      )}
    </div>
  );
}

function Chip({
  obs,
  onSetCount,
  onRemove,
}: {
  obs: DraftObservation;
  onSetCount: (n: number) => void;
  onRemove: () => void;
}) {
  const ghost = isGhostObs(obs);
  return (
    <span
      className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-[13px] border ${
        ghost ? 'border-rule text-inkSoft' : 'border-ink text-ink'
      }`}
    >
      <span className="truncate max-w-[12rem]">
        {ghost ? '◯ Ghost' : labelOf(obs)}
      </span>
      {obs.classifiedBy && (
        <span className="text-[11px] text-inkMute" aria-label={`Originally identified by ${obs.classifiedBy}`}>
          Originally identified by {obs.classifiedBy}
        </span>
      )}
      <span
        className={`text-[11px] ${reviewStatus(obs) === 'reviewed' ? 'text-inkMute' : 'text-warn'}`}
        aria-label={reviewStateLabel(obs)}
      >
        {reviewStateLabel(obs)}
      </span>
      {obs.requestedSpecies && (
        <span className="font-mono text-inkMute text-[11px]">requested</span>
      )}
      {/* Ghost is exactly one (no count editor). Real species own a per-chip count. */}
      {!ghost && (
        <input
          type="number"
          min={1}
          value={obs.count}
          onChange={(e) => onSetCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-10 bg-paper border border-rule px-1 py-0.5 text-[12px] font-mono text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          aria-label={`Count for ${labelOf(obs)}`}
        />
      )}
      <button
        onClick={onRemove}
        className="min-w-11 min-h-11 md:min-w-0 md:min-h-0 md:w-5 md:h-5 grid place-items-center text-inkMute hover:text-warn focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        title="Remove this species"
        aria-label={`Remove ${labelOf(obs)}`}
      >
        ✕
      </button>
    </span>
  );
}
