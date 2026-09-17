import { describe, it, expect } from 'vitest';
import {
  serializeCsvRows,
  serializeUploadMeta,
  serializeDeployments,
  buildUploadMeta,
  MEDIA_COL,
  OBS_COL,
  MEDIA_COLUMN_COUNT,
  OBS_COLUMN_COUNT,
  type Deployment,
} from '@sparcd/camtrap';
import {
  runRestore,
  snapshotStamp,
  type CanonicalState,
  type SyncIO,
} from '../src/lib/sync';
import type { SyncJournal } from '../src/lib/syncJournal';
import { sha256Hex } from '../src/lib/hash';

// The current canonical state (what the snapshot will be restored *over*) and a
// distinct snapshot state (the bodies we restore). A restore writes the snapshot
// bodies back in place, guarded by IfMatch against the *current* ETags.

const PREFIX = 'Collections/uuid/Uploads/2024.01.15.10.00.00/';
const DEP = 'uuid:SAN15';
const K1 = `${PREFIX}IMG001.JPG`;

function mediaRow(key: string, ts: string): string[] {
  const r = new Array<string>(MEDIA_COLUMN_COUNT).fill('');
  r[MEDIA_COL.mediaId] = key;
  r[MEDIA_COL.deploymentId] = DEP;
  r[MEDIA_COL.sequenceId] = key;
  r[MEDIA_COL.timestamp] = ts;
  r[MEDIA_COL.filePath] = key;
  r[MEDIA_COL.fileName] = key.split('/').pop()!;
  r[MEDIA_COL.mediaType] = 'image/jpeg';
  r[MEDIA_COL.favorite] = 'false';
  return r;
}

function obsRow(key: string, ts: string, sci: string): string[] {
  const r = new Array<string>(OBS_COLUMN_COUNT).fill('');
  r[OBS_COL.observationId] = `${key}:0`;
  r[OBS_COL.deploymentId] = DEP;
  r[OBS_COL.mediaId] = key;
  r[OBS_COL.timestamp] = ts;
  r[OBS_COL.cameraSetup] = 'false';
  r[OBS_COL.scientificName] = sci;
  r[OBS_COL.count] = '1';
  r[OBS_COL.countNew] = '0';
  return r;
}

const META = (withSpecies: number, user: string) =>
  serializeUploadMeta(
    buildUploadMeta({
      uploadUser: user,
      date: new Date('2024-01-15T10:00:00Z'),
      imageCount: 1,
      imagesWithSpecies: withSpecies,
      bucket: 'sparcd-x',
      uploadPath: PREFIX,
      description: '',
    }),
  );

// CURRENT remote: IMG001 tagged Coyote, 1 image-with-species.
const CUR_MEDIA = serializeCsvRows([mediaRow(K1, '2024-01-10T08:00:00')]);
const CUR_OBS = serializeCsvRows([obsRow(K1, '2024-01-10T08:00:00', 'Canis latrans')]);
const CUR_META = META(1, 'editor');
const CURRENT_DEPLOYMENT: Deployment = {
  deploymentId: DEP,
  locationId: 'SAN15',
  locationName: 'San Pedro 15',
  latitude: 31.5,
  longitude: -110.2,
  elevation: 1200,
};
const CUR_DEPLOYMENTS = serializeDeployments([CURRENT_DEPLOYMENT]);

// SNAPSHOT to restore: IMG001 was tagged Puma, 1 image-with-species. The media
// and deployments rows are byte-identical to current (so they're skipped); obs
// + meta differ.
const SNAP_OBS = serializeCsvRows([obsRow(K1, '2024-01-10T08:00:00', 'Puma concolor')]);
const SNAP_META = META(1, 'orig');
const SNAP_BODIES = { media: CUR_MEDIA, observations: SNAP_OBS, deployments: CUR_DEPLOYMENTS, uploadMeta: SNAP_META };

async function canonical(): Promise<CanonicalState> {
  return {
    media: { text: CUR_MEDIA, etag: '"media-1"', hash: await sha256Hex(CUR_MEDIA) },
    observations: { text: CUR_OBS, etag: '"obs-1"', hash: await sha256Hex(CUR_OBS) },
    deployments: { text: CUR_DEPLOYMENTS, etag: '"dep-1"', hash: await sha256Hex(CUR_DEPLOYMENTS) },
    uploadMeta: { text: CUR_META, etag: '"meta-1"', hash: await sha256Hex(CUR_META) },
  };
}

const NOW = new Date('2024-01-20T14:30:00');

type Recorder = {
  snapshots: { key: string; body: string }[];
  replaces: { key: string; body: string; etag: string }[];
  journals: SyncJournal[];
  cleared: number;
};

function fakeIO(
  current: CanonicalState,
  opts: { snapshotFailsOn?: (key: string) => boolean; replaceError?: (key: string) => Error | null } = {},
): { io: SyncIO; rec: Recorder } {
  const rec: Recorder = { snapshots: [], replaces: [], journals: [], cleared: 0 };
  const io: SyncIO = {
    loadCanonical: async () => current,
    writeSnapshot: async (key, body) => {
      if (opts.snapshotFailsOn?.(key))
        throw Object.assign(new Error('exists'), { name: 'PreconditionFailedError', $metadata: { httpStatusCode: 412 } });
      rec.snapshots.push({ key, body });
    },
    replace: async (key, body, etag) => {
      const err = opts.replaceError?.(key);
      if (err) throw err;
      rec.replaces.push({ key, body, etag });
      return { etag: `"new-${key.split('/').pop()}"` };
    },
    saveJournal: async (j) => rec.journals.push(structuredClone(j)),
    clearJournal: async () => void rec.cleared++,
    now: () => NOW,
  };
  return { io, rec };
}

