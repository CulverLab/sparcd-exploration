import { describe, it, expect } from 'vitest';
import {
  planResume,
  collectNewETags,
  type SyncJournal,
  type JournalObject,
  type CanonicalRole,
  type RemoteState,
} from '../src/lib/syncJournal';

const obj = (
  role: CanonicalRole,
  status: 'pending' | 'written',
  extra: Partial<JournalObject> = {},
): JournalObject => ({
  role,
  key: `prefix/${role}`,
  baseETag: `"base-${role}"`,
  baseHash: `hash-${role}`,
  body: `body-${role}`,
  intendedHash: `hash-${role}`,
  status,
  newETag: status === 'written' ? `"new-${role}"` : undefined,
  ...extra,
});

const journal = (objects: JournalObject[]): SyncJournal => ({
  id: 'b::prefix',
  bucket: 'b',
  uploadPrefix: 'prefix/',
  snapshotPrefix: 'prefix/.sparcd-tagger-snapshots/u/stamp/',
  user: 'u',
  startedAt: '2024-01-20T14:30:00.000Z',
  objects,
});

// Remote state where every object still matches its journaled base + intent.
const clean = (): Record<CanonicalRole, RemoteState> => ({
  media: { etag: '"base-media"', hash: 'hash-media' },
  observations: { etag: '"base-observations"', hash: 'hash-observations' },
  deployments: { etag: '"base-deployments"', hash: 'hash-deployments' },
  uploadMeta: { etag: '"base-uploadMeta"', hash: 'hash-uploadMeta' },
});

describe('planResume — partial-sync resume contract', () => {
  it('continues from the first pending object when all bases still match', () => {
    const j = journal([obj('media', 'pending'), obj('observations', 'pending'), obj('uploadMeta', 'pending')]);
    expect(planResume(j, clean())).toEqual({ kind: 'continue', fromIndex: 0 });
  });

  it('skips already-written objects and resumes at the first pending one', () => {
    const j = journal([obj('media', 'written'), obj('observations', 'pending'), obj('uploadMeta', 'pending')]);
    expect(planResume(j, clean())).toEqual({ kind: 'continue', fromIndex: 1 });
  });

  it('reports done when every object is written and still hashes to its intent', () => {
    const j = journal([obj('media', 'written'), obj('observations', 'written'), obj('uploadMeta', 'written')]);
    expect(planResume(j, clean())).toEqual({ kind: 'done' });
  });

  it('conflicts when a written object was changed remotely (hash drift)', () => {
    const j = journal([obj('media', 'written'), obj('observations', 'pending'), obj('uploadMeta', 'pending')]);
    const cur = clean();
    cur.media.hash = 'someone-else-wrote-this';
    const d = planResume(j, cur);
    expect(d.kind).toBe('conflict');
    if (d.kind === 'conflict') expect(d.role).toBe('media');
  });

  it('conflicts when a pending object changed since the draft was grounded (stale ETag)', () => {
    const j = journal([obj('media', 'written'), obj('observations', 'pending'), obj('uploadMeta', 'pending')]);
    const cur = clean();
    cur.observations.etag = '"changed"';
    const d = planResume(j, cur);
    expect(d.kind).toBe('conflict');
    if (d.kind === 'conflict') expect(d.role).toBe('observations');
  });

  it('collects new ETags only for written objects', () => {
    const j = journal([obj('media', 'written'), obj('observations', 'pending'), obj('uploadMeta', 'pending')]);
    expect(collectNewETags(j)).toEqual({ media: '"new-media"' });
  });
});
