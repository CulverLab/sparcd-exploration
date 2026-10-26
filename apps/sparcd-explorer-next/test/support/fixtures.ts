// Synthetic collections for model, filter and check tests. Every ID, name and
// coordinate here is made up.

import type { Media, NullableDeployment, Observation } from '@sparcd/camtrap';
import type { CollectionRef } from '@sparcd/s3-safe';
import {
  NO_FILTERS,
  applyFilters,
  buildModel,
  hexBins,
  siteHexes,
  type FilterResult,
  type FilterState,
  type LoadedCollection,
  type LoadedUpload,
  type Model,
  type Precision,
  type Species,
} from '../../src/data';
import { sitesInHexes } from '../../src/lib/mapData';

export function collectionRef(name = 'Test', uuid = 'test'): CollectionRef {
  return { key: `sparcd-${uuid}::${uuid}`, bucket: `sparcd-${uuid}`, uuid, name, organization: null, contact: null, description: null };
}

const PREFIX = 'Collections/test/Uploads/';
export const mediaPath = (upload: string, file: string) => `${PREFIX}${upload}/${file}`;

export function deployment(
  site: string,
  name: string,
  lat: number | null,
  lon: number | null,
  elevation: number | null = 1000,
): NullableDeployment {
  return {
    deploymentId: `test:${site}`,
    locationId: site,
    locationName: name,
    latitude: lat,
    longitude: lon,
    elevation,
    timestampIssues: false,
  };
}

export function media(upload: string, file: string, site: string, timestamp = '', mimeType = 'image/jpeg'): Media {
  const path = mediaPath(upload, file);
  return { mediaId: path, deploymentId: `test:${site}`, mediaPath: path, fileName: file, timestamp, mimeType, comments: '' };
}

/** An identification when `common` or `scientific` is set, else a placeholder row. */
export function observation(
  upload: string,
  file: string,
  site: string,
  timestamp = '',
  opts: { common?: string; scientific?: string; count?: number; tags?: string } = {},
): Observation {
  const named = Boolean(opts.common || opts.scientific);
  return {
    observationId: `${upload}/${file}:${opts.scientific ?? opts.common ?? ''}`,
    mediaId: mediaPath(upload, file),
    deploymentId: `test:${site}`,
    timestamp,
    observationType: named ? 'animal' : 'blank',
    scientificName: opts.scientific ?? '',
    count: opts.count ?? (named ? 1 : 0),
    tags: (opts.common ? `[COMMONNAME:${opts.common}]` : '') + (opts.tags ?? ''),
  };
}

type Rows = { deployments?: NullableDeployment[]; media?: Media[]; observations?: Observation[] };

/** Builds a `LoadedCollection` the way the opener returns one. */
export class CollectionBuilder {
  private uploads: LoadedUpload[] = [];
  private hidden: string[] = [];

  constructor(readonly ref: CollectionRef = collectionRef()) {}

  upload(name: string, rows: Rows = {}): this {
    this.uploads.push({
      folder: `Collections/${this.ref.uuid}/Uploads/${name}/`,
      etags: {},
      meta: null,
      deployments: rows.deployments ?? [],
      media: rows.media ?? [],
      observations: rows.observations ?? [],
    });
    return this;
  }

  hide(name: string): this {
    this.hidden.push(`Collections/${this.ref.uuid}/Uploads/${name}/`);
    return this;
  }

  build(): LoadedCollection {
    return { ref: this.ref, uploads: this.uploads, hiddenUploads: this.hidden, problems: [], changed: true, checkedAt: 0 };
  }
}

export const collection = (name?: string, uuid?: string) => new CollectionBuilder(collectionRef(name, uuid));

/** `missing`: photo files storage lacks, as `bucket/key`. */
export function modelOf(
  collections: CollectionBuilder | CollectionBuilder[],
  opts: { species?: Species[]; missing?: string[] } = {},
): Model {
  const list = Array.isArray(collections) ? collections : [collections];
  return buildModel(
    list.map((c) => c.build()),
    { species: opts.species ? [opts.species] : [], missing: new Set(opts.missing) },
  );
}

export function filter(model: Model, state: Partial<FilterState> = {}) {
  return applyFilters(model, { ...NO_FILTERS, ...state });
}

export const fileNames = (model: Model, photos: number[]) => photos.map((i) => model.photos[i].fileName).sort();

export const siteNamed = (model: Model, name: string) => model.sites.findIndex((s) => s.name === name);

export const EXACT: Precision = { method: 'round', digits: null };
/** Every site's cell, at full precision unless another is given. */
export const cellsOf = (model: Model, precision: Precision = EXACT) => siteHexes(model.sites, { coords: 'latlon', precision });
export const hexOfSite = (model: Model, site: number) => cellsOf(model).cells[site]!;
/** The Area filter a click on one cell sets. */
export const areaOfHex = (model: Model, hex: string) => sitesInHexes(model, cellsOf(model), [hex]);
export const binsOf = (model: Model, result: FilterResult) => hexBins(model, result, cellsOf(model));

export function species(commonName: string, scientificName: string): Species {
  return { key: scientificName, commonName, scientificName, iconUrl: '', keyBinding: null };
}
