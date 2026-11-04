// The six basemaps of the old explorer, with its tile URLs and credit lines.
// OpenStreetMap and Carto Light were plotly styles there; these are their
// raster tiles.

export type BasemapLayer = { url: string; maxNativeZoom: number; opacity?: number; subdomains?: string };
export type Basemap = { id: string; name: string; credit: string; layers: BasemapLayer[] };

const ARCGIS = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const NATIONAL_MAP = 'https://basemap.nationalmap.gov/arcgis/rest/services';

export const BASEMAPS: Basemap[] = [
  {
    id: 'topo',
    name: 'USGS Topo',
    credit: 'USGS The National Map',
    layers: [{ url: `${NATIONAL_MAP}/USGSTopo/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 }],
  },
  {
    id: 'imagery',
    name: 'Esri Imagery',
    credit: 'Esri World Imagery',
    layers: [{ url: `${ARCGIS}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 18 }],
  },
  {
    id: 'relief',
    name: 'Shaded relief',
    credit: 'USGS 3DEP Shaded Relief · Esri',
    layers: [
      { url: `${NATIONAL_MAP}/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
      { url: `${ARCGIS}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 18, opacity: 0.55 },
      {
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maxNativeZoom: 18,
      },
    ],
  },
  {
    id: 'steward',
    name: 'Stewardship',
    credit: 'Esri World Topographic Map',
    layers: [{ url: `${ARCGIS}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 18 }],
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    credit: '© OpenStreetMap contributors',
    layers: [{ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNativeZoom: 19 }],
  },
  {
    id: 'carto',
    name: 'Carto Light',
    credit: '© OpenStreetMap contributors · © CARTO',
    layers: [{ url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', maxNativeZoom: 19, subdomains: 'abcd' }],
  },
];

export const DEFAULT_BASEMAP = 'topo';
export const basemapOf = (id: string): Basemap => BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];

/** A basemap tile placed in a map frame's own pixels. */
export type PlacedTile = { url: string; x: number; y: number; size: number };

const TAU = 2 * Math.PI;

function tileUrl(layer: BasemapLayer, z: number, x: number, y: number): string {
  const sub = layer.subdomains ? layer.subdomains[(x + y) % layer.subdomains.length] : '';
  return layer.url
    .replace('{s}', sub)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}

/**
 * The tiles of a layer covering a Web Mercator frame: `width` by `height` pixels,
 * centred on `cx`, `cy` in radians, at `scale` pixels per radian. The zoom is the
 * one that draws a tile closest to its own 256 pixels.
 */
export function tilesInFrame(
  layer: BasemapLayer,
  { cx, cy, scale, width, height }: { cx: number; cy: number; scale: number; width: number; height: number },
): PlacedTile[] {
  const z = Math.min(layer.maxNativeZoom, Math.max(0, Math.round(Math.log2((scale * TAU) / 256))));
  const n = 2 ** z;
  const column = (x: number) => Math.floor(((x + Math.PI) / TAU) * n);
  const row = (y: number) => Math.floor(((Math.PI - y) / TAU) * n);
  const tiles: PlacedTile[] = [];
  for (let j = Math.max(0, row(cy + height / 2 / scale)); j <= Math.min(n - 1, row(cy - height / 2 / scale)); j++) {
    for (let i = column(cx - width / 2 / scale); i <= column(cx + width / 2 / scale); i++) {
      tiles.push({
        url: tileUrl(layer, z, ((i % n) + n) % n, j),
        x: width / 2 + ((i / n) * TAU - Math.PI - cx) * scale,
        y: height / 2 - (Math.PI - (j / n) * TAU - cy) * scale,
        size: (TAU / n) * scale,
      });
    }
  }
  return tiles;
}
