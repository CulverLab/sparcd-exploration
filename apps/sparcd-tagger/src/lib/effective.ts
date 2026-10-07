// What's actually shown for one image: the local draft wins over the canonical
// base it was grounded on. Shared by the Overview cells and the Focus view so
// both read tags the same way.

import type { TagImage } from './workspace';
import type { DraftRecord, DraftObservation } from './db';

export type ReviewStatus = 'reviewed' | 'unreviewed';
export type ReviewSummary = ReviewStatus | 'mixed';

/** An identification is reviewed only when a review event was recorded for it.
 * Original attribution (`classifiedBy`) does not imply that anyone later
 * reviewed the identification. */
export function reviewStatus(observation: DraftObservation): ReviewStatus {
  return observation.reviewEvents?.length ? 'reviewed' : 'unreviewed';
}

/** Summarize per-identification review state for an image-level indicator. */
export function reviewSummary(observations: DraftObservation[]): ReviewSummary | null {
  if (!observations.length) return null;
  const reviewed = observations.filter((o) => reviewStatus(o) === 'reviewed').length;
  if (reviewed === 0) return 'unreviewed';
  if (reviewed === observations.length) return 'reviewed';
  return 'mixed';
}

export type Effective = {
  observations: DraftObservation[];
  questionable: boolean;
  source: 'draft' | 'base' | 'none';
};

export function effectiveOf(img: TagImage, draft: DraftRecord | undefined): Effective {
  // Only a *dirty* draft is authoritative. A clean draft (one already captured
  // by a prior sync) carries no pending intent, so defer to the canonical base
  // — otherwise a stale clean draft would shadow a later remote change.
  if (draft && draft.dirty)
    return { observations: draft.observations, questionable: draft.questionable, source: 'draft' };
  if (img.baseObservations.length)
    return { observations: img.baseObservations, questionable: false, source: 'base' };
  return { observations: [], questionable: false, source: 'none' };
}

/** True when the image has an unsaved local edit (the unsaved dot). `source` is
 *  `'draft'` only for a dirty draft, so any pending edit — tag, count, time, or
 *  questionable — surfaces, not just a changed species. */
export function isEditedFromBase(eff: Effective): boolean {
  return eff.source === 'draft';
}

export const isGhostObs = (o: DraftObservation): boolean => o.scientificName === 'Casper';
export const hasSpecies = (eff: Effective): boolean => eff.observations.length > 0;
