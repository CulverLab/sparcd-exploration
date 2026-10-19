// The photos in view as a Camtrap DP package: SPARC'd's own deployments,
// media and observations files (the v016 layout `@sparcd/camtrap` writes,
// matching Camtrap DP 0.1.6 column for column, without a header row), plus a
// datapackage.json that describes them. Coordinates are cut to the display
// precision before anything is written, and the description says so.

import {
  serializeDeployments,
  serializeMedia,
  serializeObservations,
  type Media,
  type NullableDeployment,
  type Observation,
} from '@sparcd/camtrap';
import { reduceDegrees, precisionWords, type Precision } from './coords';
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

/**
 * The package's files. Every deployment of an upload with a photo in view is
 * kept (one per deployment ID, the latest upload's), every media row in view,
 * and every observation row of those photos except a species the filters
 * leave out.
 */
export function camtrapPackage(
  model: Model,
  collections: LoadedCollection[],
  result: FilterResult,
  precision: Precision,
  facts: CamtrapFacts,
): Record<string, string> {
  const inView = new Set<string>();
  for (const i of result.photos) inView.add(`${model.photos[i].collection}\n${model.photos[i].key}`);
  const uploadOf = new Map(model.uploads.map((u, i) => [`${u.collection}\n${u.folder}`, i]));
  const detectionAt = new Map(model.detections.map((d, i) => [`${model.photos[d.photo].upload}\n${d.row}`, i]));
  const shown = new Set(result.detections);

  const deployments = new Map<string, NullableDeployment>();
  const media: Media[] = [];
  const observations: Observation[] = [];
  collections.forEach((c, ci) => {
    for (const u of c.uploads) {
      const mine = u.media.filter((m) => inView.has(`${ci}\n${m.mediaPath}`));
      if (!mine.length) continue;
      media.push(...mine);
      for (const d of u.deployments) {
        deployments.set(d.deploymentId, {
          ...d,
          latitude: d.latitude === null ? null : reduceDegrees(d.latitude, precision),
          longitude: d.longitude === null ? null : reduceDegrees(d.longitude, precision),
        });
      }
      const ui = uploadOf.get(`${ci}\n${u.folder}`);
      u.observations.forEach((o, row) => {
        if (!inView.has(`${ci}\n${o.mediaId}`)) return;
        const d = detectionAt.get(`${ui}\n${row}`);
        if (d !== undefined && !shown.has(d)) return;
        // A blank placeholder row carries no count, as the uploader wrote it.
        observations.push(o.observationType === 'blank' && !o.scientificName ? { ...o, count: undefined } : o);
      });
    }
  });

  const dates = result.photos.map((i) => model.photos[i].date).filter((d): d is string => d !== null).sort();
  const day = facts.created.slice(0, 10);
  const taxa = [...new Set(result.detections.map((d) => model.detections[d].species))]
    .map((s) => model.species[s])
    .filter((s) => s.scientificName)
    .sort((a, b) => a.scientificName.localeCompare(b.scientificName));

  const coordinates =
    precision.digits === null
      ? 'Coordinates in deployments.csv are exact.'
      : `${precisionWords('latlon', precision)} in deployments.csv, so they are less exact than the camera positions.`;
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
    spatial: spatial([...deployments.values()]),
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
    'deployments.csv': serializeDeployments([...deployments.values()]),
    'media.csv': serializeMedia(media),
    'observations.csv': serializeObservations(observations),
    'datapackage.json': `${JSON.stringify(datapackage, null, 2)}\n`,
  };
}