describe('runRestore — dry-run writes nothing', () => {
  it('lists the differing files and touches no I/O', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const res = await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: SNAP_BODIES, dryRun: true },
      io,
    );
    expect(res.status).toBe('dry-run');
    if (res.status === 'dry-run') {
      // media is byte-identical to current → skipped; obs + meta differ.
      expect(res.writes.map((w) => w.role).sort()).toEqual(['observations', 'uploadMeta']);
      expect(res.snapshotPrefix).toContain('.sparcd-tagger-snapshots/jg/');
    }
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });
});

describe('runRestore — noop when the snapshot equals current', () => {
  it('writes nothing if every body already matches', async () => {
    const cur = await canonical();
    const { io } = fakeIO(cur);
    const same = { media: CUR_MEDIA, observations: CUR_OBS, deployments: CUR_DEPLOYMENTS, uploadMeta: CUR_META };
    const res = await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: same, dryRun: false },
      io,
    );
    expect(res.status).toBe('noop');
  });
});

describe('runRestore — legacy snapshots without deployments.csv', () => {
  it('refuses a restore that would leave media pointing at a missing deployment', async () => {
    const cur = await canonical();
    const replacement = { ...CURRENT_DEPLOYMENT, deploymentId: 'uuid:SAN22', locationId: 'SAN22' };
    cur.deployments = { text: serializeDeployments([replacement]), etag: '"dep-2"', hash: 'changed' };
    const { io } = fakeIO(cur);
    await expect(runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: { media: CUR_MEDIA, observations: SNAP_OBS, uploadMeta: SNAP_META }, dryRun: false },
      io,
    )).rejects.toThrow(/cannot be restored safely/);
  });
});

describe('runRestore — live write path', () => {
  it('snapshots current state (manifest last), restores differing bodies against current ETags', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const res = await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: SNAP_BODIES, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');

    // Pre-restore snapshot is the full current state, manifest last.
    expect(rec.snapshots.map((s) => s.key.split('/').pop())).toEqual([
      'media.csv', 'observations.csv', 'deployments.csv', 'UploadMeta.json', 'manifest.json',
    ]);
    // Only the differing files are restored, in role order.
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual([
      'observations.csv', 'UploadMeta.json',
    ]);
    // The restored bytes are the snapshot bodies, verbatim (no merge).
    expect(rec.replaces[0].body).toBe(SNAP_OBS);
    expect(rec.replaces[1].body).toBe(SNAP_META);
    // Guarded by IfMatch against the CURRENT remote ETags, not the snapshot's.
    expect(rec.replaces[0].etag).toBe('"obs-1"');
    expect(rec.cleared).toBe(1);
  });

  it('re-stamps the snapshot +1s and retries once on a 412 collision', async () => {
    const cur = await canonical();
    const firstStamp = snapshotStamp(NOW);
    const { io, rec } = fakeIO(cur, { snapshotFailsOn: (key) => key.includes(firstStamp) });
    const res = await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: SNAP_BODIES, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');
    const bumped = snapshotStamp(new Date(NOW.getTime() + 1000));
    expect(rec.snapshots.every((s) => s.key.includes(bumped))).toBe(true);
    expect(rec.snapshots.at(-1)!.key.endsWith('manifest.json')).toBe(true);
  });

  it('reports unsupported when the backend will not enforce IfMatch (501)', async () => {
    const cur = await canonical();
    const { io } = fakeIO(cur, {
      replaceError: () => Object.assign(new Error('no'), { name: 'ConditionalPutUnsupportedError' }),
    });
    const res = await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: SNAP_BODIES, dryRun: false },
      io,
    );
    expect(res.status).toBe('unsupported');
  });

  it('writes only non-image files under .sparcd-tagger-snapshots/ (reader-listing contract)', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: SNAP_BODIES, dryRun: false },
      io,
    );
    expect(rec.snapshots.length).toBeGreaterThan(0);
    for (const s of rec.snapshots) {
      expect(s.key).toContain(`${PREFIX}.sparcd-tagger-snapshots/`);
      expect(/\.(jpe?g|mp4)$/i.test(s.key)).toBe(false);
    }
  });
});

describe('runRestore — resumes a prior partial journal before a fresh restore', () => {
  it('continues the journaled write and never re-snapshots', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const journal: SyncJournal = {
      id: `sparcd-x::${PREFIX}`,
      bucket: 'sparcd-x',
      uploadPrefix: PREFIX,
      snapshotPrefix: `${PREFIX}.sparcd-tagger-snapshots/jg/stamp/`,
      user: 'jg',
      startedAt: NOW.toISOString(),
      objects: [
        { role: 'observations', key: `${PREFIX}observations.csv`, baseETag: '"obs-1"', baseHash: cur.observations.hash, body: SNAP_OBS, intendedHash: await sha256Hex(SNAP_OBS), status: 'pending' },
        { role: 'uploadMeta', key: `${PREFIX}UploadMeta.json`, baseETag: '"meta-1"', baseHash: cur.uploadMeta.hash, body: SNAP_META, intendedHash: await sha256Hex(SNAP_META), status: 'pending' },
      ],
    };
    const res = await runRestore(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', bodies: SNAP_BODIES, dryRun: false, resumeJournal: journal },
      io,
    );
    expect(res.status).toBe('synced');
    expect(rec.snapshots).toHaveLength(0); // resume does not re-snapshot
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual(['observations.csv', 'UploadMeta.json']);
    expect(rec.cleared).toBe(1);
  });
});
