import type L from 'leaflet';

// Trackpad and wheel input on the map, the way Excalidraw and Figma handle it:
// a pinch follows the fingers every frame, around the pointer, with no
// batching, easing or snapping, and two fingers pan.
//
// On a page that scrolls, a two-finger scroll that starts off the map keeps
// scrolling the page when the map slides under the pointer, the way browsers
// latch nested scroll areas. Only a scroll that starts on the map pans it.
//
// Leaflet's own wheel zoom sums wheel deltas for 40 ms, maps the sum through a
// curve that saturates, then starts a 250 ms animation toward the result, so
// the map trails the fingers and keeps moving after they stop. Here both pinch
// kinds (Chrome, Edge and Firefox send Ctrl wheel events; Safari sends gesture
// events) drive the path Leaflet's TouchZoom takes for a pinch on a phone:
// `_move(…, {pinch: true})` each frame, which scales tiles and vector layers
// with CSS transforms, then a normal zoom end that redraws them sharp.

/** Chrome sends a pinch as deltaY = −100·ln(scale), so 100·ln 2 px is one doubling: one zoom level. */
const LEVEL = 100 * Math.LN2;
/** How long a page scroll's latch lasts after its latest wheel event. */
const LATCH_MS = 200;
/** How long a pinch waits for its next wheel event before it ends. */
const PINCH_IDLE_MS = 150;

/** One unit of a wheel delta in pixels: a pixel, a 16 px line, or a page the map's height. */
export const wheelPixels = (deltaMode: number, height: number): number => (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1);

/** A Ctrl/⌘ wheel event's zoom, unclamped: a level per doubling of the pinch, at most a level for a mouse wheel notch. */
export const wheelZoom = (zoom: number, deltaY: number): number => zoom - Math.max(-LEVEL, Math.min(LEVEL, deltaY)) / LEVEL;

/** Safari's pinch: the zoom it started at, plus a level per doubling of the scale, unclamped. */
export const gestureZoom = (start: number, scale: number): number => start + Math.log2(scale);

type Vec = { x: number; y: number };

/** `panBy` moves whole pixels; the rest carries over so slow drags keep up with the fingers. */
export function splitPan(pan: Vec): { step: Vec; rest: Vec } {
  const step = { x: Math.round(pan.x), y: Math.round(pan.y) };
  return { step, rest: { x: pan.x - step.x, y: pan.y - step.y } };
}

type TouchZoomHooks = {
  _stop(): void;
  _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
  _move(center: L.LatLng, zoom: number, data: { pinch: boolean; round: boolean }): void;
  _moveEnd(zoomChanged: boolean): void;
  _animatingZoom: boolean;
};
// The private Leaflet 1.9 methods its TouchZoom handler calls; its types leave them out.
const touchZoomHooks = (map: L.Map) => map as unknown as TouchZoomHooks;

type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

/** Pinch zoom and wheel pan on `map`, in place of Leaflet's wheel zoom. Returns a cleanup function. */
export function attachTrackpad(map: L.Map): () => void {
  const el = map.getContainer();
  const hooks = touchZoomHooks(map);
  let pinch: { zoom: number; point: L.Point; latlng: L.LatLng } | null = null;
  let pan: Vec | null = null;
  let frame = 0;
  let idle = 0;
  let safariStart: number | null = null;
  let pointer: L.Point | null = null;
  // While a page scroll is under way, the time its latch runs out; each further wheel event extends it.
  let pageScrollUntil = 0;

  const pointOf = (e: { clientX: number; clientY: number }) => map.mouseEventToContainerPoint(e as MouseEvent);
  const clampZoom = (z: number) => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z));

  function flush() {
    frame = 0;
    if (pinch) {
      // The spot under the pointer stays under it: centre = that spot, less the pointer's offset from the middle.
      const offset = pinch.point.subtract(map.getSize().divideBy(2));
      const center = map.unproject(map.project(pinch.latlng, pinch.zoom).subtract(offset), pinch.zoom);
      hooks._move(center, pinch.zoom, { pinch: true, round: false });
    }
    if (pan) {
      const { step, rest } = splitPan(pan);
      if (step.x || step.y) map.panBy([step.x, step.y], { animate: false });
      pan = rest;
    }
  }
  const schedule = () => {
    frame ||= requestAnimationFrame(flush);
  };

  function zoomTo(zoom: number, point: L.Point) {
    if (!pinch) {
      hooks._stop();
      pinch = { zoom: map.getZoom(), point, latlng: map.containerPointToLatLng(point) };
      hooks._moveStart(true, false);
    } else if (!point.equals(pinch.point)) {
      // The pointer moved mid-gesture: settle the pending frame, then hold the spot now under it.
      if (frame) {
        cancelAnimationFrame(frame);
        flush();
      }
      pinch.point = point;
      pinch.latlng = map.containerPointToLatLng(point);
    }
    pinch.zoom = clampZoom(zoom);
    schedule();
  }

  function endPinch() {
    window.clearTimeout(idle);
    if (!pinch) return;
    if (frame) {
      cancelAnimationFrame(frame);
      flush();
    }
    pinch = null;
    // What Leaflet does when a zoom animation ends: tiles and vector layers redraw at the new zoom.
    map.fire('zoom').fire('move');
    hooks._moveEnd(true);
  }

  const onWheel = (e: WheelEvent) => {
    const pinching = e.ctrlKey || e.metaKey;
    if (!pinching && e.timeStamp < pageScrollUntil) {
      pageScrollUntil = e.timeStamp + LATCH_MS;
      return;
    }
    e.preventDefault();
    if (safariStart !== null || hooks._animatingZoom) return;
    const unit = wheelPixels(e.deltaMode, el.clientHeight);
    if (pinching) {
      zoomTo(wheelZoom(pinch ? pinch.zoom : map.getZoom(), e.deltaY * unit), pointOf(e));
      window.clearTimeout(idle);
      idle = window.setTimeout(endPinch, PINCH_IDLE_MS);
    } else {
      endPinch();
      pan = { x: (pan?.x ?? 0) + e.deltaX * unit, y: (pan?.y ?? 0) + e.deltaY * unit };
      schedule();
    }
  };
  const onPageWheel = (e: WheelEvent) => {
    if (!el.contains(e.target as Node) && !e.ctrlKey && !e.metaKey) pageScrollUntil = e.timeStamp + LATCH_MS;
  };
  const onPointerMove = (e: PointerEvent) => {
    pointer = pointOf(e);
  };
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    safariStart = pinch ? pinch.zoom : map.getZoom();
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (safariStart === null) return;
    zoomTo(gestureZoom(safariStart, (e as GestureEvent).scale), pointer ?? pointOf(e as GestureEvent));
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    safariStart = null;
    endPinch();
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('wheel', onPageWheel, { passive: true, capture: true });
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('gesturestart', onGestureStart);
  el.addEventListener('gesturechange', onGestureChange);
  el.addEventListener('gestureend', onGestureEnd);
  return () => {
    endPinch();
    cancelAnimationFrame(frame);
    el.removeEventListener('wheel', onWheel);
    window.removeEventListener('wheel', onPageWheel, { capture: true });
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
  };
}
