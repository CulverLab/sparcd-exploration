import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, draftId } from '../src/lib/db';
import { browseSaveStatus, readBrowseSaveStates, SAVE_STATUS } from '../src/lib/browseSaveStatus';
import type { AutomaticRecord } from '../src/lib/automaticModel';
import type { SaveView } from '../src/lib/automaticSaver';
const ready = { fetching: false, failed: false, ready: true };
const waiting = { fetching: true, failed: false, ready: false };
const failed = { fetching: false, failed: true, ready: false };
const pending: AutomaticRecord = { id: 'one', bucket: 'bucket', scope: 'account', collectionKey: 'collection', uploadPrefix: 'one/', actions: [{ id: 'edit', user: 'person', at: '', changes: [] }], undo: null };
const live = (phase: SaveView['phase'], extra = {}): SaveView => ({ phase, pending: true, message: '', undoReason: '', canEdit: false, ...extra });
beforeEach(async () => { await db.open(); await Promise.all([db.automatic.clear(), db.drafts.clear(), db.uploads.clear(), db.syncJournals.clear()]); });

describe('Browse save status', () => {
  it('keeps failed setup unknown and genuine ownership recovery visible even without local pending intent', () => {
    expect(browseSaveStatus(ready, ready, undefined, live('failed', { setupFailed: true, pending: false }))).toBe('recheck');
    expect(browseSaveStatus(ready, ready, 'recover', live('failed', { setupFailed: true, pending: false }))).toBe('recheck');
    expect(browseSaveStatus(ready, ready, undefined, live('recovery', { pending: false }))).toBe('recover');
  });
  it('requires successful stored and local checks before calling untouched or previously edited uploads Saved', () => {
    expect(browseSaveStatus(ready, ready)).toBe('saved');
    expect(browseSaveStatus(waiting, ready)).toBe('checking');
    expect(browseSaveStatus(ready, waiting)).toBe('checking');
    expect(browseSaveStatus(failed, ready)).toBe('recheck');
    expect(browseSaveStatus(ready, failed)).toBe('recheck');
    // A failed background recheck must not reuse stale successful data.
    expect(browseSaveStatus({ ...failed, ready: true }, ready)).toBe('recheck');
  });
  it.each(['conflict', 'repair', 'recover', 'retry'] as const)('retains known %s work even if the stored summary fails', status => {
    expect(browseSaveStatus(ready, failed, status)).toBe(status);
  });
  it.each([
    ['saving', {}, 'saving'], ['saving', { retrying: true }, 'retrying'],
    ['pending', {}, 'retrying'], ['failed', { failure: 'retry' }, 'retry'], ['failed', { failure: 'repair' }, 'repair'],
    ['conflict', {}, 'conflict'], ['recovery', {}, 'recover'],
  ] as const)('uses the live %s state instead of a stale local scan', (phase, extra, expected) => {
    expect(browseSaveStatus(ready, ready, 'retry', live(phase, extra))).toBe(expected);
  });
  it('shows a conflict discovered by a read-only check even when this tab has no pending edits', () => {
    expect(browseSaveStatus(ready, ready, undefined, live('conflict', { pending: false }))).toBe('conflict');
  });
  it('distinguishes unreadable status from failed writes and retains known recovery', () => {
    expect(browseSaveStatus(ready, failed, undefined, live('failed'))).toBe('recheck');
    expect(browseSaveStatus(ready, failed, 'recover', live('failed', { pending: false }))).toBe('recover');
    expect(browseSaveStatus(ready, failed, 'conflict', live('failed'))).toBe('conflict');
  });
  it('does not flash an old Retry button after the active coordinator confirms its save', () => {
    expect(browseSaveStatus(ready, ready, 'retry', live('saved', { pending: false, updatedAt: 20 }), 10)).toBe('saved');
    expect(browseSaveStatus(ready, ready, 'repair', live('saved', { pending: false, updatedAt: 20 }), 10)).toBe('saved');
    expect(browseSaveStatus(ready, ready, 'retry', live('saved', { pending: false, updatedAt: 20 }), 30)).toBe('retry');
    expect(browseSaveStatus(ready, ready, 'recover', live('saved', { pending: false, updatedAt: 20 }), 10)).toBe('recover');
  });
  it('does not label an inactive pending upload as actively retrying', async () => {
    await db.automatic.put({ ...pending, saveFailure: 'retrying' });
    expect((await readBrowseSaveStates('bucket', 'account')).get('one/')).toBe('retry');
  });
  it.each(['repair', 'retry'] as const)('retains the %s reason after a reload', async saveFailure => {
    await db.automatic.put({ ...pending, saveFailure });
    expect((await readBrowseSaveStates('bucket', 'account')).get('one/')).toBe(saveFailure);
  });
  it('gives conflicts and required recovery precedence without modifying their records', async () => {
    const records = [{ ...pending, conflictReason: 'changed', saveFailure: 'repair' as const }, { ...pending, id: 'two', uploadPrefix: 'two/', adoptionRequired: true }];
    await db.automatic.bulkPut(records);
    const states = await readBrowseSaveStates('bucket', 'account');
    expect(states.get('one/')).toBe('conflict'); expect(states.get('two/')).toBe('recover');
    expect(await db.automatic.toArray()).toEqual(records);
  });
  it('keeps foreign-account pending work recoverable and never offers to retry it as this account', async () => {
    await db.automatic.put({ ...pending, scope: 'another-account', conflictReason: 'changed' });
    expect((await readBrowseSaveStates('bucket', 'account')).get('one/')).toBe('recover');
    expect((await readBrowseSaveStates('other-bucket', 'account')).size).toBe(0);
  });
  it('identifies legacy dirty drafts and journals as requiring recovery', async () => {
    await db.drafts.put({ id: draftId('bucket', 'draft/', 'image'), bucket: 'bucket', uploadPrefix: 'draft/', mediaPath: 'image', deploymentId: '', observations: [], questionable: false, dirty: true, lastEdited: '' });
    await db.syncJournals.put({ id: 'legacy', bucket: 'bucket', uploadPrefix: 'journal/', user: 'person', snapshotPrefix: '', startedAt: '', objects: [] });
    const states = await readBrowseSaveStates('bucket', 'account');
    expect(states.get('draft/')).toBe('recover'); expect(states.get('journal/')).toBe('recover');
  });
  it('ignores completed records and clean local drafts', async () => {
    await db.automatic.put({ ...pending, actions: [], saveFailure: 'repair' });
    expect((await readBrowseSaveStates('bucket', 'account')).size).toBe(0);
  });
  it('keeps the confirmed compact labels and popup wording', () => {
    expect(Object.values(SAVE_STATUS).map(s => s.label)).toEqual(['Checking…', 'Saved', 'Saving', 'Retrying', 'Recheck', 'Retry save', 'Conflict', 'Repair', 'Recover']);
    expect(SAVE_STATUS.saved.help).toBe('All changes are saved. Nothing to do.');
    expect(SAVE_STATUS.recheck.help).toBe('Save status is unknown. Select to check status again.');
  });
});
