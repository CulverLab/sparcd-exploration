import { useMemo } from 'react';
import { hexCenter, siteHexes, type CoordDisplay, type FilterResult, type Model, type Position } from '@/data';
import { fmtN } from '@/lib/format';
import { hexStep, hexViews, selectedHexes, siteRadius, siteViews } from '@/lib/mapData';

const W = 760;
const H = 360;
const PAD = 22;
const EARTH = 6378137;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Web Mercator, in radians: what the page's map uses, so shapes match. */
const project = (p: Position): [number, number] => [rad(p.lon), Math.log(Math.tan(Math.PI / 4 + rad(p.lat) / 2))];

/** 1, 2 or 5 × 10ⁿ metres, the longest not above `max`. */
function niceMetres(max: number): number {
  const p = 10 ** Math.floor(Math.log10(max));
  return [5, 2, 1].map((f) => f * p).find((v) => v <= max) ?? p;
}

/**
 * The map for a printed report: the hexes (or, where exact sites are allowed
 * and shown, the sites) drawn on plain paper, framed on what is in view. No
 * basemap: tiles from other servers can't be copied into a page image, and the
 * cells already follow the coordinate precision.
 */
export function ReportMap({
  model,
  result,
  separate,
  display,
  sites,
  area,
}: {
  model: Model;
  result: FilterResult;
  separate: boolean;
  /** Where the tables put each camera: the map draws no place more exactly. */
  display: CoordDisplay;
  /** Draw site dots instead of hexes. */
  sites: boolean;
  area: string[];
}) {
  const { coords, precision } = display;
  const cells = useMemo(() => siteHexes(model.sites, { coords, precision }), [model, coords, precision]);
  const hexes = useMemo(() => hexViews(model, result, separate, cells), [model, result, separate, cells]);
  const dots = useMemo(() => (sites ? siteViews(model, result, { coords, precision }) : []), [sites, model, result, coords, precision]);
  const picked = useMemo(() => selectedHexes(model, cells, area), [model, cells, area]);

  const focus: Position[] = sites
    ? (dots.some((d) => d.inView) ? dots.filter((d) => d.inView) : dots).map((d) => d.position)
    : (hexes.some((h) => h.inView) ? hexes.filter((h) => h.inView) : hexes).flatMap((h) => h.ring);
  if (!focus.length) return <p className="r-none">No camera in view has a position.</p>;

  const pts = focus.map(project);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  // At least a few cells across, so one place is not drawn as a wall of colour.
  const least = rad(cells.grid.size) * 8;
  const span = (lo: number, hi: number) => Math.max(hi - lo, least);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const scale = Math.min((W - 2 * PAD) / span(Math.min(...xs), Math.max(...xs)), (H - 2 * PAD) / span(Math.min(...ys), Math.max(...ys)));
  const at = (p: Position) => {
    const [x, y] = project(p);
    return [W / 2 + (x - cx) * scale, H / 2 - (y - cy) * scale] as const;
  };
  const points = (ring: Position[]) =>
    ring
      .slice(0, 6)
      .map((p) => at(p).map((v) => v.toFixed(1)).join(','))
      .join(' ');

  const max = Math.max(1, ...(sites ? dots.map((d) => d.detections) : hexes.map((h) => h.detections)));
  const radius = hexes.length ? Math.hypot(...[0, 1].map((i) => at(hexes[0].ring[0])[i] - at(hexes[0].center)[i])) : 0;

  // A scale bar about a fifth of the frame wide, measured at the frame's middle latitude.
  const midLat = 2 * Math.atan(Math.exp(cy)) - Math.PI / 2;
  const metresPerPx = (EARTH * Math.cos(midLat)) / scale;
  const metres = niceMetres(metresPerPx * (W / 5));
  const barPx = metres / metresPerPx;

  return (
    <svg className="rmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={sites ? 'Map of the camera sites in view' : 'Map of the hexes in view'}>
      <rect className="bg" width={W} height={H} />
      {sites
        ? dots.map((d) => {
            const [x, y] = at(d.position);
            return (
              <circle
                key={d.site}
                className={d.inView ? 'st in' : 'st out'}
                cx={x}
                cy={y}
                r={d.inView ? siteRadius(d.detections, max) : 3}
              />
            );
          })
        : hexes.map((h) => (
            <polygon
              key={h.hex}
              className={['hx', h.inView ? `s${hexStep(h.detections, max)}` : 'out', picked.has(h.hex) && 'sel'].filter(Boolean).join(' ')}
              points={points(h.ring)}
            />
          ))}
      {!sites &&
        radius >= 13 &&
        hexes
          .filter((h) => h.inView)
          .map((h) => {
            const [x, y] = at(hexCenter(cells.grid, h.hex));
            return (
              <text key={h.hex} className={`hl s${hexStep(h.detections, max)}`} x={x} y={y + 4} textAnchor="middle">
                {fmtN(h.detections)}
              </text>
            );
          })}
      <g className="scalebar" transform={`translate(${PAD} ${H - PAD})`}>
        <rect width={barPx} height={4} />
        <text y={-6}>{metres >= 1000 ? `${fmtN(metres / 1000)} km` : `${fmtN(metres)} m`}</text>
      </g>
    </svg>
  );
}
