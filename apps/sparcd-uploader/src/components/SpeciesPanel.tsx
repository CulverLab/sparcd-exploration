import { useMemo, type ReactNode, type RefObject } from 'react';
import Fuse from 'fuse.js';
import type { Species } from '../lib/species';
import type { AppliedTag } from '../lib/preTags';

export type SpeciesPanelProps = {
  species: Species[];
  onApply: (tag: AppliedTag) => void;
  filter: string;
  onFilterChange: (v: string) => void;
  filterRef: RefObject<HTMLInputElement>;
  bindingFor: (scientificName: string) => string | null;
  capturingFor: string | null;
  onStartCapture: (scientificName: string) => void;
  onClearKey: (scientificName: string) => void;
  appliedSet: Set<string>;
  hasFocus: boolean;
  selectionCount: number;
  disabled: boolean;
  headerSlot?: ReactNode;
  onZoom?: (species: Species) => void;
};

export function SpeciesPanel(props: SpeciesPanelProps) {
  const { species, filter } = props;

  const fuse = useMemo(
    () =>
      new Fuse(species, {
        keys: ['commonName', 'scientificName'],
        threshold: 0.34,
        ignoreLocation: true,
      }),
    [species],
  );

  const ordered = useMemo(
    () => (filter.trim() ? fuse.search(filter.trim()).map((r) => r.item) : species),
    [species, filter, fuse],
  );

  const trimmed = filter.trim();
  const exact = species.some(
    (s) =>
      s.commonName.toLowerCase() === trimmed.toLowerCase() ||
      s.scientificName.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <div className="h-full flex flex-col border-l border-rule bg-panel min-h-0">
      {props.selectionCount > 1 && (
        <div className="px-3 py-1.5 bg-mark border-b border-rule text-[12px] font-mono text-accent">
          Applying to {props.selectionCount} selected images
        </div>
      )}
      <div className="p-3 border-b border-rule space-y-3">
        <input
          ref={props.filterRef}
          value={filter}
          onChange={(e) => props.onFilterChange(e.target.value)}
          placeholder="Filter species…"
          className="w-full bg-paper border border-rule px-3 py-2 text-[14px] font-body text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          autoComplete="off"
          spellCheck={false}
          aria-label="Filter species"
        />
        {props.headerSlot}
        {props.hasFocus && props.appliedSet.size > 0 && (
          <p className="text-[11px] font-body tracking-[0.12em] uppercase text-inkSoft">Add another</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {ordered.map((s) => (
          <Row
            key={s.key}
            iconUrl={s.iconUrl}
            common={s.commonName}
            scientific={s.scientificName}
            badge={props.bindingFor(s.scientificName) ?? s.keyBinding}
            capturing={props.capturingFor === s.scientificName}
            applied={props.appliedSet.has(s.scientificName)}
            disabled={props.disabled}
            dragPayload={{ scientificName: s.scientificName, commonName: s.commonName }}
            onApply={() => props.onApply({ scientificName: s.scientificName, commonName: s.commonName, count: 1 })}
            onStartCapture={() => props.onStartCapture(s.scientificName)}
            onClearKey={props.bindingFor(s.scientificName) ? () => props.onClearKey(s.scientificName) : undefined}
            onZoom={props.onZoom ? () => props.onZoom!(s) : undefined}
          />
        ))}

        {trimmed && !exact && (
          <Row
            chip="✛ Request"
            common="Tag as requested species"
            scientific={`"${trimmed}" → [REQUESTED_SPECIES]`}
            disabled={props.disabled}
            onApply={() =>
              props.onApply({ scientificName: trimmed, commonName: '', count: 1, requestedSpecies: trimmed })
            }
          />
        )}

        {!ordered.length && !trimmed && (
          <p className="p-4 text-[13px] text-inkMute font-body">No species in the vocabulary.</p>
        )}
      </div>
    </div>
  );
}

type RowProps = {
  iconUrl?: string;
  chip?: string;
  common: string;
  scientific: string;
  badge?: string | null;
  capturing?: boolean;
  applied?: boolean;
  disabled: boolean;
  dragPayload?: { scientificName: string; commonName: string };
  onApply: () => void;
  onStartCapture?: () => void;
  onClearKey?: () => void;
  onZoom?: () => void;
};

function Row(p: RowProps) {
  return (
    <div
      className={`group relative flex items-center gap-3 px-3 py-2 border-b border-ruleSoft ${
        p.applied ? 'bg-mark' : 'hover:bg-panelHover'
      }`}
    >
      {p.iconUrl && p.onZoom && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            p.onZoom!();
          }}
          className="absolute top-2 left-3 min-w-11 min-h-11 md:min-w-0 md:min-h-0 md:w-4 md:h-4 grid place-items-center bg-ink/55 text-paper text-[10px] font-mono opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          title="Enlarge reference"
          aria-label={`Enlarge ${p.common} reference image`}
        >
          ⊕
        </button>
      )}
      <button
        onClick={p.onApply}
        disabled={p.disabled}
        draggable={!p.disabled && !!p.dragPayload}
        onDragStart={p.dragPayload && !p.disabled ? (e) => {
          e.dataTransfer.setData('application/x-species', JSON.stringify(p.dragPayload));
          e.dataTransfer.effectAllowed = 'copy';
        } : undefined}
        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2"
        title={p.disabled ? 'Focus an image first' : p.applied ? `${p.common} already applied` : `Apply ${p.common}`}
      >
        {p.iconUrl ? (
          <img
            src={p.iconUrl}
            alt=""
            loading="lazy"
            className="w-10 h-10 object-cover border border-rule bg-paperHover shrink-0"
          />
        ) : (
          <span className="w-10 h-10 grid place-items-center border border-rule bg-paperHover text-[10px] font-mono text-inkMute shrink-0">
            {p.chip ?? '—'}
          </span>
        )}
        <span className="min-w-0">
          <span className="block text-[14px] text-ink truncate">{p.common}</span>
          <span className="block text-[12px] text-inkMute font-mono italic truncate">{p.scientific}</span>
        </span>
        {p.applied && (
          <span className="ml-auto text-accent text-[13px] font-mono shrink-0" title="Applied" aria-label="Applied">
            ✓
          </span>
        )}
      </button>

      <div className="flex items-center gap-1.5 shrink-0">
        {p.capturing ? (
          <span className="text-[11px] font-mono text-accent animate-pulse">press a key…</span>
        ) : (
          <>
            {p.onStartCapture && (
              <button
                onClick={p.onStartCapture}
                className="inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus:opacity-100 text-[11px] font-mono text-inkSoft hover:text-ink underline decoration-dotted focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                title="Assign a key to this species"
              >
                {p.badge ? 'rebind' : 'assign key'}
              </button>
            )}
            {p.onClearKey && (
              <button
                onClick={p.onClearKey}
                className="inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus:opacity-100 text-[11px] font-mono text-inkMute hover:text-warn"
                title="Clear this key"
                aria-label={`Clear key for ${p.common}`}
              >
                ✕
              </button>
            )}
            {p.badge && (
              <kbd className="px-1.5 h-5 min-w-5 grid place-items-center border border-ink text-[11px] font-mono uppercase text-ink">
                {p.badge}
              </kbd>
            )}
          </>
        )}
      </div>
    </div>
  );
}
