// The photos in view as a Camtrap DP package: SPARC'd's own deployments,
// media and observations files (the v016 layout `@sparcd/camtrap` writes,
// matching Camtrap DP 0.1.6 column for column, without a header row), plus a
// datapackage.json that describes them. Positions and elevations are the ones
// the page shows before anything is written, and the description says so.
// Text that a spreadsheet would run as a formula is guarded here, on the
// explorer's rows, so the shared writers stay as the other tools use them.

import {
  serializeDeployments,
  serializeMedia,
  serializeObservations,
  type Media,
  type NullableDeployment,
  type Observation,
} from '@sparcd/camtrap';
import { precisionWords, shownElevationMetres, shownPosition, sitePosition, type CoordDisplay, type Display } from './coords';
import { formulaSafe } from './export';
import type { FilterResult } from './filters';
import type { Model } from './model';
import type { LoadedCollection } from './open';

const CAMTRAP_DP = 'https://raw.githubusercontent.com/tdwg/camtrap-dp/0.1.6';
export const CAMTRAP_PROFILE = `${CAMTRAP_DP}/camtrap-dp-profile.json`;
export const CAMTRAP_RESOURCES = ['deployments', 'media', 'observations'] as const;

export type CamtrapFacts = {
  /** Lowercase letters, digits and dashes. */
  name: string;
  title: string;
  /** ISO date and time. */
  created: string;
  contributor: string;
  /** The filters in plain words. */
  filters: string;
};

type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'GeometryCollection'; geometries: [] };

/** The area the deployments cover, from their already reduced positions. */
function spatial(deployments: NullableDeployment[]): Geometry {
  const placed = deployments.filter((d) => d.latitude !== null && d.longitude !== null);
  if (!placed.length) return { type: 'GeometryCollection', geometries: [] };
  const lats = placed.map((d) => d.latitude!);
  const lons = placed.map((d) => d.longitude!);
  const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  if (s === n && w === e) return { type: 'Point', coordinates: [w, s] };
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

/** Every text field formula-safe; numbers and flags as they are. */
const safe = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? formulaSafe(v) : v])) as T;

/** A deployment row as the package writes it: the position and elevation the page shows, in degrees and metres. */
function shownDeployment(d: NullableDeployment, display: Display): NullableDeployment {
  const pos = sitePosition(d.latitude, d.longitude);
  const at = pos && shownPosition(pos, display);
  return safe({
    ...d,
    latitude: at ? at.lat : null,
    longitude: at ? at.lon : null,
    elevation: d.elevation === null ? null : shownElevationMetres(d.elevation, display.elevation),
  });
}

function coordinateNote(d: CoordDisplay): string {
  if (d.coords === 'utm') {
    return `Coordinates in deployments.csv are the UTM positions shown (${precisionWords('utm', d.precision)}), converted back to latitude and longitude, so they are less exact than the camera positions.`;
  }
  return d.precision.digits === null
    ? 'Coordinates in deployments.csv are exact.'
    : `${precisionWords('latlon', d.precision)} in deployments.csv, so they are less exact than the camera positions.`;
}

/**
 * The package's files. Every deployment of an upload with a photo in view is
 * kept, every media row in view, and every observation row of those photos
 * except a species the filters leave out. Uploads that reuse a deployment ID
 * for a different row (a camera that moved) keep apart as `<id>#2`, `#3`, …,
 * so each photo keeps its own upload's position.
 */
