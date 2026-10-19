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
