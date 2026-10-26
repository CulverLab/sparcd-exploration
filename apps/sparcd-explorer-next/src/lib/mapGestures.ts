import type L from 'leaflet';

// A trackpad pinch reaches the page as a wheel event with ctrlKey set (Chrome,
// Firefox, Edge) or as Safari's gesture events. Leaflet's own wheel zoom takes
// the Ctrl/⌘ wheel events, animated. Plain two-finger or mouse-wheel scrolling
// never reaches it and scrolls the page, so the map never traps someone
// scrolling past it.

/**
 * Leaflet's wheel zoom, unsnapped. Chrome sends a pinch as 100·ln(scale) of
 * wheel delta, and Leaflet divides that by 3× the pixel ratio on a Mac, so at
 * Leaflet's default of 60 a pinch that doubles the scale zooms well under a
 * level. At 12 it zooms about one.
 */
export const PINCH_ZOOM_OPTIONS = { scrollWheelZoom: true, wheelPxPerZoomLevel: 12, zoomSnap: 0 } satisfies L.MapOptions;

/** Safari's pinch: the zoom it started at, plus a level per doubling of the scale, within the map's range. */
export function gestureZoom(start: number, scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, start + Math.log2(scale)));
}

type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

/**
 * Keeps plain wheel events from the map, so they scroll the page, and calls
 * `onPlainScroll` when one passes over it; zooms on Safari's pinch gestures.
 * `wrap` holds the map's container. Returns a cleanup function.
 */
export function attachPinchZoom(map: L.Map, wrap: HTMLElement, onPlainScroll: () => void): () => void {
  const el = map.getContainer();
  let start: number | null = null;
  let latest: { scale: number; x: number; y: number } | null = null;
  let frame = 0;

  // Capturing on the wrapper stops an event before Leaflet's listener on the container.
  const onWheel = (e: WheelEvent) => {
    if (start !== null) {
      // Safari sends Ctrl wheel events during a pinch too; the gesture zooms.
      e.preventDefault();
      e.stopPropagation();
    } else if (!e.ctrlKey && !e.metaKey) {
      e.stopPropagation();
      onPlainScroll();
    }
  };
  const zoomToLatest = () => {
    frame = 0;
    if (start === null || !latest) return;
    const r = el.getBoundingClientRect();
    const zoom = gestureZoom(start, latest.scale, map.getMinZoom(), map.getMaxZoom());
    map.setZoomAround([latest.x - r.left, latest.y - r.top], zoom, { animate: false });
  };
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    start = map.getZoom();
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as GestureEvent;
    latest = { scale: g.scale, x: g.clientX, y: g.clientY };
    frame ||= requestAnimationFrame(zoomToLatest);
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    if (frame) {
      cancelAnimationFrame(frame);
      zoomToLatest();
    }
    start = null;
    latest = null;
  };

  wrap.addEventListener('wheel', onWheel, { capture: true, passive: false });
  el.addEventListener('gesturestart', onGestureStart);
  el.addEventListener('gesturechange', onGestureChange);
  el.addEventListener('gestureend', onGestureEnd);
  return () => {
    cancelAnimationFrame(frame);
    wrap.removeEventListener('wheel', onWheel, { capture: true });
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
  };
}