export function camtrapPackage(
  model: Model,
  collections: LoadedCollection[],
  result: FilterResult,
  display: Display,
  facts: CamtrapFacts,
): Record<string, string> {
  const inView = new Set<string>();
  for (const i of result.photos) inView.add(`${model.photos[i].collection}\n${model.photos[i].key}`);
  const uploadOf = new Map(model.uploads.map((u, i) => [`${u.collection}\n${u.folder}`, i]));
  const detectionAt = new Map(model.detections.map((d, i) => [`${model.photos[d.photo].upload}\n${d.row}`, i]));
  const shown = new Set(result.detections);

  const deployments: NullableDeployment[] = [];
  const packageIds = new Map<string, string>();
  const variants = new Map<string, number>();
  /** One package deployment per distinct row as written; a later different row under the same ID gets `#2`, `#3`, … */
  const packageId = (d: NullableDeployment): string => {
    const row = shownDeployment(d, display);
    const key = JSON.stringify(row);
    let id = packageIds.get(key);
    if (id === undefined) {
      const n = (variants.get(row.deploymentId) ?? 0) + 1;
      variants.set(row.deploymentId, n);
      id = n === 1 ? row.deploymentId : `${row.deploymentId}#${n}`;
      packageIds.set(key, id);
      deployments.push({ ...row, deploymentId: id });
    }
    return id;
  };

  const media: Media[] = [];
  const observations: Observation[] = [];
  collections.forEach((c, ci) => {
    for (const u of c.uploads) {
      const mine = u.media.filter((m) => inView.has(`${ci}\n${m.mediaPath}`));
      if (!mine.length) continue;
      const ids = new Map<string, string>();
      for (const d of u.deployments) {
        const id = packageId(d);
        if (!ids.has(d.deploymentId)) ids.set(d.deploymentId, id);
      }
      // A photo belongs to its deployment ID's row, else the upload's first, as the explorer places it.
      const first = u.deployments.length ? ids.get(u.deployments[0].deploymentId) : undefined;
      const deploymentOf = new Map<string, string>();
      for (const m of mine) {
        const id = ids.get(m.deploymentId) ?? first ?? m.deploymentId;
        deploymentOf.set(m.mediaPath, id);
        media.push(safe({ ...m, deploymentId: id }));
      }
      const ui = uploadOf.get(`${ci}\n${u.folder}`);
      u.observations.forEach((o, row) => {
        const deploymentId = deploymentOf.get(o.mediaId);
        if (deploymentId === undefined) return;
        const d = detectionAt.get(`${ui}\n${row}`);
        if (d !== undefined && !shown.has(d)) return;
        // A blank placeholder row carries no count, as the uploader wrote it.
        const kept = o.observationType === 'blank' && !o.scientificName ? { ...o, count: undefined } : o;
        observations.push(safe({ ...kept, deploymentId }));
      });
    }
  });

  const dates = result.photos.map((i) => model.photos[i].date).filter((d): d is string => d !== null).sort();
  const day = facts.created.slice(0, 10);
  const taxa = [...new Set(result.detections.map((d) => model.detections[d].species))]
    .map((s) => model.species[s])
    .filter((s) => s.scientificName)
    .sort((a, b) => a.scientificName.localeCompare(b.scientificName));

  const coordinates = coordinateNote(display);
  const names = model.collections.map((c) => c.name).join(', ');
  const resource = (name: (typeof CAMTRAP_RESOURCES)[number]) => ({
    name,
    path: `${name}.csv`,
    profile: 'tabular-data-resource',
    format: 'csv',
    mediatype: 'text/csv',
    encoding: 'utf-8',
    // SPARC'd's files have no header row; columns follow the schema in order.
    dialect: { header: false },
    schema: `${CAMTRAP_DP}/${name}-table-schema.json`,
  });
  const datapackage = {
    profile: CAMTRAP_PROFILE,
    name: facts.name,
    title: facts.title,
    description: `Photos in view in SPARC'd Explorer from ${names}. ${facts.filters}. ${coordinates}`,
    created: facts.created,
    contributors: [{ title: facts.contributor, role: 'contributor' }],
    // SPARC'd does not record these; the values are the closest general ones.
    project: {
      title: names,
      samplingDesign: 'opportunistic',
      captureMethod: ['motion detection'],
      animalTypes: ['unmarked'],
      classificationLevel: 'media',
      sequenceInterval: 0,
    },
    spatial: spatial(deployments),
    temporal: { start: dates[0] ?? day, end: dates[dates.length - 1] ?? day },
    // SPARC'd species lists carry no taxon IDs.
    taxonomic: taxa.map((s) => ({
      taxonID: '',
      taxonIDReference: 'https://www.catalogueoflife.org',
      scientificName: s.scientificName,
      vernacularNames: { en: s.name },
    })),
    resources: CAMTRAP_RESOURCES.map(resource),
  };

  return {
    'deployments.csv': serializeDeployments(deployments),
    'media.csv': serializeMedia(media),
    'observations.csv': serializeObservations(observations),
    'datapackage.json': `${JSON.stringify(datapackage, null, 2)}\n`,
  };
}
