import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { useDraftStore, blankDraft } from '../src/lib/drafts';
import { db } from '../src/lib/db';
import { buildSyncPlan } from '../src/lib/sync';
import { buildObservationComments, reviewEventsFromComments } from '@sparcd/camtrap';
import { reviewStatus } from '../src/lib/effective';

const ctx = { bucket: 'stale-clean', uploadPrefix: 'upload/' };
const observation = (scientificName: string) => ({ scientificName, commonName: '', count: 1, requestedSpecies: '', freeTags: '' });
afterEach(async () => { await useDraftStore.getState().flushSaves(); await db.drafts.where('[bucket+uploadPrefix]').equals([ctx.bucket, ctx.uploadPrefix]).delete(); });
describe('automatic-save foundations', () => {
  it('starts a new edit from refreshed canonical species instead of a retained clean draft (#463)', () => {
    const path = 'upload/image.jpg';
    const clean = blankDraft(ctx, path, 'd', { observations: [observation('Canis latrans'), observation('Odocoileus hemionus')] });
    useDraftStore.setState({ drafts: { [path]: clean } });
    const base = { observations: [observation('Lynx rufus')] };
    useDraftStore.getState().addSpecies(ctx, [{ mediaPath: path, deploymentId: 'd', base }], observation('Puma concolor'));
    const draft = useDraftStore.getState().drafts[path];
    expect(draft.observations.map(o => o.scientificName)).toEqual(['Lynx rufus', 'Puma concolor']);
    const plan = buildSyncPlan([{ key: path, deploymentId: 'd', fileName: 'image.jpg', baseTimestamp: '', baseObservations: base.observations }], { [path]: draft }, null);
    expect(plan.tagEdits[0].observations.map(o => o.scientificName)).toEqual(['Lynx rufus', 'Puma concolor']);
  });
  it('round trips a reversed review without deleting the original review attribution', () => {
    const event = { reviewedBy: 'Alice', reviewedAt: '2026-01-01T00:00:00Z', reversedBy: 'Bob', reversedAt: '2026-01-02T00:00:00Z' };
    const events = reviewEventsFromComments(buildObservationComments({ reviewEvents: [event] }));
    expect(events).toEqual([event]);
    expect(reviewStatus({ ...observation('Puma concolor'), reviewEvents: events })).toBe('unreviewed');
  });
});
