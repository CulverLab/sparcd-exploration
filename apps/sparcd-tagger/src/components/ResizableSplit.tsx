import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const WIDE_QUERY = '(min-width: 1024px)';
const DIVIDER = 8;
const STEP = 16;

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch { return fallback; }
}

export function ResizableSplit({ storageKey, defaultSize, minSecond = 100, minFirst = 240, first, second }: {
  storageKey: string; defaultSize: number; minSecond?: number; minFirst?: number; first: ReactNode; second: ReactNode;
}) {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [preferred, setPreferred] = useState(() => ({
    w: readStored(`${storageKey}:w`, defaultSize), h: readStored(`${storageKey}:h`, defaultSize),
  }));
  const [total, setTotal] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; wide: boolean } | null>(null);
  const paneId = useId();
  const helpId = useId();
  const minimumTotal = minFirst + minSecond + DIVIDER;
  const maximum = Math.max(minSecond, total - DIVIDER - minFirst);
  const clamp = (value: number) => Math.min(maximum, Math.max(minSecond, value));
  const size = clamp(preferred[wide ? 'w' : 'h']);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const change = () => { drag.current = null; setWide(mq.matches); };
    mq.addEventListener('change', change);
    return () => { drag.current = null; mq.removeEventListener('change', change); };
  }, []);
  useLayoutEffect(() => {
    const el = container.current!;
    const measure = () => setTotal(wide ? el.clientWidth : el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [wide]);

  const update = (value: number) => {
    const next = clamp(value);
    const axis = wide ? 'w' : 'h';
    setPreferred(previous => ({ ...previous, [axis]: next }));
    try { localStorage.setItem(`${storageKey}:${axis}`, String(Math.round(next))); } catch { /* Best effort. */ }
  };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="h-full overflow-auto">
    <div ref={container} className="h-full grid" style={wide
      ? { minWidth: minimumTotal, gridTemplateColumns: `minmax(0,1fr) ${DIVIDER}px ${size}px` }
      : { minHeight: minimumTotal, gridTemplateRows: `minmax(0,1fr) ${DIVIDER}px ${size}px` }}>
      <div className="min-w-0 min-h-0">{first}</div>
      <div role="separator" aria-orientation={wide ? 'vertical' : 'horizontal'}
        aria-label={wide ? 'Resize the species panel’s width' : 'Resize the species panel’s height'}
        aria-controls={paneId} aria-describedby={helpId}
        aria-valuemin={minSecond} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(size)}
        aria-valuetext={`${Math.round(size)} pixels`} tabIndex={0}
        onPointerDown={event => {
          if (drag.current || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
          event.preventDefault(); event.currentTarget.focus();
          drag.current = { id: event.pointerId, wide };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current?.id !== event.pointerId || drag.current.wide !== wide) return;
          const rect = container.current!.getBoundingClientRect();
          update((wide ? rect.right - event.clientX : rect.bottom - event.clientY) - DIVIDER / 2);
        }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={event => {
          if (drag.current?.id === event.pointerId) drag.current = null;
        }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Home') update(minSecond);
          else if (event.key === 'End') update(maximum);
          else if (event.key === (wide ? 'ArrowLeft' : 'ArrowUp')) update(size + STEP);
          else if (event.key === (wide ? 'ArrowRight' : 'ArrowDown')) update(size - STEP);
        }}
        className={`touch-none bg-rule hover:bg-accent focus-visible:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 ${wide ? 'cursor-col-resize' : 'cursor-row-resize'}`} />
      <div id={paneId} data-testid="focus-species-pane" className="min-w-0 min-h-0 overflow-auto">
        <div className="h-full min-w-60 min-h-60">{second}</div>
      </div>
      <span id={helpId} className="sr-only">Use arrow keys to resize the species panel. Home selects its minimum size; End selects its maximum size.</span>
    </div>
  </div>;
}
