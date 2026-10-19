import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { canShowExactSites, checkNoLocation, displayPosition, hexCenter, hexRing, type Model } from '@/data';
import { BASEMAPS, DEFAULT_BASEMAP, basemapOf } from '@/lib/basemaps';
import { describeCheck } from '@/lib/checkText';
import { fmtN, formatElevation } from '@/lib/format';
import {
  HEX_STEPS,
  boxOf,
  hexStep,
  hexViews,
  hexesInBox,
  shortCount,
  siteRadius,
  siteViews,
  unplacedPhotos,
  type HexView,
  type SiteView,
} from '@/lib/mapData';
import { readStored, writeStored } from '@/lib/storage';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { useShowTarget } from './DataChecks';
import { InView } from './InView';
import { Seg } from './Popover';

const BASEMAP_KEY = 'sparcd-explorer-basemap';
const MAX_ZOOM = 16;

const STEP_CLASSES = Array.from({ length: HEX_STEPS + 1 }, (_, i) => `s${i}`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const toggled = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const latLng = (p: { lat: number; lon: number }) => L.latLng(p.lat, p.lon);

/** Where the map stood for a set of collections, so coming back keeps the user's pan and zoom. */
let lastView: { key: string; center: L.LatLng; zoom: number } | null = null;

function hexTip(model: Model, h: HexView, multi: boolean, selected: boolean): string {
  const n = h.locations.length;
  const rows = h.locations
    .map(
      (l) =>
        `<tr${l.inView ? '' : ' class="muted"'}><td class="m">${esc(l.ids.join(', '))}</td><td>${esc(l.name || '—')}</td>` +
        `<td class="n">${fmtN(l.photos)}</td><td class="n">${fmtN(l.detections)}</td></tr>`,
    )
    .join('');
  const colls = multi ? `<div class="muted">${esc(h.collections.map((c) => model.collections[c].name).join(', '))}</div>` : '';
  return (
    `<b>${n} location${n === 1 ? '' : 's'} in this hex</b>${colls}` +
    `<table><tr class="muted"><th></th><th></th><th class="n">Photos</th><th class="n">Detections</th></tr>${rows}</table>` +
    (selected ? '<div class="foot">In the selected area</div>' : '')
  );
}

function siteTip(model: Model, s: SiteView, multi: boolean, unit: 'm' | 'ft'): string {
  const site = model.sites[s.site];
  const where = [site.range, formatElevation(site.elevation, unit)].filter((x) => x && x !== '—').join(' · ');
  return (
    `<b><span class="m">${esc(site.locationId)}</span> ${esc(site.name)}</b>` +
    (multi ? `<div>${esc(model.collections[site.collection].name)}</div>` : '') +
    (where ? `<div class="muted">${esc(where)}</div>` : '') +
    `<table><tr><td>Photos</td><td class="n">${fmtN(s.photos)}</td></tr><tr><td>Detections</td><td class="n">${fmtN(s.detections)}</td></tr></table>`
  );
}

type HexLayer = { poly: L.Polygon; label: L.Marker; center: L.LatLng; ring: L.LatLng[] };

/** Every located place's bounds: what the map fits on first open. */
function placesBounds(model: Model, inView?: Set<string>): L.LatLngBounds | null {
  const points: L.LatLng[] = [];
  for (const id of new Set(model.sites.flatMap((s) => (s.hex ? [s.hex] : [])))) {
    if (inView && !inView.has(id)) continue;
    points.push(...hexRing(model.grid, id).map(latLng));
  }
  return points.length ? L.latLngBounds(points) : null;
}

export function MapBand() {
  const { model, filters, result, grouping, multi } = useView();
  const endpoint = useStore((s) => s.config!.endpoint);
  const display = useStore((s) => s.display);
  const storedMode = useStore((s) => s.mapMode);
  const setMapMode = useStore((s) => s.setMapMode);
  const setFilters = useStore((s) => s.setFilters);
  const highlight = useStore((s) => s.highlight);
  const show = useShowTarget();

  // Exact site points follow the data layer's gate; elsewhere only hexes exist.
  const sitesAllowed = canShowExactSites(endpoint);
  const mode = sitesAllowed ? storedMode : 'hexes';
  const [basemap, setBasemap] = useState(() =>
    readStored(BASEMAP_KEY, DEFAULT_BASEMAP, (v): v is string => typeof v === 'string' && BASEMAPS.some((b) => b.id === v)),
  );
  const [boxing, setBoxing] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [clearAt, setClearAt] = useState<{ left: number; top: number } | null>(null);

  const hexes = useMemo(() => hexViews(model, result, grouping.separate), [model, result, grouping.separate]);
  const sites = useMemo(
    () => (mode === 'sites' ? siteViews(model, result, display.precision) : []),
    [mode, model, result, display.precision],
  );
  const unplaced = useMemo(() => unplacedPhotos(model, result), [model, result]);
  const noLocationAction = useMemo(() => {
    const [check] = checkNoLocation(model);
    const action = check && describeCheck(model, check).action;
    return action?.kind === 'show' ? action.target : null;
  }, [model]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const hexLayers = useRef(new Map<string, HexLayer>());
  const siteLayers = useRef(new Map<number, L.CircleMarker>());
  const suppressClick = useRef(false);
  const fitKey = model.collections.map((c) => c.key).join('\n');
  const fitKeyRef = useRef(fitKey);
  fitKeyRef.current = fitKey;

  // --- The map itself --------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current!.querySelector<HTMLDivElement>('.leafmap')!;
    const m = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      // Wheel and double-click zoom would hijack page scrolling and hex clicks; the buttons zoom.
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      maxZoom: MAX_ZOOM,
      minZoom: 2,
      zoomSnap: 0.5,
    });
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.on('moveend', () => {
      lastView = { key: fitKeyRef.current, center: m.getCenter(), zoom: m.getZoom() };
    });
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el);
    setMap(m);
    return () => {
      resize.disconnect();
      m.remove();
      setMap(null);
    };
  }, []);

  // --- Basemap ---------------------------------------------------------------
  useEffect(() => {
    if (!map) return;
    const def = basemapOf(basemap);
    const layers = def.layers.map((l) =>
      L.tileLayer(l.url, { maxNativeZoom: l.maxNativeZoom, maxZoom: MAX_ZOOM, opacity: l.opacity ?? 1, subdomains: l.subdomains ?? 'abc' }),
    );
    const group = L.layerGroup(layers).addTo(map);
    return () => void group.remove();
  }, [map, basemap]);

  // --- Fit the places on first open and after the collections change, never on a filter change.
  useEffect(() => {
    if (!map) return;
    if (lastView?.key === fitKey) {
      map.setView(lastView.center, lastView.zoom, { animate: false });
      return;
    }
    const inView = new Set(hexes.filter((h) => h.inView).map((h) => h.hex));
    const bounds = placesBounds(model, inView) ?? placesBounds(model);
    if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13, animate: false });
    else map.setView([0, 0], 2, { animate: false });
    // Only the collections decide when to fit; a filter change keeps the view.
  }, [map, fitKey]);

  // --- Hexes -------------------------------------------------------------------
  useEffect(() => {
    if (!map || mode !== 'hexes') return;
    const layers = hexLayers.current;
    const group = L.layerGroup().addTo(map);
    for (const id of new Set(model.sites.flatMap((s) => (s.hex ? [s.hex] : [])))) {
      const ring = hexRing(model.grid, id).slice(0, 6).map(latLng);
      const center = latLng(hexCenter(model.grid, id));
      const poly = L.polygon(ring, { weight: 1 }).addTo(group);
      const toggle = () =>
        setFilters((f) => ({ ...f, area: { ...f.area, hexes: toggled(f.area.hexes, id) } }));
      poly.on('click', toggle);
      poly.bindTooltip('', { sticky: true, direction: 'top', className: 'maptip', opacity: 1 });
      const el = poly.getElement() as SVGPathElement;
      el.dataset.hex = id;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggle();
      });
      el.addEventListener('focus', () => poly.openTooltip(center));
      el.addEventListener('blur', () => poly.closeTooltip());
      const label = L.marker(center, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'hexlabel', html: '<span></span>', iconSize: [48, 18], iconAnchor: [24, 9] }),
      }).addTo(group);
      layers.set(id, { poly, label, center, ring });
    }
    // Labels hide while a hex is too small on screen to hold one.
    const sizeLabels = () => {
      const first = layers.values().next().value as HexLayer | undefined;
      if (!first) return;
      const r = map.latLngToContainerPoint(first.center).distanceTo(map.latLngToContainerPoint(first.ring[0]));
      map.getContainer().classList.toggle('tiny-hexes', r < 13);
    };
    sizeLabels();
    map.on('zoomend', sizeLabels);
    return () => {
      map.off('zoomend', sizeLabels);
      group.remove();
      layers.clear();
    };
  }, [map, model, mode, setFilters]);

  const selectedHexes = filters.area.hexes;
  const lit = useMemo(() => {
    if (!highlight) return null;
    return { hexes: new Set(highlight.map((s) => model.sites[s].hex)), sites: new Set(highlight) };
  }, [highlight, model]);

  useEffect(() => {
    if (!map || mode !== 'hexes') return;
    const max = Math.max(1, ...hexes.map((h) => h.detections));
    const selected = new Set(selectedHexes);
    for (const h of hexes) {
      const layer = hexLayers.current.get(h.hex);
      if (!layer) continue;
      const step = h.inView ? hexStep(h.detections, max) : 0;
      const on = selected.has(h.hex);
      const el = layer.poly.getElement() as SVGPathElement;
      el.setAttribute(
        'class',
        ['leaflet-interactive hx', h.inView ? `s${step}` : 'out', on && 'sel', lit?.hexes.has(h.hex) && 'hl'].filter(Boolean).join(' '),
      );
      el.setAttribute('aria-pressed', String(on));
      el.setAttribute(
        'aria-label',
        `${h.locations.map((l) => l.ids.join(', ')).join(', ')}: ${fmtN(h.detections)} detections, ${fmtN(h.photos)} photos`,
      );
      layer.poly.setTooltipContent(hexTip(model, h, multi, on));
      const label = layer.label.getElement();
      if (label) {
        label.classList.remove('out', ...STEP_CLASSES);
        label.classList.add(h.inView ? `s${step}` : 'out');
        label.firstElementChild!.textContent = h.inView ? shortCount(h.detections) : '';
      }
    }
  }, [map, mode, hexes, selectedHexes, lit, model, multi]);

  // --- Sites (only where exact points are allowed) ------------------------------
  useEffect(() => {
    if (!map || mode !== 'sites') return;
    const layers = siteLayers.current;
    const group = L.layerGroup().addTo(map);
    model.sites.forEach((site, i) => {
      if (!site.position) return;
      // Never drawn more exact than the display precision.
      const dot = L.circleMarker(latLng(displayPosition(site.position, display.precision)), { radius: 4, weight: 1.2 }).addTo(group);
      dot.on('click', () => setFilters((f) => ({ ...f, locations: toggled(f.locations, site.key) })));
      dot.bindTooltip('', { direction: 'top', className: 'maptip', opacity: 1 });
      (dot.getElement() as SVGPathElement).dataset.site = site.locationId;
      layers.set(i, dot);
    });
    return () => {
      group.remove();
      layers.clear();
    };
  }, [map, model, mode, display.precision, setFilters]);

  useEffect(() => {
    if (!map || mode !== 'sites') return;
    const max = Math.max(1, ...sites.map((s) => s.detections));
    const picked = new Set(filters.locations);
    for (const s of sites) {
      const dot = siteLayers.current.get(s.site);
      if (!dot) continue;
      const on = picked.has(model.sites[s.site].key);
      dot.setRadius(s.inView ? siteRadius(s.detections, max) : 3);
      (dot.getElement() as SVGPathElement).setAttribute(
        'class',
        ['leaflet-interactive st', s.inView ? 'in' : 'out', on && 'sel', lit?.sites.has(s.site) && 'hl'].filter(Boolean).join(' '),
      );
      dot.setTooltipContent(siteTip(model, s, multi, display.elevation));
    }
  }, [map, mode, sites, filters.locations, lit, model, multi, display.elevation]);

  // --- "× Clear" sits just above the selection's top-right corner -----------------
  const siteSelection = useMemo(
    () => (mode === 'sites' ? model.sites.flatMap((s, i) => (s.position && filters.locations.includes(s.key) ? [i] : [])) : []),
    [mode, model, filters.locations],
  );
  const hasSelection = selectedHexes.length > 0 || filters.area.boxes.length > 0 || siteSelection.length > 0;
  useEffect(() => {
    if (!map || !hasSelection) return setClearAt(null);
    const place = () => {
      const points: L.Point[] = [];
      for (const id of selectedHexes) for (const p of hexRing(model.grid, id)) points.push(map.latLngToContainerPoint(latLng(p)));
      for (const b of filters.area.boxes) {
        points.push(map.latLngToContainerPoint([b.north, b.east]), map.latLngToContainerPoint([b.south, b.west]));
      }
      for (const i of siteSelection) {
        const c = map.latLngToContainerPoint(siteLayers.current.get(i)?.getLatLng() ?? latLng(model.sites[i].position!));
        points.push(c.subtract([14, 14]), c.add([14, 14]));
      }
      const size = map.getSize();
      const w = clearRef.current?.offsetWidth ?? 70;
      const h = clearRef.current?.offsetHeight ?? 30;
      const right = Math.max(...points.map((p) => p.x));
      const top = Math.min(...points.map((p) => p.y));
      const bottom = Math.max(...points.map((p) => p.y));
      const y = top - h - 6 < 6 ? bottom + 6 : top - h - 6;
      // Clear of the zoom buttons at the top right and the credit line at the bottom.
      setClearAt({ left: Math.min(Math.max(right - w, 6), size.x - w - 52), top: Math.min(Math.max(y, 6), size.y - h - 24) });
    };
    place();
    map.on('move zoom resize', place);
    return () => void map.off('move zoom resize', place);
  }, [map, hasSelection, selectedHexes, filters.area.boxes, siteSelection, model]);

  const clearSelection = () =>
    setFilters((f) => ({
      ...f,
      area: { hexes: [], boxes: [] },
      locations: mode === 'sites' ? f.locations.filter((k) => !model.sites.some((s) => s.key === k && s.position)) : f.locations,
    }));

  // --- Select area ------------------------------------------------------------
  useEffect(() => {
    if (!boxing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setDrag(null);
      setBoxing(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [boxing]);

  const local = (e: ReactPointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
  };
  const finishBox = () => {
    const d = drag;
    setDrag(null);
    setBoxing(false);
    // The click that ends a drag must not also toggle the hex under it.
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false));
    if (!map || !d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 5) return;
    const a = map.containerPointToLatLng([d.x0, d.y0]);
    const b = map.containerPointToLatLng([d.x1, d.y1]);
    const box = boxOf({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
    const picked = hexesInBox(model.grid, hexes.map((h) => h.hex), box);
    if (picked.length) setFilters((f) => ({ ...f, area: { ...f.area, hexes: [...new Set([...f.area.hexes, ...picked])] } }));
  };

  const legendMax = Math.max(0, ...hexes.map((h) => h.detections));
  const credit = basemapOf(basemap).credit;

  return (
    <section id="map" className="mapband panel" aria-label="Map">
      <div className="bandhead">
        <h2>Map</h2>
        {sitesAllowed && (
          <Seg
            label="Map shows"
            value={mode}
            options={[
              ['hexes', 'Hexes'],
              ['sites', 'Sites'],
            ]}
            onChange={setMapMode}
          />
        )}
        <button
          type="button"
          className="btn sm tool"
          aria-pressed={boxing}
          onClick={() => {
            setDrag(null);
            setBoxing(!boxing);
          }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.6" aria-hidden="true">
            <rect x="1.5" y="1.5" width="11" height="11" />
          </svg>
          Select area
        </button>
        <label className="sr" htmlFor="basemap">
          Basemap
        </label>
        <select
          id="basemap"
          className="field basemap"
          value={basemap}
          onChange={(e) => {
            setBasemap(e.target.value);
            writeStored(BASEMAP_KEY, e.target.value);
          }}
        >
          {BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={wrapRef}
        className={boxing ? 'mapwrap boxing' : 'mapwrap'}
        onClickCapture={(e) => {
          if (suppressClick.current) e.stopPropagation();
        }}
      >
        <div className="leafmap" role="group" aria-label="Map of camera locations" />
        <div className="map-legend" aria-hidden="true">
          {mode === 'hexes' ? (
            <>
              Detections in view
              <span className="ramp">
                {Array.from({ length: HEX_STEPS }, (_, i) => (
                  <i key={i} className={`s${i + 1}`} />
                ))}
              </span>
              <span className="mono">{fmtN(legendMax)}</span>
            </>
          ) : (
            'Dot size: detections'
          )}
        </div>
        {unplaced > 0 && noLocationAction && (
          <button type="button" className="map-note" onClick={() => show(noLocationAction)}>
            {fmtN(unplaced)} {unplaced === 1 ? 'photo has' : 'photos have'} no location
          </button>
        )}
        <div className="map-credit">Tiles · {credit}</div>
        {clearAt && !boxing && (
          <button
            ref={clearRef}
            type="button"
            className="selclear onmap"
            style={clearAt}
            aria-label="Clear map selection"
            onClick={clearSelection}
          >
            <b aria-hidden="true">×</b>Clear
          </button>
        )}
        {boxing && (
          <div
            ref={boxRef}
            className="boxlayer"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = local(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const p = local(e);
              setDrag({ ...drag, x1: p.x, y1: p.y });
            }}
            onPointerUp={finishBox}
            onPointerCancel={() => setDrag(null)}
          >
            {drag && (
              <div
                className="boxrect"
                style={{
                  left: Math.min(drag.x0, drag.x1),
                  top: Math.min(drag.y0, drag.y1),
                  width: Math.abs(drag.x1 - drag.x0),
                  height: Math.abs(drag.y1 - drag.y0),
                }}
              />
            )}
          </div>
        )}
      </div>
      <InView />
    </section>
  );
}
