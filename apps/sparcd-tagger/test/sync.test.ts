import { describe, it, expect } from 'vitest';
import {
  serializeCsvRows,
  parseCsvRows,
  serializeUploadMeta,
  buildUploadMeta,
  serializeDeployments,
  MEDIA_COL,
  OBS_COL,
  MEDIA_COLUMN_COUNT,
  OBS_COLUMN_COUNT,
  type Deployment,
} from '@sparcd/camtrap';
import { mergeObservations, parseObservations, mergeMedia, parseDeployments } from '@sparcd/camtrap';
import {
  buildSyncPlan,
  runSync,
  snapshotStamp,
  type CanonicalState,
  type SyncIO,
  type SyncPlan,
} from '../src/lib/sync';
import type { SyncJournal } from '../src/lib/syncJournal';
import { sha256Hex } from '../src/lib/hash';
import type { TagImage } from '../src/lib/workspace';
import type { DraftRecord, DraftObservation } from '../src/lib/db';
import { blankDraft } from '../src/lib/drafts';

const obs = (
  scientificName: string,
  count = 1,
  commonName = '',
  requestedSpecies = '',
): DraftObservation => ({ scientificName, commonName, count, requestedSpecies, freeTags: '' });

const PREFIX = 'Collections/uuid/Uploads/2024.01.15.10.00.00/';
const DEP = 'uuid:SAN15';
const K1 = `${PREFIX}IMG001.JPG`;
const K2 = `${PREFIX}IMG002.JPG`;

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

const MEDIA_CSV = serializeCsvRows([
  mediaRow(K1, '2024-01-10T08:00:00'),
  mediaRow(K2, '2024-01-10T08:00:30'),
]);
const OBS_CSV = serializeCsvRows([obsRow(K1, '2024-01-10T08:00:00', 'Puma concolor')]);
const CURRENT_DEPLOYMENT: Deployment = {
  deploymentId: DEP,
  locationId: 'SAN15',
  locationName: 'San Pedro 15',
  latitude: 31.5,
  longitude: -110.2,
  elevation: 1200,
};
const DEPLOYMENTS_CSV = serializeDeployments([CURRENT_DEPLOYMENT]);
const NEW_DEPLOYMENT: Deployment = {
  deploymentId: 'uuid:SAN22',
  locationId: 'SAN22',
  locationName: 'San Pedro 22',
  latitude: 31.7,
  longitude: -110.4,
  elevation: 1300,
};
const META_CSV = serializeUploadMeta(
  buildUploadMeta({
    uploadUser: 'orig',
    date: new Date('2024-01-15T10:00:00Z'),
    imageCount: 2,
    imagesWithSpecies: 1,
    bucket: 'sparcd-x',
    uploadPath: PREFIX,
    description: '',
  }),
);

async function canonical(): Promise<CanonicalState> {
  return {
    media: { text: MEDIA_CSV, etag: '"media-1"', hash: await sha256Hex(MEDIA_CSV) },
    observations: { text: OBS_CSV, etag: '"obs-1"', hash: await sha256Hex(OBS_CSV) },
    deployments: { text: DEPLOYMENTS_CSV, etag: '"dep-1"', hash: await sha256Hex(DEPLOYMENTS_CSV) },
    uploadMeta: { text: META_CSV, etag: '"meta-1"', hash: await sha256Hex(META_CSV) },
  };
}

const IMAGES: TagImage[] = [
  { key: K1, fileName: 'IMG001.JPG', deploymentId: DEP, baseTimestamp: '2024-01-10T08:00:00', baseObservations: [obs('Puma concolor', 1)] },
  { key: K2, fileName: 'IMG002.JPG', deploymentId: DEP, baseTimestamp: '2024-01-10T08:00:30', baseObservations: [] },
];

function draft(over: Partial<DraftRecord>): DraftRecord {
  return {
    id: '', bucket: 'sparcd-x', uploadPrefix: PREFIX, mediaPath: '', deploymentId: DEP,
    observations: [],
    questionable: false, timeOverride: null, lastEdited: '', dirty: true, ...over,
  };
}

// Add a species to the untagged IMG002.
const ADD_DRAFTS: Record<string, DraftRecord> = {
  [K2]: draft({ mediaPath: K2, observations: [obs('Canis latrans', 1, 'Coyote')] }),
};

const NOW = new Date('2024-01-20T14:30:00');

