// Data checks: problems in the files that change what the numbers mean. Each
// check is a pure function over the whole model (filters don't hide a
// problem) and returns its items; an empty list means nothing was found.

import { normalizeLocationId } from './locationIds';
import type { Model } from './model';

export type NoLocationCheck = { kind: 'no-location'; photos: number; untagged: number; years: number[] };
export type MovedCheck = { kind: 'moved'; locationId: string; pairs: number; sites: number[] };
export type NearDuplicateCheck = { kind: 'near-duplicate-ids'; ids: string[] };
export type MixedCaseCheck = { kind: 'mixed-case-ids'; ids: string[] };
export type NoCoordinatesCheck = { kind: 'no-coordinates'; site: number; deployments: number };
export type HiddenUploadsCheck = { kind: 'hidden-uploads'; collection: number; folders: string[] };
export type SharedLocationCheck = {
  kind: 'shared-location';
  ids: string[];
  spans: { collection: number; first: string | null; last: string | null }[];
};
export type BadTimestampsCheck = { kind: 'bad-timestamps'; upload: number; photos: number[] };
export type UnreadableCheck = { kind: 'unreadable'; collection: number; folder: string; file: string; message: string };
export type MissingFilesCheck = { kind: 'missing-files'; photos: number; uploads: number };
export type UncheckedFilesCheck = { kind: 'unchecked-files'; uploads: number };

export type DataCheck =
  | NoLocationCheck
  | MovedCheck
  | NearDuplicateCheck
  | MixedCaseCheck
  | NoCoordinatesCheck
  | HiddenUploadsCheck
  | SharedLocationCheck
  | BadTimestampsCheck
  | UnreadableCheck
  | MissingFilesCheck
  | UncheckedFilesCheck;

/** Photos whose location is 0000, empty or missing: kept in every count, never on the map. */
export function checkNoLocation(model: Model): NoLocationCheck[] {
  let photos = 0;
  let untagged = 0;
  const years = new Set<number>();
  for (const p of model.photos) {
    if (p.missing || !model.sites[p.site].noLocation) continue;
    photos++;
    if (!p.tagged) untagged++;
    if (p.year !== null) years.add(p.year);
  }
  return photos ? [{ kind: 'no-location', photos, untagged, years: [...years].sort() }] : [];
}

/** One location ID, in any case, at more than one coordinate pair, usually a camera that moved. Named as its row shows it. */
export function checkMoved(model: Model): MovedCheck[] {
  const byId = new Map<string, { pairs: Set<string>; sites: number[] }>();
  model.sites.forEach((s, i) => {
    if (!s.position) return;
    let entry = byId.get(s.groupKey);
    if (!entry) byId.set(s.groupKey, (entry = { pairs: new Set(), sites: [] }));
    entry.pairs.add(`${s.position.lat},${s.position.lon}`);
    entry.sites.push(i);
  });
  return [...byId.values()]
    .filter((e) => e.pairs.size > 1)
    .map((e) => ({ kind: 'moved', locationId: model.sites[e.sites[0]].displayId, pairs: e.pairs.size, sites: e.sites }));
}

/**
 * Locations whose IDs are the same after dropping punctuation (SR-07, SR07),
 * named as their rows show them. IDs that differ only in case are one
 * location already; `checkMixedCaseIds` names those.
 */
export function checkNearDuplicateIds(model: Model): NearDuplicateCheck[] {
  const byNorm = new Map<string, Set<string>>();
  for (const s of model.sites) {
    if (s.noLocation) continue;
    const norm = normalizeLocationId(s.locationId);
    if (!byNorm.has(norm)) byNorm.set(norm, new Set());
    byNorm.get(norm)!.add(s.displayId);
  }
  return [...byNorm.values()]
    .filter((ids) => ids.size > 1)
    .map((ids) => ({ kind: 'near-duplicate-ids', ids: [...ids].sort() }));
}

/** One location ID written in different case (pat26, PAT26): shown as one location, listed for whoever tidies the data. */
export function checkMixedCaseIds(model: Model): MixedCaseCheck[] {
  const byKey = new Map<string, Set<string>>();
  for (const s of model.sites) {
    if (s.noLocation) continue;
    if (!byKey.has(s.groupKey)) byKey.set(s.groupKey, new Set());
    byKey.get(s.groupKey)!.add(s.locationId);
  }
  return [...byKey.values()]
    .filter((ids) => ids.size > 1)
    .map((ids) => ({ kind: 'mixed-case-ids', ids: [...ids].sort((a, b) => a.localeCompare(b)) }));
}

