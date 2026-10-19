// The model every view reads, built once per load from the opened
// collections. Rows point at each other by index. Every row carries its
// collection.
//
// A site is one camera position as the files describe it: (collection,
// location ID, name, coordinates). A location is what the tables show: by
// default every site sharing the exact location ID (across collections) is one
// location; with "Show each location ID separately" on, each site is its own
// location. IDs that differ only in case or punctuation stay apart; the
// near-duplicate data check names them.

import { commonNameFromComments } from '@sparcd/camtrap';
import type { NullableDeployment } from '@sparcd/camtrap';
import type { ReadProblem } from './cache';
import { sitePosition, type Position } from './coords';
import { isNoLocation, mountainRange } from './locationIds';
import { registryKey, type RegistryLocation } from './locations';
import type { LoadedCollection } from './open';
import { speciesNamer, type Species, type SpeciesName } from './species';
import { parseLocalTimestamp } from './time';

export const NO_LOCATION_NAME = 'No location set';
export const NO_LOCATION_KEY = 'none';

export type CollectionInfo = { key: string; name: string; bucket: string; uuid: string };

export type Upload = { collection: number; folder: string; stamp: string; user: string; date: string | null };

export type Site = {
  key: string;
  collection: number;
  locationId: string;
  /** Location ID 0000 or empty: kept in every count, never placed on the map. */
  noLocation: boolean;
  name: string;
  position: Position | null;
  elevation: number | null; // metres
  range: string;
  /** The location this site belongs to while IDs are grouped. */
  groupKey: string;
  deployments: number;
  lastDay: number | null;
};

export type Photo = {
  collection: number;
  upload: number;
  site: number;
  key: string; // object key, = media.csv col 0
  fileName: string;
  mimeType: string;
  video: boolean;
  timestamp: string;
  /** Camera-local date, or null when the timestamp doesn't parse. */
  date: string | null;
  day: number | null;
  year: number | null;
  month: number | null;
  hour: number | null;
  /** At least one observation names a species. Placeholders and removal-only rows don't. */
  tagged: boolean;
  detections: number[];
  /** What people wrote on the photo and its tags, without the tools' `[PREFIX:value]` markers. */
  comments: string;
};

/** One species tag on one photo. `row` is its line in the upload's observations. */
export type Detection = { collection: number; photo: number; species: number; count: number; row: number };

export type Model = {
  collections: CollectionInfo[];
  uploads: Upload[];
  sites: Site[];
  species: SpeciesName[];
  photos: Photo[];
  detections: Detection[];
  hiddenUploads: { collection: number; folder: string }[];
  problems: (ReadProblem & { collection: number })[];
  dateSpan: { first: string; last: string } | null;
};

/** The location a site counts under. */
export function locationKeyOf(site: Site, separate: boolean): string {
  return separate ? site.key : site.groupKey;
}

const NO_DETECTIONS: number[] = [];
const MARKER = /\[[A-Z0-9_]+:[^\]]*\]/g;

/** Free text from a comments field, without the tools' `[PREFIX:value]` markers. */
export function commentText(raw: string | undefined): string {
  return raw ? raw.replace(MARKER, ' ').replace(/\s+/g, ' ').trim() : '';
}

const addComment = (photo: Photo, raw: string | undefined) => {
  const text = commentText(raw);
  if (text && !photo.comments.split(' · ').includes(text)) photo.comments = photo.comments ? `${photo.comments} · ${text}` : text;
};
const VIDEO = /^video\/|\.(mp4|mov|avi)$/i;

function stampOf(folder: string): string {
  return folder.replace(/\/$/, '').split('/').pop() ?? folder;
}

