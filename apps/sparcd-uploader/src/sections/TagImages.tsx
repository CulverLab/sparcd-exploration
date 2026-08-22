import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useStore } from '../store';
import { useSpecies } from '../lib/useSpecies';
import { useKeyBindings } from '../lib/useKeyBindings';
import { SpeciesPanel } from '../components/SpeciesPanel';
import { AppliedSpecies } from '../components/AppliedSpecies';
import { ImageAdjustments } from '../components/ImageAdjustments';
import { cssFilter, NEUTRAL, type Adjustments } from '../lib/adjustments';

const CTRL_BTN =
  'flex items-center justify-center font-mono border border-rule text-inkSoft hover:text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

// Returns the pixel size the image will render at inside a container of cw×ch.
function fitBounds(cw: number, ch: number, iw: number, ih: number): { w: number; h: number } | null {
  if (!cw || !ch || !iw || !ih) return null;
  const scale = Math.min(cw / iw, ch / ih);
  return { w: Math.round(iw * scale), h: Math.round(ih * scale) };
}

// ─── Image pane ──────────────────────────────────────────────────────────────
// Renders the focus image with zoom/pan, adjustment controls, prev/next, and
// an optional expand button.  All controls are positioned relative to a wrapper
// div that is sized to the rendered image bounds — so they always sit over the
// image regardless of the container's aspect ratio.

interface ImagePaneProps {
  url: string;
  alt: string;
  adjustments: Adjustments;
  onAdjust: (a: Adjustments) => void;
  onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  bounds: { w: number; h: number } | null;   // rendered image pixel size
  containerDims: { w: number; h: number };
  transformRef: React.RefObject<ReactZoomPanPinchRef>;
  focusedId: string | null;
  hovered: boolean;
  onHoverChange: (v: boolean) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onExpand?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  ctrlBg: string;
  zoomBtnSize: string;     // e.g. "w-7 h-7 text-[16px]"
  navBtnSize: string;      // e.g. "w-11 h-14 text-[28px] font-bold"
  fileName?: string;
}

