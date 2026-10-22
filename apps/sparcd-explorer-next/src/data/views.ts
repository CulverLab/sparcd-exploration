// What the views show, each derived from one `FilterResult`, so every count
// on the page agrees for the same filters.

import type { FilterResult } from './filters';
import { hexCenter, type SiteHexes } from './hex';
import { locationIdOf, locationKeyOf, type Model } from './model';
import type { Position } from './coords';
import { formatTimestamp24 } from './time';

type Grouping = { separate: boolean };

/**
 * Camera-local dates with at least one photo, per location, over the camera
 * effort population: every photo the filters keep before species.
 */
function effortDays(model: Model, result: FilterResult, { separate }: Grouping): Map<string, Set<number>> {
  const days = new Map<string, Set<number>>();
  for (const i of result.effort) {
    const p = model.photos[i];
    if (p.day === null) continue;
    const key = locationKeyOf(model.sites[p.site], separate);
    let set = days.get(key);
    if (!set) days.set(key, (set = new Set()));
    set.add(p.day);
  }
  return days;
}

export type Summary = {
  /** Locations with camera effort in view, as the Locations table lists them. */
  locations: number;
  photos: number;
  tagged: number;
  detections: number;
  species: number;
  animals: number;
  /** Camera effort: counts every photo the filters keep before species. */
  activeDays: number;
  firstDate: string | null;
  lastDate: string | null;
  topSpecies: { species: number; detections: number }[];
  byCollection: { collection: number; photos: number; tagged: number; detections: number }[];
};

export function summarize(model: Model, result: FilterResult, grouping: Grouping): Summary {
  const locations = new Set<string>();
  const byCollection = model.collections.map((_, collection) => ({ collection, photos: 0, tagged: 0, detections: 0 }));
  let tagged = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const i of result.effort) locations.add(locationKeyOf(model.sites[model.photos[i].site], grouping.separate));
  for (const i of result.photos) {
    const p = model.photos[i];
    byCollection[p.collection].photos++;
    if (p.tagged) {
      tagged++;
      byCollection[p.collection].tagged++;
    }
    if (p.date !== null) {
      if (firstDate === null || p.date < firstDate) firstDate = p.date;
      if (lastDate === null || p.date > lastDate) lastDate = p.date;
    }
  }
  const perSpecies = new Map<number, number>();
  let animals = 0;
  for (const d of result.detections) {
    const det = model.detections[d];
    perSpecies.set(det.species, (perSpecies.get(det.species) ?? 0) + 1);
    animals += det.count;
    byCollection[det.collection].detections++;
  }
  return {
    locations: locations.size,
    photos: result.photos.length,
    tagged,
    detections: result.detections.length,
    species: perSpecies.size,
    animals,
    activeDays: [...effortDays(model, result, grouping).values()].reduce((n, d) => n + d.size, 0),
    firstDate,
    lastDate,
    topSpecies: [...perSpecies]
      .map(([species, detections]) => ({ species, detections }))
      .sort(
        (a, b) =>
          b.detections - a.detections || model.species[a.species].name.localeCompare(model.species[b.species].name),
      ),
    byCollection,
  };
}

export type LocationRow = {
  key: string;
  ids: string[];
  name: string;
  noLocation: boolean;
  collections: number[];
  sites: number[];
  /** The position of the site photographed most recently; null for no location. */
  position: Position | null;
  elevation: number | null;
  range: string;
  photos: number;
  tagged: number;
  detections: number;
  species: number;
  firstDate: string | null;
  lastDate: string | null;
  activeDays: number;
};

/**
 * One row per location with at least one photo in the camera-effort
 * population (every filter but species), so a location's active days count
 * whatever species is picked and the rows add up to the summary. Its
 * species-dependent columns can then read 0.
 */
