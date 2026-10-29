import type { Deployment } from '@sparcd/camtrap';
import type { DraftRecord, DraftObservation } from './db';
import type { EditChange } from './editLifecycle';
import type { TagImage } from './workspace';
import type { S3Config } from '@sparcd/types';

export type ValueChange = {
  path: string;
  field: 'species' | 'time' | 'expert' | 'location' | 'timestampSource';
  species?: string;
  before: DraftObservation | string | boolean | Deployment | null;
  after: DraftObservation | string | boolean | Deployment | null;
};
export type EditAction = {
  id: string;
  user: string;
  at: string;
  changes: ValueChange[];
  undoOf?: string;
  records?: Record<string, DraftRecord>;
  timeZone?: string;
  locationPatch?: import('./canonicalPatch').CanonicalPatch[];
  locationBefore?: { canonical: import('./sync').CanonicalState; drafts: Record<string, DraftRecord>; location: Deployment | null; offset: import('./db').TimeOffsetRecord | null };
};
export type AutomaticRecord = {
  id: string;
  scope: string;
  bucket: string;
  uploadPrefix: string;
  collectionKey: string;
  actions: EditAction[];
  undo: EditAction | null;
  pendingDrafts?: Record<string, DraftRecord>;
  undoReason?: string;
  flight?: { ids: string[]; user: string; undoOf?: string };
  /** Explicit migration/adoption is required for unscoped legacy state. */
  adoptionRequired?: boolean;
  /** Conflict review remains required after reload or a network outage. */
  conflictReason?: string;
  reviewLegacyAfterFlight?: boolean;
  version?: number;
  archivedJournals?: import('./syncJournal').SyncJournal[];
  recoveryBranches?: AutomaticRecord[];
};
export function accountScope(cfg: S3Config): string {
  const raw = cfg.endpoint.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `${cfg.secure === false ? 'http' : 'https'}://${raw}`);
  return JSON.stringify([url.href.replace(/\/+$/, ''), cfg.accessKey.trim(), cfg.region, cfg.forcePathStyle]);
}
export const automaticId = (scope: string, bucket: string, prefix: string) => JSON.stringify([scope, bucket, prefix]);
export const equalValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function actionChanges(change: EditChange, images: TagImage[], location: Deployment | null): ValueChange[] {
  const out: ValueChange[] = [];
  for (const [path, after] of Object.entries(change.after)) {
    const before = change.before[path];
    const image = images.find(i => i.key === path);
    for (const species of new Set([...before.observations, ...after.observations].map(o => o.scientificName))) {
      const a = before.observations.find(o => o.scientificName === species) ?? null;
      const b = after.observations.find(o => o.scientificName === species) ?? null;
      if (!equalValue(a, b)) out.push({ path, field: 'species', species, before: a, after: b });
    }
    const a = before.timeOverride ?? image?.baseTimestamp ?? '';
    const b = after.timeOverride ?? image?.baseTimestamp ?? '';
    if (a !== b) {
      out.push({ path, field: 'time', before: a, after: b });
      const source = before.timeSourceOverride ?? (before.timeOverride !== null && image?.timestampSource ? 'manual' : image?.timestampSource);
      if (source && source !== 'manual') out.push({ path, field: 'timestampSource', before: source, after: 'manual' });
    }
    if (before.questionable !== after.questionable) out.push({ path, field: 'expert', before: before.questionable, after: after.questionable });
  }
  if (change.location && !equalValue(change.location.before ?? location, change.location.after ?? location)) {
    out.push({ path: '', field: 'location', before: change.location.before ?? location, after: change.location.after ?? location });
  }
  return out;
}
export function canonicalValue(field: ValueChange, images: TagImage[], location: Deployment | null): ValueChange['after'] {
  if (field.field === 'location') return location;
  const image = images.find(i => i.key === field.path);
  if (!image) throw new Error('An affected image no longer exists. Review the current remote upload.');
  if (field.field === 'species') return image.baseObservations.find(o => o.scientificName === field.species) ?? null;
  return field.field === 'time' ? image.baseTimestamp : field.field === 'timestampSource' ? image.timestampSource ?? null : !!image.baseQuestionable;
}
export function undoMatches(action: EditAction, images: TagImage[], location: Deployment | null): boolean {
  return action.changes.every(field => (field.field === 'location' || images.some(image => image.key === field.path)) && equalValue(canonicalValue(field, images, location), field.after));
}

/** Remove only events already submitted, retaining events made during a save. */
export function rebaseDraft(current: DraftRecord, submitted: DraftRecord, canonical: TagImage): DraftRecord {
  const observations = current.observations.map(o => {
    const written = submitted.observations.find(p => p.scientificName === o.scientificName);
    const base = canonical.baseObservations.find(p => p.scientificName === o.scientificName);
    const reviews = (o.reviewEvents ?? []).filter(event => !(written?.reviewEvents ?? []).some(e => equalValue(e, event)));
    return { ...o, reviewEvents: [...(base?.reviewEvents ?? []), ...reviews] };
  });
  return { ...current, observations, confirmedSpecies: observations.filter(o => o.reviewEvents?.some(e => !(canonical.baseObservations.find(p => p.scientificName === o.scientificName)?.reviewEvents ?? []).some(p => equalValue(p, e)))).map(o => o.scientificName),
    removedSpecies: (current.removedSpecies ?? []).filter(name => canonical.baseObservations.some(o => o.scientificName === name)),
    baseQuestionable: !!canonical.baseQuestionable,
  };
}