type Recorder = {
  snapshots: { key: string; body: string }[];
  replaces: { key: string; body: string; etag: string }[];
  journals: SyncJournal[];
  cleared: number;
};

function fakeIO(
  current: CanonicalState,
  opts: {
    snapshotFailsOn?: (key: string) => boolean;
    replaceError?: (key: string) => Error | null;
  } = {},
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

const baseFrom = (c: CanonicalState) => ({
  media: { etag: c.media.etag, hash: c.media.hash },
  observations: { etag: c.observations.etag, hash: c.observations.hash },
  deployments: { etag: c.deployments.etag, hash: c.deployments.hash },
  uploadMeta: { etag: c.uploadMeta.etag, hash: c.uploadMeta.hash },
});

describe('buildSyncPlan', () => {
  it('classifies an addition and emits one observation edit', () => {
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    expect(plan.summary).toEqual({ additions: 1, modifications: 0, removals: 0, timeCorrections: 0 });
    expect(plan.tagEdits).toHaveLength(1);
    expect(plan.tagEdits[0].mediaId).toBe(K2);
    expect(plan.tagEdits[0].observations[0].scientificName).toBe('Canis latrans');
    expect(plan.timeEdits).toHaveLength(0);
  });

  it('classifies a detag as a removal with empty observations', () => {
    const plan = buildSyncPlan(IMAGES, { [K1]: draft({ mediaPath: K1, observations: [] }) }, null);
    expect(plan.summary.removals).toBe(1);
    expect(plan.tagEdits[0].observations).toEqual([]);
  });

  it('ignores a questionable-only toggle (no canonical change)', () => {
    const plan = buildSyncPlan(
      IMAGES,
      { [K1]: draft({ mediaPath: K1, observations: [obs('Puma concolor', 1)], questionable: true }) },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(0);
  });

  it('does not detag a base-tagged image when questionable is toggled (seeded draft)', () => {
    // Mirror the real store path: toggling questionable on an already-tagged
    // image creates a draft *seeded from the base set*, then flips questionable.
    // A draft that did not carry the base observations forward would be
    // misclassified as a detag — the regression this guards.
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(IMAGES, { [K1]: { ...seeded, questionable: true, dirty: true } }, null);
    expect(plan.summary.removals).toBe(0);
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(0);
  });

  it('ignores a clean (already-synced) draft so it is not re-applied', () => {
    // A non-dirty draft carries no pending intent; it must defer to the base.
    const plan = buildSyncPlan(
      IMAGES,
      { [K2]: draft({ mediaPath: K2, observations: [obs('Canis latrans', 1, 'Coyote')], dirty: false }) },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
  });

  it('emits a time-only media edit for a per-image override that keeps the tag', () => {
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(
      IMAGES,
      { [K1]: { ...seeded, timeOverride: '2024-01-10T09:00:00', dirty: true } },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(1);
    expect(plan.timeEdits[0].mediaTimestamp).toBe('2024-01-10T09:00:00');
    expect(plan.timeEdits[0].observations).toEqual([]);
    expect(plan.summary.timeCorrections).toBe(1);
  });

  // --- Multi-species data-loss proofs (RED against the old single-label code) -

  const K3 = `${PREFIX}IMG003.JPG`;
  const MULTI_IMAGES: TagImage[] = [
    {
      key: K3,
      fileName: 'IMG003.JPG',
      deploymentId: DEP,
      baseTimestamp: '2024-01-10T08:01:00',
      baseObservations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')],
    },
  ];

  it('a multi-species base image gaining a third species carries ALL three, never collapsed', () => {
    const draftObs = [
      obs('Odocoileus hemionus', 1, 'Mule Deer'),
      obs('Canis latrans', 1, 'Coyote'),
      obs('Lynx rufus', 1, 'Bobcat'),
    ];
    const plan = buildSyncPlan(MULTI_IMAGES, { [K3]: draft({ mediaPath: K3, observations: draftObs }) }, null);
    expect(plan.tagEdits).toHaveLength(1);
    expect(plan.tagEdits[0].observations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
      'Canis latrans',
      'Lynx rufus',
    ]);
  });

  it('editing one count on a multi-species image keeps the other species', () => {
    const draftObs = [obs('Odocoileus hemionus', 3, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')];
    const plan = buildSyncPlan(MULTI_IMAGES, { [K3]: draft({ mediaPath: K3, observations: draftObs }) }, null);
    expect(plan.tagEdits).toHaveLength(1);
    expect(plan.tagEdits[0].observations).toHaveLength(2);
    const deer = plan.tagEdits[0].observations.find((o) => o.scientificName === 'Odocoileus hemionus');
    expect(deer?.count).toBe(3);
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Canis latrans')).toBeTruthy();
  });
});

describe('buildSyncPlan — location correction (issue #279)', () => {
  it('carries the pending location as locationEdit with no images touched', () => {
    const plan = buildSyncPlan(IMAGES, {}, null, NEW_DEPLOYMENT);
    expect(plan.locationEdit).toEqual(NEW_DEPLOYMENT);
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(0);
  });

  it('stamps the new deployment id on a tag edit made in the same sync', () => {
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null, NEW_DEPLOYMENT);
    expect(plan.tagEdits[0].deploymentId).toBe(NEW_DEPLOYMENT.deploymentId);
  });

  it('stamps the new deployment id on a time edit made in the same sync', () => {
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(
      IMAGES,
      { [K1]: { ...seeded, timeOverride: '2024-01-10T09:00:00', dirty: true } },
      null,
      NEW_DEPLOYMENT,
    );
    expect(plan.timeEdits[0].deploymentId).toBe(NEW_DEPLOYMENT.deploymentId);
  });

  it('null pendingLocation leaves locationEdit null (no correction queued)', () => {
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    expect(plan.locationEdit).toBeNull();
  });
});

// The headline round-trip proof: a multi-species image plus a draft that adds a
// third species, run through the real merge, must keep ALL intended species.
describe('buildSyncPlan → mergeObservations round trip', () => {
  const KX = `${PREFIX}IMGX.JPG`;
  const X_IMAGES: TagImage[] = [
    {
      key: KX,
      fileName: 'IMGX.JPG',
      deploymentId: DEP,
      baseTimestamp: '2024-01-10T08:00:00',
      baseObservations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')],
    },
  ];
  const X_OBS_CSV = serializeCsvRows([
    obsRow(KX, '2024-01-10T08:00:00', 'Odocoileus hemionus'),
    obsRow(KX, '2024-01-10T08:00:00', 'Canis latrans'),
  ]);

  it('retains all intended species for the image, never one row', () => {
    const draftObs = [
      obs('Odocoileus hemionus', 1, 'Mule Deer'),
      obs('Canis latrans', 1, 'Coyote'),
      obs('Lynx rufus', 1, 'Bobcat'),
    ];
    const plan = buildSyncPlan(X_IMAGES, { [KX]: draft({ mediaPath: KX, observations: draftObs }) }, null);
    const merged = mergeObservations(X_OBS_CSV, plan.tagEdits);
    const rows = parseObservations(merged).filter((r) => r.mediaId === KX);
    expect(rows.map((r) => r.scientificName).sort()).toEqual([
      'Canis latrans',
      'Lynx rufus',
      'Odocoileus hemionus',
    ]);
  });

  it('preserve-by-inaction: a time-only edit leaves both species rows untouched', () => {
    // Base has two species; the user changes ONLY the timestamp. The tag set is
    // unchanged, so the edit must route to timeEdits (observations:[]) — never
    // through mergeObservations — and both canonical rows survive byte-for-byte.
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, KX, DEP, {
      observations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')],
    });
    const plan = buildSyncPlan(
      X_IMAGES,
      { [KX]: { ...seeded, timeOverride: '2024-01-10T09:00:00', dirty: true } },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(1);
    // observations.csv is untouched (tagEdits empty) → both rows survive verbatim.
    const merged = mergeObservations(X_OBS_CSV, plan.tagEdits);
    expect(merged).toBe(X_OBS_CSV);
    const rows = parseObservations(merged).filter((r) => r.mediaId === KX);
    expect(rows).toHaveLength(2);
    // The media row's col-4 timestamp is rewritten by the time edit.
    const mediaCsv = serializeCsvRows([mediaRow(KX, '2024-01-10T08:00:00')]);
    const mergedMedia = mergeMedia(mediaCsv, plan.timeEdits);
    const mediaRowOut = parseCsvRows(mergedMedia).find((r) => r[MEDIA_COL.mediaId] === KX)!;
    expect(mediaRowOut[MEDIA_COL.timestamp]).toBe('2024-01-10T09:00:00');
  });

  it('marks a corrected estimated timestamp as manual', () => {
    const estimated = { ...IMAGES[1], timestampSource: 'interpolated' as const };
    const plan = buildSyncPlan(
      [estimated],
      { [K2]: draft({ mediaPath: K2, timeOverride: '2024-01-10T09:00:00' }) },
      null,
    );
    expect(plan.timeEdits[0].timestampSource).toBe('manual');

    const row = mediaRow(K2, '2024-01-10T08:00:30');
    row[MEDIA_COL.comments] = '[TIMESTAMP:interpolated][UPLOADER:kept]';
    const merged = mergeMedia(serializeCsvRows([row]), plan.timeEdits);
    const output = parseCsvRows(merged)[0];
    expect(output[MEDIA_COL.comments]).toBe('[TIMESTAMP:manual][UPLOADER:kept]');
  });
});

describe('runSync — dry-run default writes nothing', () => {
  it('returns the planned writes and touches no I/O', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: true },
      io,
    );
    expect(res.status).toBe('dry-run');
    if (res.status === 'dry-run') {
      // observations changed + UploadMeta always changes; media is untouched.
      expect(res.writes.map((w) => w.role).sort()).toEqual(['observations', 'uploadMeta']);
      expect(res.snapshotPrefix).toContain('.sparcd-tagger-snapshots/jg/');
    }
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });

  it('reports noop when there is nothing to sync', async () => {
    const cur = await canonical();
    const { io } = fakeIO(cur);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: false },
      io,
    );
    expect(res.status).toBe('noop');
  });
});

