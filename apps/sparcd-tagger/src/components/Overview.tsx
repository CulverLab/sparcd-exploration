import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { correctedTimestamp } from '@sparcd/camtrap';
import { Thumb } from './Thumb';
import { ImageStatusBadges } from './ImageStatusBadges';
import { useDraftStore } from '../lib/drafts';
import { useStore } from '../store';
import { formatDateTime, formatTime, type TimeFormat } from '../lib/formatting';
import { effectiveOf, hasSpecies, isEditedFromBase, isGhostObs, reviewSummary } from '../lib/effective';
import { isRangeFullySelected } from '../lib/selection';
import type { Burst, BurstGrouping } from '../lib/bursts';
import { isVideoImage, type TagImage } from '../lib/workspace';
import type { DraftObservation } from '../lib/db';
import type { AppliedTag } from '../lib/drafts';
import { parseSpeciesDrag, SPECIES_DRAG_TYPE } from '../lib/speciesDrag';

/** A one-line label for an image's effective species set: the first species (with
 *  count when >1), plus `+N` when more follow. Ghost reads as "Ghost". */
function summarize(obs: DraftObservation[]): string {
  if (!obs.length) return '';
  const first = obs[0];
  const name = isGhostObs(first) ? 'Ghost' : first.commonName || first.scientificName;
  const head = first.count > 1 ? `${name} ×${first.count}` : name;
  return obs.length > 1 ? `${head} +${obs.length - 1}` : head;
}

function reviewSummaryLabel(observations: DraftObservation[]): string | null {
  const summary = reviewSummary(observations);
  if (!summary) return null;
  if (summary === 'mixed') return 'Mixed review';
  return summary === 'reviewed' ? 'Reviewed' : 'Not reviewed';
}

// The Overview is the primary bulk-tagging surface: a virtualized, burst-banded
// view of an upload in either grid or list form. Only visible cells mount, so a
// 5,000-image upload scrolls smoothly and a selection change re-renders just the
// handful of on-screen cells. Reused at narrow width as the Focus view's side
// strip (always list there).

export type PickMods = { shift: boolean; meta: boolean };
export type ViewKind = 'grid' | 'list';

type OverviewProps = {
  list: TagImage[];
  /** Canonical positions to display. Keeping these positions lets selection and
   * keyboard navigation remain anchored to the unfiltered upload. */
  visibleIndices?: number[];
  grouping: BurstGrouping;
  focus: number;
  selected: Set<number>;
  kind: ViewKind;
  onPick: (i: number, mods: PickMods) => void;
  onSelectBurst: (start: number) => void;
  /** Drill one image into the Focus view (Overview mode only; omit for the strip). */
  onDrill?: (i: number, opener?: HTMLElement) => void;
  /** A spatial drop affects this image only, regardless of selection. */
  onDropSpecies?: (i: number, tag: AppliedTag) => void;
  timeZone?: string;
};

const BAND_H = 30;
const LIST_ROW_H = 56;
const GRID_CARD_H = 158;
const GRID_GAP = 8;
const GRID_CELL_MIN = 150; // target card width; columns derive from container width
// Full list metadata needs room for a useful filename in addition to its fixed
// columns. Below this width, use the same compact row as the Focus strip.
const DETAILED_LIST_MIN_WIDTH = 480;