/** Deployments with a location ID but no usable coordinates. */
export function checkNoCoordinates(model: Model): NoCoordinatesCheck[] {
  return model.sites.flatMap((s, site) =>
    !s.noLocation && !s.position ? [{ kind: 'no-coordinates' as const, site, deployments: s.deployments }] : [],
  );
}

/** Uploads without UploadMeta.json: incomplete, so hidden like the Tagger hides them. */
export function checkHiddenUploads(model: Model): HiddenUploadsCheck[] {
  return model.collections.flatMap((_, collection) => {
    const folders = model.hiddenUploads.filter((h) => h.collection === collection).map((h) => h.folder);
    return folders.length ? [{ kind: 'hidden-uploads' as const, collection, folders }] : [];
  });
}

/**
 * One location in more than one open collection. Informational: it can explain
 * a location whose photos seem to stop early in one collection.
 */
export function checkSharedLocations(model: Model): SharedLocationCheck[] {
  const byKey = new Map<string, { ids: Set<string>; spans: Map<number, { first: string | null; last: string | null }> }>();
  model.sites.forEach((s) => {
    if (s.noLocation) return;
    let entry = byKey.get(s.groupKey);
    if (!entry) byKey.set(s.groupKey, (entry = { ids: new Set(), spans: new Map() }));
    entry.ids.add(s.displayId);
    if (!entry.spans.has(s.collection)) entry.spans.set(s.collection, { first: null, last: null });
  });
  for (const p of model.photos) {
    const s = model.sites[p.site];
    const span = byKey.get(s.groupKey)?.spans.get(s.collection);
    if (!span || p.date === null) continue;
    if (span.first === null || p.date < span.first) span.first = p.date;
    if (span.last === null || p.date > span.last) span.last = p.date;
  }
  return [...byKey.values()]
    .filter((e) => e.spans.size > 1)
    .map((e) => ({
      kind: 'shared-location',
      ids: [...e.ids].sort(),
      spans: [...e.spans].map(([collection, span]) => ({ collection, ...span })),
    }));
}

/** Photos whose timestamp has no readable date, per upload. */
export function checkBadTimestamps(model: Model): BadTimestampsCheck[] {
  const byUpload = new Map<number, number[]>();
  model.photos.forEach((p, i) => {
    if (p.date !== null || p.missing) return;
    if (!byUpload.has(p.upload)) byUpload.set(p.upload, []);
    byUpload.get(p.upload)!.push(i);
  });
  return [...byUpload].map(([upload, photos]) => ({ kind: 'bad-timestamps', upload, photos }));
}

/** Files that could not be read; their rows are missing from every count. */
export function checkUnreadable(model: Model): UnreadableCheck[] {
  return model.problems.map((p) => ({ kind: 'unreadable', ...p }));
}

/**
 * Photos media.csv lists whose files storage doesn't have. They are left out
 * of every count until the Data checks switch shows them, so other checks
 * skip them too.
 */
export function checkMissingFiles(model: Model): MissingFilesCheck[] {
  let photos = 0;
  const uploads = new Set<number>();
  for (const p of model.photos) {
    if (!p.missing) continue;
    photos++;
    uploads.add(p.upload);
  }
  return photos ? [{ kind: 'missing-files', photos, uploads: uploads.size }] : [];
}

/** Every check, the ones that change counts most first and the case note, which changes none, last. `unchecked`: uploads whose files the last check couldn't list. */
export function dataChecks(model: Model, unchecked = 0): DataCheck[] {
  return [
    ...checkNoLocation(model),
    ...checkMissingFiles(model),
    ...(unchecked ? [{ kind: 'unchecked-files' as const, uploads: unchecked }] : []),
    ...checkUnreadable(model),
    ...checkHiddenUploads(model),
    ...checkSharedLocations(model),
    ...checkMoved(model),
    ...checkNearDuplicateIds(model),
    ...checkNoCoordinates(model),
    ...checkBadTimestamps(model),
    ...checkMixedCaseIds(model),
  ];
}
