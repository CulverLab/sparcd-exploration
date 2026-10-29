import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, uploadId, type DraftRecord } from '../src/lib/db';
import { useDraftStore } from '../src/lib/drafts';
import { draftRevisionOf } from '../src/lib/draftRevision';
import type { SyncReceipt } from '../src/lib/syncJournal';
import { buildSyncPlan } from '../src/lib/sync';
import type { TagImage } from '../src/lib/workspace';

const ctx = { bucket: 'cleanup-test', uploadPrefix: 'pending/' };
const path = 'pending/IMG001.JPG';
const target = { mediaPath: path, deploymentId: 'deployment', base: { observations: [], questionable: false } };
const image: TagImage = { key: path, deploymentId: 'deployment', fileName: 'IMG001.JPG', baseTimestamp: '2024-01-01T09:00:00', baseObservations: [], baseQuestionable: true };

function receipt(draft: DraftRecord): SyncReceipt {
  return { draftRevisions: { [path]: draftRevisionOf(draft) }, mediaTimestamps: { [path]: image.baseTimestamp }, needExpert: { [path]: true } };
}

async function reloadDraft(): Promise<DraftRecord> {
  await useDraftStore.getState().flushSaves();
  useDraftStore.setState({ loadedKey: null, drafts: {} });
  await useDraftStore.getState().loadUpload(ctx);
  return useDraftStore.getState().drafts[path];
}

describe('revision-safe sync cleanup across reload', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'));
    await db.open();
    await db.drafts.where('[bucket+uploadPrefix]').equals([ctx.bucket, ctx.uploadPrefix]).delete();
    useDraftStore.setState({ loadedKey: uploadId(ctx.bucket, ctx.uploadPrefix), drafts: {}, timeOffset: null, pendingLocation: null });
    useDraftStore.getState().setQuestionableMany(ctx, [target], true);
  });

  afterEach(async () => {
    await useDraftStore.getState().flushSaves();
    await db.drafts.where('[bucket+uploadPrefix]').equals([ctx.bucket, ctx.uploadPrefix]).delete();
    vi.useRealTimers();
  });

  it('cleans an unchanged submitted revision after journal reload', async () => {
    const written = receipt(useDraftStore.getState().drafts[path]);
    await useDraftStore.getState().markUploadPendingSync(ctx, written.draftRevisions);
    await reloadDraft();
    await useDraftStore.getState().markUploadSynced(ctx, written);
    const restored = await reloadDraft();
    expect(restored.dirty).toBe(false);
    expect(restored.pendingSync).toBeUndefined();
    expect(restored.questionable).toBe(true);
  });

  it('preserves newer species even when both edits have the same timestamp', async () => {
    const original = useDraftStore.getState().drafts[path];
    const written = receipt(original);
    await useDraftStore.getState().markUploadPendingSync(ctx, written.draftRevisions);
    useDraftStore.getState().addSpecies(ctx, [target], { scientificName: 'Canis latrans', commonName: 'Coyote', count: 1 });
    expect(useDraftStore.getState().drafts[path].lastEdited).toBe(original.lastEdited);
    await reloadDraft();
    await useDraftStore.getState().markUploadSynced(ctx, written);
    const restored = await reloadDraft();
    expect(restored.dirty).toBe(true);
    expect(restored.observations[0].scientificName).toBe('Canis latrans');
    expect(restored.baseQuestionable).toBe(true);
  });

  it('preserves a newer time correction instead of acknowledging the journal time', async () => {
    const written = receipt(useDraftStore.getState().drafts[path]);
    useDraftStore.getState().setTimeOverride(ctx, path, target.deploymentId, target.base, '2024-01-01T11:00:00');
    await reloadDraft();
    await useDraftStore.getState().markUploadSynced(ctx, written);
    const restored = await reloadDraft();
    expect(restored.dirty).toBe(true);
    expect(restored.timeOverride).toBe('2024-01-01T11:00:00');
  });

  it('keeps a reversed status pending until it can clear the journaled status', async () => {
    const written = receipt(useDraftStore.getState().drafts[path]);
    await useDraftStore.getState().markUploadPendingSync(ctx, written.draftRevisions);
    useDraftStore.getState().setQuestionableMany(ctx, [target], false);
    expect((await reloadDraft()).dirty).toBe(true);
    await useDraftStore.getState().markUploadSynced(ctx, written);
    const restored = await reloadDraft();
    expect(restored.dirty).toBe(true);
    expect(restored.questionable).toBe(false);
    const plan = buildSyncPlan([image], { [path]: restored }, null);
    expect(plan.statusEdits[0].needExpert).toBe(false);
  });

  it('does not acknowledge legacy journals without revision evidence', async () => {
    await useDraftStore.getState().markUploadSynced(ctx, undefined);
    expect((await reloadDraft()).dirty).toBe(true);
  });
});