type FlatItem =
  | { kind: 'band'; burst: Burst }
  | { kind: 'row'; indices: number[] };

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/** Measure a element's content width, tracking resizes (drives grid columns). */
function useElementWidth(ref: React.RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function Overview({
  list,
  visibleIndices,
  grouping,
  focus,
  selected,
  kind,
  onPick,
  onSelectBurst,
  onDrill,
  onDropSpecies,
  timeZone,
}: OverviewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(parentRef);

  const cols =
    kind === 'list' ? 1 : Math.max(1, Math.floor((width + GRID_GAP) / (GRID_CELL_MIN + GRID_GAP)));

  // Flatten bursts → a single array of band/row items the virtualizer indexes.
  // `rowOfImage[i]` maps an image index back to its flat row so keyboard focus
  // can scroll the right row into view.
  const { flat, rowOfImage } = useMemo(() => {
    const items: FlatItem[] = [];
    const rowOf = new Array<number>(list.length);
    if (visibleIndices) {
      for (let offset = 0; offset < visibleIndices.length; offset += cols) {
        const indices = visibleIndices.slice(offset, offset + cols);
        const rowIdx = items.length;
        for (const idx of indices) rowOf[idx] = rowIdx;
        items.push({ kind: 'row', indices });
      }
      return { flat: items, rowOfImage: rowOf };
    }
    for (const b of grouping.bursts) {
      if (grouping.banded) items.push({ kind: 'band', burst: b });
      for (let i = b.start; i <= b.end; i += cols) {
        const indices = range(i, Math.min(i + cols - 1, b.end));
        const rowIdx = items.length;
        for (const idx of indices) rowOf[idx] = rowIdx;
        items.push({ kind: 'row', indices });
      }
    }
    return { flat: items, rowOfImage: rowOf };
  }, [grouping, cols, list.length, visibleIndices]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) =>
      flat[i].kind === 'band' ? BAND_H : kind === 'list' ? LIST_ROW_H : GRID_CARD_H,
    overscan: 8,
  });

  // Keep the keyboard-focused image scrolled into view.
  useEffect(() => {
    const row = rowOfImage[focus];
    if (row != null) virtualizer.scrollToIndex(row, { align: 'auto' });
    // Once the active image moves off the tile that still holds DOM focus, that
    // tile must stop owning Enter / Space / Shift+Space.
    const held = document.activeElement;
    if (held instanceof HTMLElement && held.dataset.imageIndex && Number(held.dataset.imageIndex) !== focus) held.blur();
  }, [focus, rowOfImage, virtualizer]);

  return (
    <div
      ref={parentRef}
      data-testid="overview-scroll"
      className="h-full overflow-y-auto min-h-0 bg-panel"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const item = flat[vi.index];
          const style = {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${vi.start}px)`,
          };
          if (item.kind === 'band') {
            return (
              <div key={`band-${item.burst.id}`} style={{ ...style, height: BAND_H }}>
                <BurstBand
                  burst={item.burst}
                  fullySelected={isRangeFullySelected(item.burst.start, item.burst.end, selected)}
                  onSelect={() => onSelectBurst(item.burst.start)}
                />
              </div>
            );
          }
          return (
            <div
              key={`row-${vi.index}`}
              style={{ ...style, height: kind === 'list' ? LIST_ROW_H : GRID_CARD_H }}
            >
              {kind === 'list' ? (
                <ListCell
                  img={list[item.indices[0]]}
                  index={item.indices[0]}
                  active={item.indices[0] === focus}
                  selected={selected.has(item.indices[0])}
                  onPick={onPick}
                  onDrill={onDrill}
                  onDropSpecies={onDropSpecies}
                  timeZone={timeZone}
                  narrow={width < DETAILED_LIST_MIN_WIDTH}
                />
              ) : (
                <div
                  className="grid gap-2 px-2 h-full"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {item.indices.map((idx) => (
                    <GridCell
                      key={list[idx].key}
                      img={list[idx]}
                      index={idx}
                      active={idx === focus}
                      selected={selected.has(idx)}
                      onPick={onPick}
                      onDrill={onDrill}
                      onDropSpecies={onDropSpecies}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function modsOf(e: React.MouseEvent): PickMods {
  return { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey };
}

// Modifier-clicks are selection gestures, not a request to open Focus.
function plainDrill(
  e: React.MouseEvent<HTMLButtonElement>,
  onDrill: (i: number, opener?: HTMLElement) => void,
  index: number,
): void {
  if (!e.shiftKey && !e.metaKey && !e.ctrlKey) onDrill(index, e.currentTarget);
}

const TOUCH_DOUBLE_TAP_MS = 320;
const TOUCH_DOUBLE_TAP_DISTANCE = 28;
const TOUCH_MOVE_CANCELLATION_DISTANCE = 12;

type TouchTap = { x: number; y: number; at: number };
let previousTouchTap: (TouchTap & { imageKey: string }) | null = null;

/** Recognize two deliberate taps on the same virtualized image cell. A scroll,
 *  pinch, pointer cancellation, or tap on another cell cannot complete a pair. */
function useTouchDoubleTap(
  onDrill: ((index: number, opener?: HTMLElement) => void) | undefined,
  imageKey: string,
) {
  const activeTap = useRef<{ pointerId: number; x: number; y: number; at: number } | null>(null);
  const pendingDrill = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    pendingDrill.current = false;
    if (event.pointerType !== 'touch') {
      previousTouchTap = null;
      activeTap.current = null;
      return;
    }
    if (!event.isPrimary) {
      previousTouchTap = null;
      activeTap.current = null;
      return;
    }
    if (previousTouchTap && previousTouchTap.imageKey !== imageKey) previousTouchTap = null;
    activeTap.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = activeTap.current;
    if (event.pointerType !== 'touch' || !active || active.pointerId !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - active.x, event.clientY - active.y) >
      TOUCH_MOVE_CANCELLATION_DISTANCE
    ) {
      activeTap.current = null;
      previousTouchTap = null;
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = activeTap.current;
    if (event.pointerType !== 'touch' || !active || active.pointerId !== event.pointerId) return;
    activeTap.current = null;
    const now = performance.now();
    if (now - active.at > 250) {
      previousTouchTap = null;
      return;
    }
    const prior = previousTouchTap;
    const closeInTime = prior !== null && now - prior.at <= TOUCH_DOUBLE_TAP_MS;
    const sameImage = prior !== null && prior.imageKey === imageKey;
    const closeInSpace =
      sameImage &&
      Math.hypot(event.clientX - prior.x, event.clientY - prior.y) <= TOUCH_DOUBLE_TAP_DISTANCE;
    if (onDrill && closeInTime && closeInSpace) {
      previousTouchTap = null;
      pendingDrill.current = true;
      return;
    }
    previousTouchTap = { x: event.clientX, y: event.clientY, at: now, imageKey };
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') return;
    activeTap.current = null;
    previousTouchTap = null;
  };

  const takeDoubleTap = () => {
    const pending = pendingDrill.current;
    pendingDrill.current = false;
    return pending;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, takeDoubleTap };
}

function BurstBand({
  burst,
  fullySelected,
  onSelect,
}: {
  burst: Burst;
  fullySelected: boolean;
  onSelect: () => void;
}) {
  const timeFormat = useStore((s) => s.timeFormat);
  return (
    <div
      className={`flex items-center gap-2 px-3 h-full border-b border-rule ${
        fullySelected ? 'bg-mark' : 'bg-paperHover'
      }`}
    >
      <span className="text-[11px] font-mono text-inkSoft truncate">
        Burst {burst.id + 1} · {burst.size} img · {burstSpan(burst, timeFormat)}
      </span>
      <button
        onClick={onSelect}
        className="ml-auto text-[11px] font-mono text-inkMute hover:text-accent underline decoration-dotted focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent [@media(hover:none)]:inline-flex [@media(hover:none)]:items-center [@media(hover:none)]:justify-center [@media(hover:none)]:min-h-11 [@media(hover:none)]:min-w-11 [@media(hover:none)]:px-3 [@media(hover:none)]:no-underline [@media(hover:none)]:border [@media(hover:none)]:border-rule [@media(hover:none)]:text-accent"
        title="Select this burst (⌘/Ctrl+A on the current burst)"
      >
        select
      </button>
    </div>
  );
}

// Each cell subscribes only to its own draft, so tagging one image never
// re-renders its neighbours (on top of virtualization already bounding the count).
// narrow=true collapses type/timestamp for compact Overview rows and the Focus strip.
function ListCell({
  img,
  index,
  active,
  selected,
  onPick,
  onDrill,
  onDropSpecies,
  narrow,
  timeZone,
}: {
  img: TagImage;
  index: number;
  active: boolean;
  selected: boolean;
  onPick: (i: number, mods: PickMods) => void;
  onDrill?: (i: number, opener?: HTMLElement) => void;
  onDropSpecies?: (i: number, tag: AppliedTag) => void;
  narrow?: boolean;
  timeZone?: string;
}) {
  const draft = useDraftStore((s) => s.drafts[img.key]);
  const timeOffset = useDraftStore((s) => s.timeOffset);
  const dateFormat = useStore((s) => s.dateFormat);
  const timeFormat = useStore((s) => s.timeFormat);
  const eff = effectiveOf(img, draft);
  const isVideo = isVideoImage(img);
  const species = summarize(eff.observations) || 'untagged';
  const timestamp = correctedTimestamp(img.baseTimestamp, timeOffset, draft?.timeOverride ?? null, timeZone);
  const timestampDisplay = timestamp ? formatDateTime(timestamp, dateFormat, timeFormat) : null;
  const edited = isEditedFromBase(eff);
  const reviewLabel = reviewSummaryLabel(eff.observations);
  const touchTap = useTouchDoubleTap(onDrill, img.key);
  const statusLabels = [
    ...(hasSpecies(eff) ? ['Has species — one or more species, or an explicit no-species classification'] : []),
    ...(eff.questionable ? ['Needs expert opinion'] : []),
  ];
  const rowLabel = [
    `Filename: ${img.fileName}`,
    ...(!narrow
      ? [`Media type: ${isVideo ? 'video' : 'image'}`, timestamp ? `Capture time: ${timestamp}` : 'Capture time unavailable']
      : []),
    `Species: ${species}`,
    ...(reviewLabel ? [`Review status: ${reviewLabel}`] : []),
    ...(edited ? ['Unsaved edit'] : []),
    ...statusLabels,
  ].join('; ');
  return (
    <button
      {...speciesDropProps(index, onDropSpecies)}
      data-testid="overview-image"
      data-image-index={index}
      data-image-name={img.fileName}
      onPointerDown={touchTap.onPointerDown}
      onPointerMove={touchTap.onPointerMove}
      onPointerUp={touchTap.onPointerUp}
      onPointerCancel={touchTap.onPointerCancel}
      onClick={(e) => {
        if (touchTap.takeDoubleTap()) {
          onDrill?.(index, e.currentTarget);
          return;
        }
        if (e.detail > 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey) return;
        if (onDrill && e.detail === 0) {
          onDrill(index, e.currentTarget);
          return;
        }
        onPick(index, modsOf(e));
      }}
      onDoubleClick={onDrill ? (e) => plainDrill(e, onDrill, index) : undefined}
      aria-current={active ? 'true' : undefined}
      aria-pressed={selected}
      aria-label={rowLabel}
      className={`touch-manipulation w-full h-full flex items-center gap-2 px-2.5 overflow-hidden text-left border-b border-ruleSoft border-l-2 ${
        selected
          ? 'border-l-accent bg-mark'
          : active
            ? 'border-l-transparent bg-mark'
            : 'border-l-transparent hover:bg-panelHover'
      }`}
    >
      <span data-testid="image-thumbnail" className="relative w-12 shrink-0">
        <Thumb
          objectKey={img.key}
          alt={img.fileName}
          isVideo={isVideo}
        />
      </span>
      <span
        data-column="filename"
        aria-label={`Filename: ${img.fileName}`}
        title={img.fileName}
        className="min-w-0 flex-1 flex items-center gap-1"
      >
        <span className="min-w-0 font-mono text-[12px] text-inkSoft truncate">
          {img.fileName}
        </span>
        <ImageStatusBadges hasSpecies={hasSpecies(eff)} questionable={eff.questionable} presentation="list" ariaHidden />
      </span>
      {!narrow && (
        <span
          data-column="media-type"
          aria-label={`Media type: ${isVideo ? 'video' : 'image'}`}
          className="w-7 shrink-0 flex justify-center"
        >
          <span className="bg-paperHover border border-rule text-inkSoft font-mono text-[9px] px-0.5 leading-tight">
            {isVideo ? 'VID' : 'IMG'}
          </span>
        </span>
      )}
      {!narrow && (
        <span
          data-column="timestamp"
          aria-label={timestamp ? `Capture time: ${timestamp}` : 'Capture time unavailable'}
          title={timestamp || 'No capture timestamp'}
          className="w-32 shrink-0 whitespace-nowrap font-mono text-[11px] text-inkSoft leading-tight"
        >
          {timestampDisplay ? (
            timestampDisplay
          ) : (
            <span className="text-inkMute">—</span>
          )}
        </span>
      )}
      <span
        data-column="species"
        aria-label={`Species: ${species}`}
        title={species}
        className={`${narrow ? 'w-20' : 'w-24'} shrink-0 text-[12px] truncate ${
          eff.observations.length ? 'text-ink' : 'text-inkMute'
        }`}
      >
        {species}
      </span>
      {reviewLabel && (
        <span
          data-column="review-status"
          aria-label={`Review status: ${reviewLabel}`}
          title={`Review status: ${reviewLabel}`}
          className="w-20 shrink-0 text-[10px] font-mono text-inkMute truncate"
        >
          {reviewLabel}
        </span>
      )}
      <span data-column="markers" className="shrink-0 flex items-center gap-1">
        {edited && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent"
            title="unsaved edit"
            aria-label="Unsaved edit"
          />
        )}
      </span>
    </button>
  );
}

function GridCell({
  img,
  index,
  active,
  selected,
  onPick,
  onDrill,
  onDropSpecies,
}: {
  img: TagImage;
  index: number;
  active: boolean;
  selected: boolean;
  onPick: (i: number, mods: PickMods) => void;
  onDrill?: (i: number, opener?: HTMLElement) => void;
  onDropSpecies?: (i: number, tag: AppliedTag) => void;
}) {
  const draft = useDraftStore((s) => s.drafts[img.key]);
  const eff = effectiveOf(img, draft);
  const isVideo = isVideoImage(img);
  const reviewLabel = reviewSummaryLabel(eff.observations);
  const species = summarize(eff.observations) || 'untagged';
  const touchTap = useTouchDoubleTap(onDrill, img.key);
  const statusLabels = [
    ...(hasSpecies(eff) ? ['Has species — one or more species, or an explicit no-species classification'] : []),
    ...(eff.questionable ? ['Needs expert opinion'] : []),
  ];
  const tileLabel = [
    `Filename: ${img.fileName}`,
    `Media type: ${isVideo ? 'video' : 'image'}`,
    `Species: ${species}`,
    ...(reviewLabel ? [`Review status: ${reviewLabel}`] : []),
    ...statusLabels,
  ].join('; ');
  return (
    <button
      {...speciesDropProps(index, onDropSpecies)}
      data-testid="overview-image"
      data-image-index={index}
      data-image-name={img.fileName}
      onPointerDown={touchTap.onPointerDown}
      onPointerMove={touchTap.onPointerMove}
      onPointerUp={touchTap.onPointerUp}
      onPointerCancel={touchTap.onPointerCancel}
      onClick={(e) => {
        if (touchTap.takeDoubleTap()) {
          onDrill?.(index, e.currentTarget);
          return;
        }
        if (e.detail > 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey) return;
        if (onDrill && e.detail === 0) {
          onDrill(index, e.currentTarget);
          return;
        }
        onPick(index, modsOf(e));
      }}
      onDoubleClick={onDrill ? (e) => plainDrill(e, onDrill, index) : undefined}
      aria-current={active ? 'true' : undefined}
      aria-pressed={selected}
      aria-label={tileLabel}
      title={img.fileName}
      className={`group relative flex flex-col text-left border p-1 touch-manipulation ${
        selected
          ? 'border-accent ring-2 ring-inset ring-accent bg-mark'
          : active
            ? 'border-ink bg-mark'
            : 'border-rule hover:bg-panelHover'
      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2`}
    >
      <span data-testid="grid-image" className="relative block flex-1 min-h-0">
        <Thumb
          objectKey={img.key}
          alt={img.fileName}
          isVideo={isVideo}
        />
        {isVideo && (
          <span className="absolute bottom-1 left-1 bg-paperHover border border-rule text-inkSoft font-mono text-[10px] px-1 leading-tight">
            VIDEO
          </span>
        )}
        <span className="pointer-events-none absolute top-0 left-0 w-full aspect-[4/3]">
          <ImageStatusBadges hasSpecies={hasSpecies(eff)} questionable={eff.questionable} ariaHidden />
        </span>
      </span>
      <span className="mt-1 flex items-center gap-1">
        {isEditedFromBase(eff) && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="unsaved edit" />
        )}
        <span className="block text-[11px] truncate">
          {eff.observations.length ? (
            <span className="text-ink">{summarize(eff.observations)}</span>
          ) : (
            <span className="text-inkMute font-mono">{img.fileName}</span>
          )}
        </span>
        {reviewLabel && (
          <span
            data-column="review-status"
            aria-label={`Review status: ${reviewLabel}`}
            title={`Review status: ${reviewLabel}`}
            className="shrink-0 text-[9px] font-mono text-inkMute"
          >
            {reviewLabel}
          </span>
        )}
      </span>
    </button>
  );
}

function speciesDropProps(index: number, onDropSpecies?: (i: number, tag: AppliedTag) => void) {
  if (!onDropSpecies) return {};
  return {
    onDragOver: (e: React.DragEvent<HTMLButtonElement>) => {
      if (!e.dataTransfer.types.includes(SPECIES_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDrop: (e: React.DragEvent<HTMLButtonElement>) => {
      const tag = parseSpeciesDrag(e.dataTransfer.getData(SPECIES_DRAG_TYPE));
      if (!tag) return;
      e.preventDefault();
      e.stopPropagation();
      onDropSpecies(index, tag);
    },
  };
}

function burstSpan(b: Burst, timeFormat: TimeFormat): string {
  const t = (iso: string) => (iso ? formatTime(iso, timeFormat) : '—');
  return b.startTs === b.endTs ? t(b.startTs) : `${t(b.startTs)}–${t(b.endTs)}`;
}
