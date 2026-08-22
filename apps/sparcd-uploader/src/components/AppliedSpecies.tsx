import { useState } from 'react';
import type { DraftObservation } from '../lib/preTags';
import { isGhostObs } from '../lib/preTags';

export type AppliedSpeciesProps = {
  observations: DraftObservation[];
  disabled: boolean;
  onSetCount: (scientificName: string, count: number) => void;
  onRemove: (scientificName: string) => void;
  onDetagAll: () => void;
};

function labelOf(o: DraftObservation): string {
  return isGhostObs(o) ? 'Ghost' : o.commonName || o.scientificName;
}

export function AppliedSpecies(props: AppliedSpeciesProps) {
  const [expanded, setExpanded] = useState(false);
  const obs = props.observations;

  if (props.disabled || obs.length === 0) return null;

  const multi = obs.length > 1;
  const summary = multi ? `${labelOf(obs[0])}${obs[0].count > 1 ? ` ×${obs[0].count}` : ''}` : '';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {multi && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[20px] leading-none text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          title={expanded ? 'Collapse' : 'Show all applied species'}
          aria-label={expanded ? 'Collapse applied species' : 'Show all applied species'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      )}
      {!expanded && multi ? (
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-[12px] border border-rule text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title="Show all applied species"
        >
          {summary} <span className="text-inkMute">+{obs.length - 1} more</span>
        </button>
      ) : (
        obs.map((o) => (
          <Chip
            key={o.scientificName}
            obs={o}
            onSetCount={(n) => props.onSetCount(o.scientificName, n)}
            onRemove={() => props.onRemove(o.scientificName)}
          />
        ))
      )}

      <button
        onClick={props.onDetagAll}
        className="text-[11px] font-mono text-inkMute hover:text-warn underline decoration-dotted focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        title="Remove all species from this image"
      >
        Detag all
      </button>
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
      <span className="truncate max-w-[12rem]">{ghost ? '◯ Ghost' : labelOf(obs)}</span>
      {obs.requestedSpecies && (
        <span className="font-mono text-inkMute text-[11px]">requested</span>
      )}
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