function ImagePane({
  url, alt, adjustments, onAdjust, onLoad,
  bounds, containerDims,
  transformRef, focusedId,
  hovered, onHoverChange,
  hasPrev, hasNext, onPrev, onNext, onExpand,
  onDrop, onDragOver,
  ctrlBg,
  zoomBtnSize, navBtnSize,
  fileName,
}: ImagePaneProps) {
  const dimStyle: React.CSSProperties = bounds
    ? { position: 'relative', width: bounds.w, height: bounds.h, overflow: 'hidden' }
    : {
        position: 'relative',
        maxWidth: containerDims.w || undefined,
        maxHeight: containerDims.h || undefined,
        overflow: 'hidden',
      };

  return (
    <div
      className="relative flex-1 min-w-0 min-h-0 flex items-center justify-center bg-paperHover overflow-hidden"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {/* Inner wrapper — exactly the rendered image size so controls sit on the image */}
      <div style={dimStyle}>
        <TransformWrapper ref={transformRef} key={focusedId ?? 'none'}>
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={bounds ? { width: '100%', height: '100%' } : undefined}
              >
                <img
                  src={url}
                  alt={alt}
                  className={bounds ? 'w-full h-full' : 'max-w-full max-h-full'}
                  style={{ filter: cssFilter(adjustments), display: 'block' }}
                  onLoad={onLoad}
                />
              </TransformComponent>

              {/* Zoom controls — top-right of image */}
              <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
                <button type="button" onClick={() => zoomIn()}
                  className={`${zoomBtnSize} ${CTRL_BTN} ${ctrlBg}`}
                  title="Zoom in" aria-label="Zoom in">+</button>
                <button type="button" onClick={() => zoomOut()}
                  className={`${zoomBtnSize} ${CTRL_BTN} ${ctrlBg}`}
                  title="Zoom out" aria-label="Zoom out">−</button>
                <button type="button" onClick={() => resetTransform()}
                  className={`${zoomBtnSize.replace(/text-\S+/, 'text-[11px]')} ${CTRL_BTN} ${ctrlBg}`}
                  title="Reset zoom" aria-label="Reset zoom">1:1</button>
              </div>

              {/* Expand — top-left of image */}
              {onExpand && (
                <button type="button" onClick={onExpand}
                  className={`absolute top-2 left-2 z-10 ${zoomBtnSize.split(' ').slice(0, 2).join(' ')} text-[13px] ${CTRL_BTN} ${ctrlBg}`}
                  title="Open full screen" aria-label="Open full screen">⛶</button>
              )}

              {/* Adjust — bottom-left of image */}
              <div className="absolute bottom-2 left-2 z-10">
                <ImageAdjustments
                  key={focusedId ?? 'none'}
                  value={adjustments}
                  onChange={onAdjust}
                  onReset={() => onAdjust(NEUTRAL)}
                  containerHovered={hovered}
                />
              </div>
            </>
          )}
        </TransformWrapper>
      </div>

      {/* Prev / Next — sit at the outer edges of the image container */}
      {hasPrev && (
        <button type="button" onClick={onPrev}
          className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 ${navBtnSize} ${CTRL_BTN} ${ctrlBg}`}
          title="Previous image (←)" aria-label="Previous image">‹</button>
      )}
      {hasNext && (
        <button type="button" onClick={onNext}
          className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 ${navBtnSize} ${CTRL_BTN} ${ctrlBg}`}
          title="Next image (→)" aria-label="Next image">›</button>
      )}

      {/* Filename label */}
      {fileName && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 bg-gray-200/40 font-body text-[12px] text-inkSoft truncate max-w-[60%]">
          {fileName}
        </div>
      )}
    </div>
  );
}

// ─── TagImages ────────────────────────────────────────────────────────────────