export function locationRows(model: Model, result: FilterResult, grouping: Grouping): LocationRow[] {
  type Tally = {
    sites: Set<number>;
    photos: number;
    tagged: number;
    detections: number;
    species: Set<number>;
    first: string | null;
    last: string | null;
  };
  const tallies = new Map<string, Tally>();
  const tallyOf = (site: number) => {
    const key = locationKeyOf(model.sites[site], grouping.separate);
    let t = tallies.get(key);
    if (!t) {
      t = {
        sites: new Set(),
        photos: 0,
        tagged: 0,
        detections: 0,
        species: new Set(),
        first: null,
        last: null,
      };
      tallies.set(key, t);
    }
    t.sites.add(site);
    return t;
  };
  for (const i of result.effort) tallyOf(model.photos[i].site);
  for (const i of result.photos) {
    const p = model.photos[i];
    const t = tallyOf(p.site);
    t.photos++;
    if (p.tagged) t.tagged++;
    if (p.date !== null) {
      if (t.first === null || p.date < t.first) t.first = p.date;
      if (t.last === null || p.date > t.last) t.last = p.date;
    }
  }
  for (const d of result.detections) {
    const det = model.detections[d];
    const t = tallyOf(model.photos[det.photo].site);
    t.detections++;
    t.species.add(det.species);
  }
  const days = effortDays(model, result, grouping);
  const lastDay = (site: number) => model.sites[site].lastDay ?? -Infinity;
  return [...tallies].map(([key, t]) => {
    const sites = [...t.sites];
    // A moved camera shows at the position it was photographed from last.
    const shown = model.sites[sites.reduce((best, s) => (lastDay(s) > lastDay(best) ? s : best))];
    return {
      key,
      ids: [...new Set(sites.map((s) => locationIdOf(model.sites[s], grouping.separate)))].sort(),
      name: shown.name,
      noLocation: shown.noLocation,
      collections: [...new Set(sites.map((s) => model.sites[s].collection))],
      sites,
      position: shown.position,
      elevation: shown.elevation,
      range: shown.range,
      photos: t.photos,
      tagged: t.tagged,
      detections: t.detections,
      species: t.species.size,
      firstDate: t.first,
      lastDate: t.last,
      activeDays: days.get(key)?.size ?? 0,
    };
  });
}

export type SpeciesRow = {
  species: number;
  detections: number;
  photos: number;
  animals: number;
  locations: number;
  firstDate: string | null;
  lastDate: string | null;
};

export function speciesRows(model: Model, result: FilterResult, grouping: Grouping): SpeciesRow[] {
  const rows = new Map<number, SpeciesRow & { photoSet: Set<number>; locationSet: Set<string> }>();
  for (const d of result.detections) {
    const det = model.detections[d];
    let row = rows.get(det.species);
    if (!row) {
      row = {
        species: det.species,
        detections: 0,
        photos: 0,
        animals: 0,
        locations: 0,
        firstDate: null,
        lastDate: null,
        photoSet: new Set(),
        locationSet: new Set(),
      };
      rows.set(det.species, row);
    }
    const photo = model.photos[det.photo];
    row.detections++;
    row.animals += det.count;
    row.photoSet.add(det.photo);
    row.locationSet.add(locationKeyOf(model.sites[photo.site], grouping.separate));
    if (photo.date !== null) {
      if (row.firstDate === null || photo.date < row.firstDate) row.firstDate = photo.date;
      if (row.lastDate === null || photo.date > row.lastDate) row.lastDate = photo.date;
    }
  }
  return [...rows.values()]
    .map(({ photoSet, locationSet, ...row }) => ({ ...row, photos: photoSet.size, locations: locationSet.size }))
    .sort((a, b) => b.detections - a.detections);
}

export type PhotoRow = {
  photo: number;
  fileName: string;
  /** 24-hour camera-local time as stored. */
  time: string;
  date: string | null;
  /** Common names of the species shown on this photo, without removed or corrected-away ones. */
  species: string;
  scientificNames: string;
  /** Animals counted across the species shown. */
  count: number;
  locationId: string;
  locationName: string;
  collection: string;
  tagged: boolean;
  video: boolean;
};

