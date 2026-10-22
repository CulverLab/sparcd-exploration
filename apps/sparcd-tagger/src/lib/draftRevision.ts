import type { DraftRecord } from './db';

/** Durable content signature, including edit time; safe across reloads and same-millisecond edits. */
export function draftRevisionOf(draft: DraftRecord): string {
  return JSON.stringify([
    draft.id, draft.bucket, draft.uploadPrefix, draft.mediaPath, draft.deploymentId,
    draft.observations, draft.questionable, !!draft.baseQuestionable, draft.timeOverride,
    draft.confirmedSpecies ?? [], draft.removedSpecies ?? [], draft.lastEdited,
    // Keep existing journal signatures valid when no explicit status intent exists.
    ...(draft.questionableEdited ? [true] : []),
    ...(draft.timeSourceOverride !== undefined ? [{ timeSource: draft.timeSourceOverride }] : []),
  ]);
}