describe('runSync — live write path', () => {
  it('snapshots all four files (+manifest last), replaces changed files in order, clears the journal', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );

    expect(res.status).toBe('synced');
    // Snapshot set is the full pre-change canonical state, manifest written last.
    expect(rec.snapshots.map((s) => s.key.split('/').pop())).toEqual([
      'media.csv', 'observations.csv', 'deployments.csv', 'UploadMeta.json', 'manifest.json',
    ]);
    // Only changed canonical files are replaced, media first then meta — here
    // media is unchanged so it's observations then UploadMeta.
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual([
      'observations.csv', 'UploadMeta.json',
    ]);
    expect(rec.replaces[0].etag).toBe('"obs-1"'); // wrote against the reviewed ETag
    const writtenObservations = parseObservations(rec.replaces[0].body);
    expect(
      writtenObservations.find((row) => row.scientificName === 'Canis latrans')?.observationId,
    ).toBe('IMG002.JPG:0');
    expect(
      writtenObservations.find((row) => row.scientificName === 'Puma concolor')?.observationId,
    ).toBe(`${K1}:0`);
    expect(rec.cleared).toBe(1);
    if (res.status === 'synced') {
      expect(res.summary.additions).toBe(1);
      // Reports exactly the written media so the caller clears only those drafts.
      expect(res.syncedMediaIds).toEqual([K2]);
    }
  });

  it('enters the conflict view when a canonical file changed since grounding', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const staleBase = { ...baseFrom(cur), observations: { etag: '"obs-OLD"', hash: cur.observations.hash } };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: staleBase, plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('conflict');
    if (res.status === 'conflict') expect(res.role).toBe('observations');
    expect(rec.replaces).toHaveLength(0); // nothing written on conflict
  });

  it('re-stamps the snapshot +1s and retries once on a 412 collision', async () => {
    const cur = await canonical();
    const firstStamp = snapshotStamp(NOW);
    const { io, rec } = fakeIO(cur, { snapshotFailsOn: (key) => key.includes(firstStamp) });
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');
    // Every recorded snapshot landed under the bumped (+1s) prefix, manifest last.
    const bumped = snapshotStamp(new Date(NOW.getTime() + 1000));
    expect(rec.snapshots.every((s) => s.key.includes(bumped))).toBe(true);
    expect(rec.snapshots.at(-1)!.key.endsWith('manifest.json')).toBe(true);
  });

  it('reports unsupported when the backend will not enforce IfMatch (501)', async () => {
    const cur = await canonical();
    const { io } = fakeIO(cur, {
      replaceError: () => Object.assign(new Error('no'), { name: 'ConditionalPutUnsupportedError' }),
    });
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('unsupported');
  });
});