/** One row per photo, its species joined. `detections` limits the species to those in view. */
export function photoRows(model: Model, photos: number[], detections?: number[], grouping: Grouping = { separate: false }): PhotoRow[] {
  // Built for hundreds of thousands of photos: a mark per detection rather
  // than a set, and no set per row for the one or two species most photos have.
  let shown: Uint8Array | null = null;
  if (detections) {
    shown = new Uint8Array(model.detections.length);
    for (const d of detections) shown[d] = 1;
  }
  const collections = model.collections.map((c) => c.name);
  return photos.map((i) => {
    const p = model.photos[i];
    const site = model.sites[p.site];
    const names: string[] = [];
    const scientific: string[] = [];
    let count = 0;
    for (const d of p.detections) {
      if (shown && !shown[d]) continue;
      const det = model.detections[d];
      const sp = model.species[det.species];
      if (!names.includes(sp.name)) names.push(sp.name);
      if (sp.scientificName && !scientific.includes(sp.scientificName)) scientific.push(sp.scientificName);
      count += det.count;
    }
    return {
      photo: i,
      fileName: p.fileName,
      time: formatTimestamp24(p.timestamp),
      date: p.date,
      species: names.join(', '),
      scientificNames: scientific.join(', '),
      count,
      locationId: locationIdOf(site, grouping.separate),
      locationName: site.name,
      collection: collections[p.collection],
      tagged: p.tagged,
      video: p.video,
    };
  });
}

export type DetectionRow = {
  detection: number;
  photo: number;
  fileName: string;
  /** The photo's 24-hour camera-local time as stored. */
  time: string;
  date: string | null;
  species: string;
  scientificName: string;
  count: number;
  locationId: string;
  locationName: string;
  collection: string;
};

/** One row per species tag. */
export function detectionRows(model: Model, detections: number[], grouping: Grouping = { separate: false }): DetectionRow[] {
  return detections.map((d) => {
    const det = model.detections[d];
    const p = model.photos[det.photo];
    const site = model.sites[p.site];
    const species = model.species[det.species];
    return {
      detection: d,
      photo: det.photo,
      fileName: p.fileName,
      time: formatTimestamp24(p.timestamp),
      date: p.date,
      species: species.name,
      scientificName: species.scientificName,
      count: det.count,
      locationId: locationIdOf(site, grouping.separate),
      locationName: site.name,
      collection: model.collections[p.collection].name,
    };
  });
}

export type HexBin = {
  hex: string;
  center: Position;
  sites: number[];
  locationIds: string[];
  locationNames: string[];
  photos: number;
  tagged: number;
  /** Distinct species among the detections in view. */
  richness: number;
};

/** Photos in view per hex cell. Sites without a position (and no-location photos) have no cell. */
export function hexBins(model: Model, result: FilterResult, hexes: SiteHexes): HexBin[] {
  const bins = new Map<string, HexBin & { speciesSet: Set<number> }>();
  const binOf = (site: number) => {
    const s = model.sites[site];
    const hex = hexes.cells[site];
    if (!hex) return null;
    let bin = bins.get(hex);
    if (!bin) {
      bin = {
        hex,
        center: hexCenter(hexes.grid, hex),
        sites: [],
        locationIds: [],
        locationNames: [],
        photos: 0,
        tagged: 0,
        richness: 0,
        speciesSet: new Set(),
      };
      bins.set(hex, bin);
    }
    if (!bin.sites.includes(site)) {
      bin.sites.push(site);
      bin.locationIds.push(s.locationId);
      bin.locationNames.push(s.name);
    }
    return bin;
  };
  for (const i of result.photos) {
    const p = model.photos[i];
    const bin = binOf(p.site);
    if (!bin) continue;
    bin.photos++;
    if (p.tagged) bin.tagged++;
  }
  for (const d of result.detections) {
    const det = model.detections[d];
    binOf(model.photos[det.photo].site)?.speciesSet.add(det.species);
  }
  return [...bins.values()].map(({ speciesSet, ...bin }) => ({ ...bin, richness: speciesSet.size }));
}