export function buildModel(
  collections: LoadedCollection[],
  opts: { species?: Species[][]; registry?: RegistryLocation[] } = {},
): Model {
  const nameSpecies = speciesNamer(...(opts.species ?? []));
  const registry = new Map((opts.registry ?? []).map((l) => [l.key, l]));
  const sites: Site[] = [];
  const siteIndex = new Map<string, number>();
  const elevations: number[][] = [];
  const speciesIndex = new Map<string, number>();
  const m: Omit<Model, 'dateSpan'> = {
    collections: [],
    uploads: [],
    sites,
    species: [],
    photos: [],
    detections: [],
    hiddenUploads: [],
    problems: [],
  };

  const addSite = (site: Omit<Site, 'deployments' | 'elevation' | 'lastDay'>): number => {
    let i = siteIndex.get(site.key);
    if (i === undefined) {
      i = sites.push({ ...site, deployments: 0, elevation: null, lastDay: null }) - 1;
      siteIndex.set(site.key, i);
      elevations[i] = [];
    }
    return i;
  };
  const noLocationSite = (ci: number) =>
    addSite({
      key: `${m.collections[ci].key}|0000`,
      collection: ci,
      locationId: '0000',
      noLocation: true,
      name: NO_LOCATION_NAME,
      position: null,
      range: '',
      groupKey: NO_LOCATION_KEY,
    });
  const deploymentSite = (ci: number, d: NullableDeployment): number => {
    const id = d.locationId.trim();
    if (isNoLocation(id)) return noLocationSite(ci);
    const position = sitePosition(d.latitude, d.longitude);
    const listed = position && registry.get(registryKey(id, position.lat, position.lon));
    const name = d.locationName.trim() || listed?.name || '';
    const i = addSite({
      key: `${m.collections[ci].key}|${id}|${name}|${position ? `${position.lat},${position.lon}` : ''}`,
      collection: ci,
      locationId: id,
      noLocation: false,
      name,
      position,
      range: mountainRange(id),
      groupKey: `id:${id}`,
    });
    const elevation = d.elevation ?? listed?.elevation;
    if (elevation != null) elevations[i].push(elevation);
    return i;
  };

  collections.forEach((c, ci) => {
    m.collections.push({ key: c.ref.key, name: c.ref.name ?? c.ref.bucket, bucket: c.ref.bucket, uuid: c.ref.uuid });
    for (const folder of c.hiddenUploads) m.hiddenUploads.push({ collection: ci, folder });
    for (const p of c.problems) m.problems.push({ ...p, collection: ci });

    for (const u of c.uploads) {
      const meta = u.meta?.uploadDate?.date;
      const ui =
        m.uploads.push({
          collection: ci,
          folder: u.folder,
          stamp: stampOf(u.folder),
          user: u.meta?.uploadUser ?? '',
          date: meta ? `${meta.year}-${String(meta.month).padStart(2, '0')}-${String(meta.day).padStart(2, '0')}` : null,
        }) - 1;

      // By convention an upload has one deployment row; media match it by
      // deployment ID, else take the upload's first row.
      const siteOfDeployment = new Map<string, number>();
      for (const d of u.deployments) {
        const si = deploymentSite(ci, d);
        sites[si].deployments++;
        if (!siteOfDeployment.has(d.deploymentId)) siteOfDeployment.set(d.deploymentId, si);
      }
      const firstSite = u.deployments.length ? siteOfDeployment.get(u.deployments[0].deploymentId) : undefined;

      const photoOfKey = new Map<string, number>();
      for (const media of u.media) {
        const site = siteOfDeployment.get(media.deploymentId) ?? firstSite ?? noLocationSite(ci);
        const t = parseLocalTimestamp(media.timestamp);
        photoOfKey.set(
          media.mediaPath,
          m.photos.push({
            collection: ci,
            upload: ui,
            site,
            key: media.mediaPath,
            fileName: media.fileName || (media.mediaPath.split('/').pop() ?? ''),
            mimeType: media.mimeType,
            video: VIDEO.test(media.mimeType) || VIDEO.test(media.mediaPath),
            timestamp: media.timestamp,
            date: t?.date ?? null,
            day: t?.day ?? null,
            year: t?.year ?? null,
            month: t?.month ?? null,
            hour: t?.hour ?? null,
            tagged: false,
            detections: NO_DETECTIONS,
            comments: commentText(media.comments),
          }) - 1,
        );
      }

      u.observations.forEach((o, row) => {
        const pi = photoOfKey.get(o.mediaId);
        if (pi === undefined) return;
        addComment(m.photos[pi], o.tags);
        // Removal and correction markers never name a present species; only
        // the row's own species does (#467).
        const named = nameSpecies(o.scientificName, commonNameFromComments(o.tags));
        if (!named) return;
        let si = speciesIndex.get(named.key);
        if (si === undefined) {
          si = m.species.push(named) - 1;
          speciesIndex.set(named.key, si);
        }
        const count = Number.isFinite(o.count) ? o.count! : 0;
        const di = m.detections.push({ collection: ci, photo: pi, species: si, count, row }) - 1;
        const photo = m.photos[pi];
        if (photo.detections === NO_DETECTIONS) photo.detections = [];
        photo.detections.push(di);
        photo.tagged = true;
      });
    }
  });

  sites.forEach((site, i) => {
    const e = elevations[i];
    if (e.length) site.elevation = Math.round(e.reduce((a, b) => a + b, 0) / e.length);
  });
  let first: string | null = null;
  let last: string | null = null;
  for (const p of m.photos) {
    if (p.date === null) continue;
    if (first === null || p.date < first) first = p.date;
    if (last === null || p.date > last) last = p.date;
    const site = sites[p.site];
    if (site.lastDay === null || p.day! > site.lastDay) site.lastDay = p.day;
  }
  return { ...m, dateSpan: first && last ? { first, last } : null };
}
