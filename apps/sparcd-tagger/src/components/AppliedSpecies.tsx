import { useId, useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { unfinishedEditor } from '../lib/editorState';
import type { DraftObservation } from '../lib/db';
import { isGhostObs, reviewSummary } from '../lib/effective';

// The compact applied-species strip under the SpeciesPanel header. A single
// wrapping line of chips for the focused image — the 99% single-species case is
// just one small chip. ≥2 species collapse to a one-line summary that expands
// (accordion). Editing happens here (count, remove, detag all); ADDING stays the
// job of the dominant SpeciesPanel list. Chips edit the focused image; Clear
// Species follows the view-specific target scope supplied by the workspace.

export type AppliedSpeciesProps = {
  observations: DraftObservation[]; // effective set for the focused image
  disabled: boolean; // editing is paused; retain unfinished count input
  onSetCount: (scientificName: string, count: number) => void;
  onRemove: (scientificName: string) => void;
  onDetagAll: () => void;
  // Clear Species follows the visible selection, or the focused image when
  // nothing is selected. Chips continue to edit only the focused image.
  canDetag: boolean;
  detagCount: number;
  detagSelection: boolean;
  // Focus skips the summary toggle and shows every applied species in a
  // bounded, scrollable list.
  alwaysExpanded?: boolean;
};

function labelOf(o: DraftObservation): string {
  return isGhostObs(o) ? 'Ghost' : o.commonName || o.scientificName;
}

function reviewLabel(o: DraftObservation): string | null {
  const reviewEvents = (o.reviewEvents ?? []).filter(event => !event.reversedAt);
  const review = reviewEvents[reviewEvents.length - 1];
  return review ? `Reviewed by ${review.reviewedBy} at ${review.reviewedAt}` : null;
}

function ChipList({
  obs,
  disabled,
  onSetCount,
  onRemove,
}: {
  obs: DraftObservation[];
  disabled: boolean;
  onSetCount: AppliedSpeciesProps['onSetCount'];
  onRemove: AppliedSpeciesProps['onRemove'];
}) {
  return (
    <>
      {obs.map((o) => (
        <Chip
          key={o.scientificName}
          obs={o}
          disabled={disabled}
          onSetCount={(n) => onSetCount(o.scientificName, n)}
          onRemove={() => onRemove(o.scientificName)}
        />
      ))}
    </>
  );
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
  if (obs.length === 0 && !props.canDetag) return null;

  const clearControl = props.canDetag ? (
    <span className="inline-flex group">
      <button
        type="button"
        disabled={props.disabled}
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
  ) : null;

  if (props.alwaysExpanded) {
    return (
      <div className="relative flex flex-col gap-1.5 w-full">
        <div
          data-testid="applied-species-list"
          className="flex flex-wrap items-start gap-1.5 max-h-24 overflow-y-auto"
        >
          <ChipList obs={obs} disabled={props.disabled} onSetCount={props.onSetCount} onRemove={props.onRemove} />
        </div>
        {clearControl}
      </div>
    );
  }
  const multi = obs.length > 1;
  // Collapsed multi-species summary: first chip + "+N more".
  const summary = multi ? `${labelOf(obs[0])}${obs[0].count > 1 ? ` ×${obs[0].count}` : ''}` : '';
  const reviewState = multi ? reviewSummary(obs) : null;
  // Species controls show only positive review information. The image-level
  // summary wording is coordinated with #466; an entirely unreviewed set has
  // no review label, and a mixed set is described as partly reviewed.
  const summaryReview = reviewState === 'reviewed'
    ? 'Reviewed'
    : reviewState === 'mixed'
      ? 'Partly reviewed'
      : null;

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {multi && !expanded ? (
        <button
          disabled={props.disabled}
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
          disabled={props.disabled}
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
        <ChipList obs={obs} disabled={props.disabled} onSetCount={props.onSetCount} onRemove={props.onRemove} />
      ) : null}

      {clearControl}
    </div>
  );
}

function Chip({
  obs,
  disabled,
  onSetCount,
  onRemove,
}: {
  obs: DraftObservation;
  disabled: boolean;
  onSetCount: (n: number) => void;
  onRemove: () => void;
}) {
  const ghost = isGhostObs(obs);
  const positiveReview = reviewLabel(obs);
  const automatic = useStore(s => !!s.s3Config);
  const id = useId();
  const [text, setText] = useState(String(obs.count));
  const textRef = useRef(text); textRef.current = text;
  const focused = useRef(false);
  const unfinished = useRef(false);
  useEffect(() => { if (!focused.current && !unfinished.current) setText(String(obs.count)); }, [obs.count]);
  useEffect(() => () => unfinishedEditor(id, false), [id]);
  const finish = (input: HTMLInputElement) => {
    if (disabled) return;
    if (!input.reportValidity()) { queueMicrotask(() => input.focus()); return; }
    const count = Number(textRef.current);
    unfinished.current = false;
    unfinishedEditor(id, false);
    if (count !== obs.count) onSetCount(count);
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-[13px] border ${
        ghost ? 'border-rule text-inkSoft' : 'border-ink text-ink'
      }`}
    >
      <span className="truncate max-w-[12rem]">
        {ghost ? '◯ Ghost' : labelOf(obs)}
      </span>
      {positiveReview && (
        <span className="text-[11px] text-inkMute" aria-label={positiveReview}>
          {positiveReview}
        </span>
      )}
      {obs.requestedSpecies && (
        <span className="font-mono text-inkMute text-[11px]">requested</span>
      )}
      {/* Ghost is exactly one (no count editor). Real species own a per-chip count. */}
      {!ghost && (
        <input
          disabled={disabled}
          type="number"
          min={1}
          required
          step={1}
          value={automatic ? text : obs.count}
          onFocus={() => { focused.current = true; }}
          onChange={(e) => {
            if (!automatic) { onSetCount(Math.max(1, Number(e.target.value) || 1)); return; }
            textRef.current = e.target.value; setText(e.target.value);
            unfinished.current = e.target.value !== String(obs.count);
            unfinishedEditor(id, unfinished.current);
          }}
          onBlur={(e) => { focused.current = false; if (automatic) finish(e.currentTarget); }}
          onKeyDown={(e) => { if (automatic && e.key === 'Enter') { e.preventDefault(); if (e.currentTarget.reportValidity()) e.currentTarget.blur(); } }}
          aria-describedby={automatic ? `${id}-help` : undefined}
          className="w-10 bg-paper border border-rule px-1 py-0.5 text-[12px] font-mono text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          aria-label={`Count for ${labelOf(obs)}`}
        />
      )}
      {automatic && <span id={`${id}-help`} className="sr-only">Enter a whole number of at least one. Finish with Enter or leave this field to save.</span>}
      <button
        disabled={disabled}
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
