// The Dexie v3 migration: a pre-existing single-label (v1/v2) draft must upgrade
// to the array `observations` shape losslessly. Seeds raw records at the OLD
// schema with a throwaway Dexie, then opens the production `db` so the real v3
// upgrade callback runs.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';

// A v2-shaped record as written before the multi-species refactor.
type LegacyDraft = {
  id: string;
  bucket: string;
  uploadPrefix: string;
  mediaPath: string;
  deploymentId: string;
  label: string;
  commonName: string;
  count: number;
  requestedSpecies: string;
  freeTags: string;
  questionable: boolean;
  timeOverride: string | null;
  lastEdited: string;
  dirty: boolean;
};

const DB_NAME = 'sparcd-tagger';

/** Seed `drafts` at the legacy v2 schema (no `observations`), then close. */
async function seedLegacy(rows: LegacyDraft[], uploads: Record<string, unknown>[] = []): Promise<void> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(1).stores({
    drafts: 'id, [bucket+uploadPrefix]',
    uploads: 'id',
    sessions: 'sessionId, syncedAt',
  });
  legacy.version(2).stores({ syncJournals: 'id' });
  await legacy.open();
  await legacy.table('drafts').bulkPut(rows);
  await legacy.table('uploads').bulkPut(uploads);
  legacy.close();
}

function legacy(over: Partial<LegacyDraft>): LegacyDraft {
  return {
    id: 'b::p/::x',
    bucket: 'b',
    uploadPrefix: 'p/',
    mediaPath: 'p/x.JPG',
    deploymentId: 'b:loc',
    label: '',
    commonName: '',
    count: 0,
    requestedSpecies: '',
    freeTags: '',
    questionable: false,
    timeOverride: null,
    lastEdited: '2024-01-01T00:00:00Z',
    dirty: true,
    ...over,
  };
}

async function openUpgraded() {
  // Import after the legacy DB is seeded+closed so the production singleton opens
  // fresh against the same on-disk name and runs the v3 upgrade.
  const mod = await import('../src/lib/db');
  await mod.db.open();
  return mod.db;
}

describe('Dexie v3 migration — single label → observations array', () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase(DB_NAME);
    // The production singleton may already be open from a prior test; reset its
    // connection so re-opening re-reads the freshly seeded legacy DB.
    const mod = await import('../src/lib/db');
    mod.db.close();
  });

  it('upgrades a non-empty label to exactly one observation, count floored to ≥1', async () => {
    await seedLegacy([
      legacy({ id: 'b::p/::a', mediaPath: 'p/a.JPG', label: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: 'Req' }),
    ]);
    const db = await openUpgraded();
    const rec = (await db.drafts.get('b::p/::a')) as Record<string, unknown>;
    expect(rec.observations).toEqual([
      { scientificName: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: 'Req', freeTags: '' },
    ]);
    expect(rec.label).toBeUndefined();
    expect(rec.count).toBeUndefined();
    expect(rec.commonName).toBeUndefined();
  });

  it('floors a zero/missing count to 1', async () => {
    await seedLegacy([legacy({ id: 'b::p/::z', mediaPath: 'p/z.JPG', label: 'Puma concolor', count: 0 })]);
    const db = await openUpgraded();
    const rec = (await db.drafts.get('b::p/::z')) as Record<string, unknown>;
    expect((rec.observations as { count: number }[])[0].count).toBe(1);
  });

  it('upgrades an empty-label draft to observations:[]', async () => {
    await seedLegacy([legacy({ id: 'b::p/::e', mediaPath: 'p/e.JPG', label: '' })]);
    const db = await openUpgraded();
    const rec = (await db.drafts.get('b::p/::e')) as Record<string, unknown>;
    expect(rec.observations).toEqual([]);
  });

  it('upgrades a Ghost (Casper) draft to a single Casper observation', async () => {
    await seedLegacy([legacy({ id: 'b::p/::g', mediaPath: 'p/g.JPG', label: 'Casper', commonName: 'Ghost', count: 1 })]);
    const db = await openUpgraded();
    const rec = (await db.drafts.get('b::p/::g')) as Record<string, unknown>;
    expect(rec.observations).toEqual([
      { scientificName: 'Casper', commonName: 'Ghost', count: 1, requestedSpecies: '', freeTags: '' },
    ]);
  });

  it('carries questionable / timeOverride / dirty forward untouched', async () => {
    await seedLegacy([
      legacy({ id: 'b::p/::q', mediaPath: 'p/q.JPG', label: 'Puma concolor', count: 1, questionable: true, timeOverride: '2024-01-10T09:00:00', dirty: true }),
    ]);
    const db = await openUpgraded();
    const rec = (await db.drafts.get('b::p/::q')) as Record<string, unknown>;
    expect(rec.questionable).toBe(true);
    expect(rec.timeOverride).toBe('2024-01-10T09:00:00');
    expect(rec.dirty).toBe(true);
  });

  it('does not mark a pre-location upload record as unsynced', async () => {
    // This is the on-disk shape before the location-correction field existed:
    // `pendingLocation` is absent, not explicitly null.
    await seedLegacy([], [{
      id: 'b::p/',
      bucket: 'b',
      uploadPrefix: 'p/',
      loadedAt: '2024-01-01T00:00:00Z',
      timeOffset: null,
    }]);
    const mod = await import('../src/lib/db');
    await mod.db.open();

    expect((await mod.uploadDraftStates('b')).has('p/')).toBe(false);
  });
});