describe('runSync — location correction (issue #279)', () => {
  it('rewrites deployments.csv and every media/observation deployment id', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, {}, null, NEW_DEPLOYMENT);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');

    // media, observations, and deployments all change; UploadMeta always does.
    expect(rec.replaces.map((r) => r.key.split('/').pop()).sort()).toEqual([
      'UploadMeta.json',
      'deployments.csv',
      'media.csv',
      'observations.csv',
    ]);

    const writtenMedia = rec.replaces.find((r) => r.key.endsWith('media.csv'))!;
    const mediaRows = parseCsvRows(writtenMedia.body);
    expect(mediaRows.every((r) => r[MEDIA_COL.deploymentId] === NEW_DEPLOYMENT.deploymentId)).toBe(true);

    const writtenObs = rec.replaces.find((r) => r.key.endsWith('observations.csv'))!;
    const obsRows = parseCsvRows(writtenObs.body);
    expect(obsRows.every((r) => r[OBS_COL.deploymentId] === NEW_DEPLOYMENT.deploymentId)).toBe(true);

    const writtenDeployments = rec.replaces.find((r) => r.key.endsWith('deployments.csv'))!;
    const depRows = parseDeployments(writtenDeployments.body);
    expect(depRows).toHaveLength(1);
    expect(depRows[0].deploymentId).toBe(NEW_DEPLOYMENT.deploymentId);
    expect(depRows[0].locationName).toBe(NEW_DEPLOYMENT.locationName);
  });

  it('a species edit and a location correction in the same sync both land', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null, NEW_DEPLOYMENT);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');

    const writtenObs = rec.replaces.find((r) => r.key.endsWith('observations.csv'))!;
    const rows = parseObservations(writtenObs.body);
    expect(rows.every((r) => r.deploymentId === NEW_DEPLOYMENT.deploymentId)).toBe(true);
    expect(rows.find((r) => r.scientificName === 'Canis latrans')).toBeTruthy();
    expect(rows.find((r) => r.scientificName === 'Puma concolor')).toBeTruthy();
  });
});