export function TagImages() {
  const s3Config = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const files = useStore((s) => s.files);
  const preTags = useStore((s) => s.preTags);
  const addPreTag = useStore((s) => s.addPreTag);
  const removePreTag = useStore((s) => s.removePreTag);
  const setPreTagCount = useStore((s) => s.setPreTagCount);
  const clearFileTags = useStore((s) => s.clearFileTags);
  const setStep = useStore((s) => s.setStep);
  const goBack = useStore((s) => s.goBack);

  const { data: speciesData } = useSpecies(s3Config, connectionId);
  const species = speciesData?.species ?? [];
  const { bindingFor, setBinding, clearBinding } = useKeyBindings(species);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [capturingFor, setCapturingFor] = useState<string | null>(null);

  // Blur whatever the browser focused on step entry (typically the filter input
  // after the Continue button is removed) so the first keypress goes to the
  // global key handler, not the filter.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  useEffect(() => {
    if (files.length > 0 && focusedId === null) {
      const id = files[0].id;
      setFocusedId(id);
      setSelected(new Set([id]));
    }
  }, [files, focusedId]);

  const thumbMap = useRef<Map<string, string>>(new Map());
  const fullMap = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const tm = thumbMap.current;
    const fm = fullMap.current;
    for (const f of files) {
      if (!tm.has(f.id)) tm.set(f.id, URL.createObjectURL(f.thumbnail ?? f.file));
      if (!fm.has(f.id)) fm.set(f.id, URL.createObjectURL(f.file));
    }
    return () => {
      for (const url of tm.values()) URL.revokeObjectURL(url);
      for (const url of fm.values()) URL.revokeObjectURL(url);
      tm.clear();
      fm.clear();
    };
  }, [files]);

  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [modalFilter, setModalFilter] = useState('');
  const modalFilterRef = useRef<HTMLInputElement>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>(NEUTRAL);
  const [imageHovered, setImageHovered] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImageHovered, setModalImageHovered] = useState(false);
  const ctrlBg = imageHovered ? 'bg-gray-200/40' : 'bg-transparent';
  const modalCtrlBg = modalImageHovered ? 'bg-gray-200/40' : 'bg-transparent';

  // Container sizes tracked by ResizeObserver so the image can be constrained.
  const focusViewRef = useRef<HTMLDivElement>(null);
  const focusTransformRef = useRef<ReactZoomPanPinchRef>(null);
  const [focusDims, setFocusDims] = useState({ w: 0, h: 0 });
  const modalPaneRef = useRef<HTMLDivElement>(null);
  const modalTransformRef = useRef<ReactZoomPanPinchRef>(null);
  const [modalDims, setModalDims] = useState({ w: 0, h: 0 });

  // Natural image dimensions — set once the img element fires onLoad.
  const [naturalDims, setNaturalDims] = useState({ w: 0, h: 0 });

  // Reset per-image state whenever the focused image changes.
  useEffect(() => {
    setAdjustments(NEUTRAL);
    setNaturalDims({ w: 0, h: 0 });
  }, [focusedId]);

  useEffect(() => {
    const el = focusViewRef.current;
    if (!el) return;
    const ob = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFocusDims({ w: width, h: height });
      focusTransformRef.current?.resetTransform(0);
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const el = modalPaneRef.current;
    if (!el) return;
    const ob = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setModalDims({ w: width, h: height });
      modalTransformRef.current?.resetTransform(0);
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, [modalOpen]);

  const focusBounds = useMemo(
    () => fitBounds(focusDims.w, focusDims.h, naturalDims.w, naturalDims.h),
    [focusDims, naturalDims],
  );
  const modalBounds = useMemo(
    () => fitBounds(modalDims.w, modalDims.h, naturalDims.w, naturalDims.h),
    [modalDims, naturalDims],
  );

  const focusedObs = useMemo(
    () => (focusedId ? (preTags[focusedId] ?? []) : []),
    [preTags, focusedId],
  );
  const appliedSet = useMemo(
    () => new Set(focusedObs.map((o) => o.scientificName)),
    [focusedObs],
  );

  const keyMap = useMemo(() => {
    const m = new Map<string, { scientificName: string; commonName: string }>();
    for (const s of species) {
      if (s.keyBinding) m.set(s.keyBinding.toUpperCase(), { scientificName: s.scientificName, commonName: s.commonName });
    }
    // User bindings override data defaults.
    for (const s of species) {
      const userKey = bindingFor(s.scientificName);
      if (userKey) m.set(userKey.toUpperCase(), { scientificName: s.scientificName, commonName: s.commonName });
    }
    return m;
  }, [species, bindingFor]);

  const handleThumbClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey && focusedId) {
        const ids = files.map((f) => f.id);
        const a = ids.indexOf(focusedId);
        const b = ids.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
          return next;
        });
      } else if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else {
        setSelected(new Set([id]));
      }
      setFocusedId(id);
    },
    [files, focusedId],
  );

  const handleApply = useCallback(
    (tag: Parameters<typeof addPreTag>[1]) => {
      const targets = selected.size > 0 ? [...selected] : focusedId ? [focusedId] : [];
      for (const id of targets) addPreTag(id, tag);
    },
    [selected, focusedId, addPreTag],
  );

  const focusedFile = files.find((f) => f.id === focusedId) ?? null;
  const focusedUrl = focusedId ? (fullMap.current.get(focusedId) ?? null) : null;
  const focusedIndex = focusedId ? files.findIndex((f) => f.id === focusedId) : -1;

  const goTo = useCallback((index: number) => {
    const f = files[index];
    if (!f) return;
    setFocusedId(f.id);
    setSelected(new Set([f.id]));
  }, [files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (capturingFor) { setCapturingFor(null); return; }
        setModalOpen(false);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Capture mode: assign the pressed key to the waiting species.
      if (capturingFor) {
        if (e.key.length === 1) {
          e.preventDefault();
          setBinding(capturingFor, e.key);
          setCapturingFor(null);
        }
        return;
      }

      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(focusedIndex - 1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(focusedIndex + 1); return; }
      if (!focusedId) return;
      const match = keyMap.get(e.key.toUpperCase());
      if (match) {
        e.preventDefault();
        if (appliedSet.has(match.scientificName)) {
          const obs = preTags[focusedId]?.find((o) => o.scientificName === match.scientificName);
          if (obs) setPreTagCount(focusedId, match.scientificName, obs.count + 1);
        } else {
          handleApply({ scientificName: match.scientificName, commonName: match.commonName, count: 1 });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedIndex, goTo, keyMap, focusedId, appliedSet, preTags, setPreTagCount, handleApply,
      capturingFor, setBinding]);

  const handleStartCapture = useCallback((scientificName: string) => {
    setCapturingFor(scientificName);
  }, []);

  const handleClearKey = useCallback((scientificName: string) => {
    clearBinding(scientificName);
  }, [clearBinding]);

  const handleDrop = useCallback(
    (fileId: string, e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/x-species');
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as { scientificName: string; commonName: string };
        addPreTag(fileId, { scientificName: payload.scientificName, commonName: payload.commonName, count: 1 });
      } catch { /* ignore malformed drag data */ }
    },
    [addPreTag],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-species')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setNaturalDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
  }, []);

  const speciesPanel = (
    filterVal: string,
    onFilterChange: (v: string) => void,
    ref: React.RefObject<HTMLInputElement>,
  ) => (
    <SpeciesPanel
      species={species}
      onApply={handleApply}
      filter={filterVal}
      onFilterChange={onFilterChange}
      filterRef={ref}
      bindingFor={bindingFor}
      capturingFor={capturingFor}
      onStartCapture={handleStartCapture}
      onClearKey={handleClearKey}
      appliedSet={appliedSet}
      hasFocus={focusedId !== null}
      selectionCount={selected.size > 1 ? selected.size : 0}
      disabled={focusedId === null}
      headerSlot={
        focusedId ? (
          <AppliedSpecies
            observations={focusedObs}
            disabled={focusedId === null}
            onSetCount={(name, count) => setPreTagCount(focusedId, name, count)}
            onRemove={(name) => removePreTag(focusedId, name)}
            onDetagAll={() => clearFileTags(focusedId)}
          />
        ) : undefined
      }
    />
  );

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 220px)' }}>
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left: image area */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 gap-3 pr-3">
          {/* Focus view — fills available height */}
          <div ref={focusViewRef} className="flex-1 min-h-0 flex border border-rule">
            {focusedUrl ? (
              <ImagePane
                url={focusedUrl}
                alt={focusedFile?.fileName ?? ''}
                adjustments={adjustments}
                onAdjust={setAdjustments}
                onLoad={handleImageLoad}
                bounds={focusBounds}
                containerDims={focusDims}
                transformRef={focusTransformRef}
                focusedId={focusedId}
                hovered={imageHovered}
                onHoverChange={setImageHovered}
                hasPrev={focusedIndex > 0}
                hasNext={focusedIndex >= 0 && focusedIndex < files.length - 1}
                onPrev={() => goTo(focusedIndex - 1)}
                onNext={() => goTo(focusedIndex + 1)}
                onExpand={() => setModalOpen(true)}
                onDrop={focusedId ? (e) => handleDrop(focusedId, e) : undefined}
                onDragOver={handleDragOver}
                ctrlBg={ctrlBg}
                zoomBtnSize="w-7 h-7 text-[16px]"
                navBtnSize="w-11 h-14 text-[28px] font-bold"
              />
            ) : (
              <div className="w-full h-full bg-paperHover flex items-center justify-center">
                <span className="text-inkMute font-body text-[13px]">Select an image</span>
              </div>
            )}
          </div>

          {/* Thumbnail strip */}
          <div className="shrink-0 flex gap-2 overflow-x-auto pb-1">
            {files.map((f) => {
              const url = thumbMap.current.get(f.id);
              const isFocused = f.id === focusedId;
              const isSelected = selected.has(f.id);
              const hasTag = (preTags[f.id] ?? []).length > 0;
              return (
                <button
                  key={f.id}
                  onClick={(e) => handleThumbClick(f.id, e)}
                  onDrop={(e) => handleDrop(f.id, e)}
                  onDragOver={handleDragOver}
                  className={`relative shrink-0 w-20 h-20 border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                    isFocused ? 'border-ink' : isSelected ? 'border-accent' : 'border-transparent hover:border-rule'
                  }`}
                  title={f.fileName}
                >
                  {url ? (
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full grid place-items-center bg-paperHover text-inkMute text-[10px] font-mono">
                      {f.fileName.slice(-6)}
                    </span>
                  )}
                  {hasTag && (
                    <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-ok border border-paper"
                      title="Tagged" aria-label="Tagged" />
                  )}
                </button>
              );
            })}
          </div>

          {focusedFile && (
            <p className="shrink-0 font-body text-[12px] text-inkSoft truncate">{focusedFile.fileName}</p>
          )}
        </div>

        {/* Right: species panel */}
        <div className="w-72 shrink-0 flex flex-col h-full min-h-0">
          {speciesPanel(filter, setFilter, filterRef)}
        </div>
      </div>

      {/* Footer nav */}
      <div className="shrink-0 flex items-center justify-between gap-4 border-t border-ruleSoft pt-4 mt-4">
        <button
          onClick={goBack}
          className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep('assign')}
            className="border border-rule text-inkSoft px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            title="Skip tagging — go straight to Assign"
          >
            Skip
          </button>
          <button
            onClick={() => setStep('assign')}
            className="bg-ink text-paper border border-ink px-3.5 py-1.5 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Next
          </button>
        </div>
      </div>

      {/* Full-screen tagging modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="absolute inset-2 flex bg-paper border border-rule shadow-2xl overflow-hidden">
            {/* Image pane */}
            <div ref={modalPaneRef} className="flex-1 min-w-0 min-h-0 flex">
              {focusedUrl ? (
                <ImagePane
                  url={focusedUrl}
                  alt={focusedFile?.fileName ?? ''}
                  adjustments={adjustments}
                  onAdjust={setAdjustments}
                  onLoad={handleImageLoad}
                  bounds={modalBounds}
                  containerDims={modalDims}
                  transformRef={modalTransformRef}
                  focusedId={focusedId}
                  hovered={modalImageHovered}
                  onHoverChange={setModalImageHovered}
                  hasPrev={focusedIndex > 0}
                  hasNext={focusedIndex >= 0 && focusedIndex < files.length - 1}
                  onPrev={() => goTo(focusedIndex - 1)}
                  onNext={() => goTo(focusedIndex + 1)}
                  onDrop={focusedId ? (e) => handleDrop(focusedId, e) : undefined}
                  onDragOver={handleDragOver}
                  ctrlBg={modalCtrlBg}
                  zoomBtnSize="w-9 h-9 text-[18px]"
                  navBtnSize="w-14 h-20 text-[36px] font-bold"
                  fileName={focusedFile?.fileName}
                />
              ) : null}
            </div>

            {/* Close */}
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className={`absolute top-3 left-3 z-20 w-9 h-9 text-[18px] ${CTRL_BTN} ${modalCtrlBg}`}
              title="Close (Esc)"
              aria-label="Close"
            >✕</button>

            {/* Species panel */}
            <div className="w-96 shrink-0 border-l border-rule flex flex-col h-full min-h-0">
              {speciesPanel(modalFilter, setModalFilter, modalFilterRef)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
