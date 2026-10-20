import type L from 'leaflet';

// A trackpad pinch reaches the page as a wheel event with ctrlKey set (Chrome,
// Firefox, Edge) or as Safari's gesture events. Left alone, the browser zooms
// the whole page. Plain two-finger or mouse-wheel scrolling still scrolls the
// page, so the map never traps someone scrolling past it.

/** Zoom levels per pixel of pinch wheel delta. */
const WHEEL_RATE = 0.01;

type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

export function pinchZoomTarget(zoom: number, deltaY: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, zoom - deltaY * WHEEL_RATE));
}

/**
 * Zooms `map` on pinch (and on Ctrl/⌘ + wheel), and calls `onPlainScroll` when
 * a plain scroll passes over it. Returns a cleanup function.
 */
export function attachPinchZoom(map: L.Map, el: HTMLElement, onPlainScroll: () => void): () => void {
  let gesture: { zoom: number } | null = null;
  // Small pinch deltas would each snap back to the same level; add them up.
  let target: number | null = null;
  let settle = 0;

  const zoomAround = (clientX: number, clientY: number, zoom: number) => {
    const r = el.getBoundingClientRect();
    map.setZoomAround([clientX - r.left, clientY - r.top], zoom, { animate: false });
  };

  const onWheel = (e: WheelEvent) => {
    if (gesture) {
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && !e.metaKey) {
      onPlainScroll();
      return;
    }
    e.preventDefault();
    target = pinchZoomTarget(target ?? map.getZoom(), e.deltaY, map.getMinZoom(), map.getMaxZoom());
    zoomAround(e.clientX, e.clientY, target);
    clearTimeout(settle);
    settle = window.setTimeout(() => (target = null), 200);
  };
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gesture = { zoom: map.getZoom() };
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (!gesture) return;
    const g = e as GestureEvent;
    const zoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), gesture.zoom + Math.log2(g.scale)));
    zoomAround(g.clientX, g.clientY, zoom);
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    gesture = null;
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('gesturestart', onGestureStart);
  el.addEventListener('gesturechange', onGestureChange);
  el.addEventListener('gestureend', onGestureEnd);
  return () => {
    clearTimeout(settle);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
  };
}