describe('reader-listing contract — snapshot subtree adds no images', () => {
  // The sparcd-web reader recurses subfolders but returns only .jpg/.mp4. So
  // every object the snapshot writes must be a non-image under the snapshots
  // prefix, or it would show up as a taggable image.
  const IMAGE_EXT = /\.(jpe?g|mp4)$/i;

  it('writes only non-image files under .sparcd-tagger-snapshots/', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(rec.snapshots.length).toBeGreaterThan(0);
    for (const s of rec.snapshots) {
      expect(s.key).toContain(`${PREFIX}.sparcd-tagger-snapshots/`);
      expect(IMAGE_EXT.test(s.key)).toBe(false);
    }
  });
});

describe('runSync — resume a partial sync from the journal', () => {
  it('verifies the written object and continues from the first pending one', async () => {
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
        { role: 'media', key: `${PREFIX}media.csv`, baseETag: '"media-1"', baseHash: cur.media.hash, body: cur.media.text, intendedHash: cur.media.hash, status: 'written', newETag: '"media-2"' },
        { role: 'observations', key: `${PREFIX}observations.csv`, baseETag: '"obs-1"', baseHash: cur.observations.hash, body: 'OBSBODY', intendedHash: await sha256Hex('OBSBODY'), status: 'pending' },
        { role: 'uploadMeta', key: `${PREFIX}UploadMeta.json`, baseETag: '"meta-1"', baseHash: cur.uploadMeta.hash, body: 'METABODY', intendedHash: await sha256Hex('METABODY'), status: 'pending' },
      ],
    };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: false, resumeJournal: journal },
      io,
    );
    expect(res.status).toBe('synced');
    // Media was already written, so resume only writes the two pending objects.
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual(['observations.csv', 'UploadMeta.json']);
    expect(rec.cleared).toBe(1);
  });

  it('a dry-run never writes, even with a resume journal present', async () => {
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
        { role: 'observations', key: `${PREFIX}observations.csv`, baseETag: '"obs-1"', baseHash: cur.observations.hash, body: 'OBSBODY', intendedHash: await sha256Hex('OBSBODY'), status: 'pending' },
      ],
    };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: true, resumeJournal: journal },
      io,
    );
    expect(res.status).toBe('dry-run');
    expect(rec.replaces).toHaveLength(0);
    expect(rec.cleared).toBe(0);
  });
});

function emptyPlan(): SyncPlan {
  return {
    tagEdits: [],
    timeEdits: [],
    locationEdit: null,
    summary: { additions: 0, modifications: 0, removals: 0, timeCorrections: 0 },
  };
}
