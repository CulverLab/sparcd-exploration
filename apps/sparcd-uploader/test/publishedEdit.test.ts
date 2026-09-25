// Stage B guarded-edit proofs. Every effect is injected through a fake `EditIO`,
// so a conflict / clean-apply / scope / dry-run / ordering / 501 case is proven
// without touching a bucket. The conflict cases assert NOTHING is written — the
// core safety guarantee: a stale ETag is a conflict, never a blind overwrite.

import { describe, it, expect } from 'vitest';
import {
  buildDescriptionEdit,
  restampDeployment,
  runPublishedEdit,
  type EditCanonical,
  type EditIO,
  type EditRole,
} from '../src/lib/publishedEdit';
import {
  parseUploadMeta,
  parseCsvRows,
  serializeCsvRows,
  serializeDeployments,
  parseDeployments,
  buildUploadMeta,
  serializeUploadMeta,
  MEDIA_COL,
  OBS_COL,
  MEDIA_COLUMN_COUNT,
  OBS_COLUMN_COUNT,
} from '@sparcd/camtrap';
import { sha256Hex } from '../src/lib/hash';
import { locationToDeployment } from '../src/lib/locations';

const NOW = new Date('2026-06-17T12:00:00Z');
const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
const PREFIX = `Collections/${UUID}/Uploads/2026.01.02.03.04.05/`;
const BUCKET = `sparcd-${UUID}`;
const USER = 'jg';

const DEP_FROM = `${UUID}:SAN15`;
const DEP_TO = `${UUID}:SAN20`;

// --- Fixtures --------------------------------------------------------------

const metaText = serializeUploadMeta(
  buildUploadMeta({
    uploadUser: USER,
    date: new Date('2026-01-02T03:04:05'),
    imageCount: 2,
    imagesWithSpecies: 1,
    bucket: BUCKET,
    uploadPath: PREFIX,
    description: 'original description',
  }),
);

const sourceDeployment = {
  deploymentId: DEP_FROM,
  locationId: 'SAN15',
  locationName: 'San Pedro 15',
  latitude: 31.5,
  longitude: -110.2,
  elevation: 1200,
};

const deploymentsText = serializeDeployments([sourceDeployment]);

// Two media rows on DEP_FROM, with unrelated columns populated so we can prove
// only deployment_id changes.
function mediaRow(key: string, ts: string, name: string): string[] {
  const r = new Array<string>(MEDIA_COLUMN_COUNT).fill('');
  r[MEDIA_COL.mediaId] = key;
  r[MEDIA_COL.deploymentId] = DEP_FROM;
  r[MEDIA_COL.sequenceId] = key;
  r[MEDIA_COL.timestamp] = ts;
  r[MEDIA_COL.filePath] = key;
  r[MEDIA_COL.fileName] = name;
  r[MEDIA_COL.mediaType] = 'image/jpeg';
  r[MEDIA_COL.favorite] = 'false';
  return r;
}
const K1 = `${PREFIX}IMG_0001.JPG`;
const K2 = `${PREFIX}IMG_0002.JPG`;
const mediaText = serializeCsvRows([
  mediaRow(K1, '2024-01-10T08:00:00', 'IMG_0001.JPG'),
  mediaRow(K2, '2024-01-10T08:05:00', 'IMG_0002.JPG'),
]);

function obsRow(key: string, species: string, timestamp = '2024-01-10T08:00:00'): string[] {
  const r = new Array<string>(OBS_COLUMN_COUNT).fill('');
  r[OBS_COL.observationId] = `${key}:0`;
  r[OBS_COL.deploymentId] = DEP_FROM;
  r[OBS_COL.mediaId] = key;
  r[OBS_COL.timestamp] = timestamp;
  r[OBS_COL.scientificName] = species;
  r[OBS_COL.count] = '1';
  r[OBS_COL.comments] = '[COMMONNAME:Coyote]';
  return r;
}
const obsText = serializeCsvRows([obsRow(K1, 'Canis latrans')]);

async function canonical(over: Partial<Record<EditRole, string>> = {}): Promise<EditCanonical> {
  const make = async (role: EditRole, text: string) => ({
    text,
    etag: `"${role}-1"`,
    hash: await sha256Hex(text),
  });
  return {
    deployments: await make('deployments', over.deployments ?? deploymentsText),
    media: await make('media', over.media ?? mediaText),
    observations: await make('observations', over.observations ?? obsText),
    uploadMeta: await make('uploadMeta', over.uploadMeta ?? metaText),
  };
}

const baseFrom = (
  c: EditCanonical,
  roles: EditRole[],
): Partial<Record<EditRole, { etag: string; hash: string }>> => {
  const out: Partial<Record<EditRole, { etag: string; hash: string }>> = {};
  for (const r of roles) out[r] = { etag: c[r]!.etag, hash: c[r]!.hash };
  return out;
};

type Recorder = {
  snapshots: { key: string; body: string }[];
  replaces: { key: string; etag: string; body: string }[];
};

function fakeIO(
  current: EditCanonical,
  opts: { replaceError?: (key: string) => Error | null } = {},
): { io: EditIO; rec: Recorder } {
  const rec: Recorder = { snapshots: [], replaces: [] };
  const io: EditIO = {
    loadCanonical: async (roles) => {
      const out: EditCanonical = {};
      for (const r of roles) out[r] = current[r];
      return out;
    },
    writeSnapshot: async (key, body) => {
      rec.snapshots.push({ key, body });
    },
    replace: async (key, body, etag) => {
      const err = opts.replaceError?.(key);
      if (err) throw err;
      rec.replaces.push({ key, etag, body });
      return { etag: `"new-${key.split('/').pop()}"` };
    },
    now: () => NOW,
  };
  return { io, rec };
}

const conflictErr = () =>
  Object.assign(new Error('changed'), { name: 'ConditionalReplaceConflictError' });
const unsupportedErr = () =>
  Object.assign(new Error('no IfMatch'), { name: 'ConditionalPutUnsupportedError' });

// ===========================================================================

describe('buildDescriptionEdit', () => {
  it('replaces the description and appends the Java edit comment, preserving every other key', () => {
    const next = buildDescriptionEdit(metaText, {
      description: 'corrected description',
      user: USER,
      editStamp: '2026.06.17.12.00.00',
    });
    const meta = parseUploadMeta(next);
    const before = parseUploadMeta(metaText);
    expect(meta.description).toBe('corrected description');
    expect(meta.editComments).toEqual([`Edited by ${USER} on 2026.06.17.12.00.00`]);
    // Everything else byte-identical (tally, bucket, path, upload date, user).
    expect(meta.imageCount).toBe(before.imageCount);
    expect(meta.imagesWithSpecies).toBe(before.imagesWithSpecies);
    expect(meta.bucket).toBe(before.bucket);
    expect(meta.uploadPath).toBe(before.uploadPath);
    expect(meta.uploadUser).toBe(before.uploadUser);
    expect(meta.uploadDate).toEqual(before.uploadDate);
    // Key order is preserved → serialized bytes stay aligned (insertion order).
    expect(Object.keys(meta)).toEqual(Object.keys(before));
  });

  it('tolerates foreign metadata that omits editComments (older SPARC’d / Java)', () => {
    const { editComments, ...noEditComments } = parseUploadMeta(metaText);
    void editComments;
    const foreignText = JSON.stringify(noEditComments);
    const next = buildDescriptionEdit(foreignText, {
      description: 'corrected description',
      user: USER,
      editStamp: '2026.06.17.12.00.00',
    });
    const meta = parseUploadMeta(next);
    expect(meta.description).toBe('corrected description');
    expect(meta.editComments).toEqual([`Edited by ${USER} on 2026.06.17.12.00.00`]);
  });
});

describe('restampDeployment scope', () => {
  it('rebases media and observation timestamps when the location timezone changes', () => {
    const target = locationToDeployment(
      { key: 'NY|x', id: 'NY', name: 'New York', latitude: 40.7, longitude: -74, elevation: 10 },
      UUID,
    );
    const mediaWithOffset = serializeCsvRows([mediaRow(K1, '2026-07-01T12:00:00.000-07:00', 'IMG_0001.JPG')]);
    const obsWithOffset = serializeCsvRows([
      obsRow(K1, 'Canis latrans', '2026-07-01T12:00:00.000-07:00'),
    ]);
    const next = restampDeployment(
      { deployments: deploymentsText, media: mediaWithOffset, observations: obsWithOffset },
      {
        fromDeploymentId: DEP_FROM,
        toDeploymentId: `${UUID}:NY`,
        location: target,
        fromTimeZone: 'America/Phoenix',
        toTimeZone: 'America/New_York',
      },
    );
    expect(parseCsvRows(next.media)[0][MEDIA_COL.timestamp]).toBe('2026-07-01T12:00:00.000-04:00');
    expect(parseCsvRows(next.observations)[0][OBS_COL.timestamp]).toBe('2026-07-01T12:00:00.000-04:00');
  });

  it('updates deployment_id in all three CSVs and nowhere else', () => {
    const target = locationToDeployment(
      { key: 'SAN20|x', id: 'SAN20', name: 'San Pedro 20', latitude: 32.1, longitude: -111.3, elevation: 1300 },
      UUID,
    );
    const next = restampDeployment(
      { deployments: deploymentsText, media: mediaText, observations: obsText },
      { fromDeploymentId: DEP_FROM, toDeploymentId: DEP_TO, location: target },
    );

    // deployments.csv: the row now points to SAN20 with the new coords/name.
    const [dep] = parseDeployments(next.deployments);
    expect(dep.deploymentId).toBe(DEP_TO);
    expect(dep.locationId).toBe('SAN20');
    expect(dep.locationName).toBe('San Pedro 20');

    // media.csv: deployment_id changed on every row, EVERYTHING else identical.
    const beforeMedia = parseCsvRows(mediaText);
    const afterMedia = parseCsvRows(next.media);
    expect(afterMedia.length).toBe(beforeMedia.length);
    afterMedia.forEach((row, i) => {
      row.forEach((cell, col) => {
        if (col === MEDIA_COL.deploymentId) {
          expect(cell).toBe(DEP_TO);
          expect(beforeMedia[i][col]).toBe(DEP_FROM);
        } else {
          expect(cell).toBe(beforeMedia[i][col]); // unchanged
        }
      });
    });

    // observations.csv: same — only deployment_id changes.
    const beforeObs = parseCsvRows(obsText);
    const afterObs = parseCsvRows(next.observations);
    afterObs.forEach((row, i) => {
      row.forEach((cell, col) => {
        if (col === OBS_COL.deploymentId) expect(cell).toBe(DEP_TO);
        else expect(cell).toBe(beforeObs[i][col]);
      });
    });
  });

  it('leaves rows on an unrelated deployment untouched', () => {
    const otherDep = `${UUID}:OTHER`;
    const mixed = serializeCsvRows([
      mediaRow(K1, '2024-01-10T08:00:00', 'IMG_0001.JPG'),
      (() => {
        const r = mediaRow(K2, '2024-01-10T08:05:00', 'IMG_0002.JPG');
        r[MEDIA_COL.deploymentId] = otherDep;
        return r;
      })(),
    ]);
    const target = locationToDeployment(
      { key: 'SAN20|x', id: 'SAN20', name: 'San Pedro 20', latitude: 32.1, longitude: -111.3, elevation: 1300 },
      UUID,
    );
    const next = restampDeployment(
      { deployments: deploymentsText, media: mixed, observations: '' },
      { fromDeploymentId: DEP_FROM, toDeploymentId: DEP_TO, location: target },
    );
    const rows = parseCsvRows(next.media);
    expect(rows[0][MEDIA_COL.deploymentId]).toBe(DEP_TO);
    expect(rows[1][MEDIA_COL.deploymentId]).toBe(otherDep); // untouched
  });

  it('empty observations.csv stays empty', () => {
    const target = locationToDeployment(
      { key: 'SAN20|x', id: 'SAN20', name: 'San Pedro 20', latitude: 32.1, longitude: -111.3, elevation: 1300 },
      UUID,
    );
    const next = restampDeployment(
      { deployments: deploymentsText, media: mediaText, observations: '' },
      { fromDeploymentId: DEP_FROM, toDeploymentId: DEP_TO, location: target },
    );
    expect(next.observations).toBe('');
  });
});

describe('runPublishedEdit — description, guarded', () => {
  it('stale uploadMeta ETag → conflict, writes NOTHING', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const body = buildDescriptionEdit(metaText, { description: 'x', user: USER, editStamp: 's' });
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: { uploadMeta: { etag: '"stale"', hash: 'stale' } },
        bodies: { uploadMeta: body },
        dryRun: false,
      },
      io,
    );
    expect(res.status).toBe('conflict');
    if (res.status === 'conflict') expect(res.role).toBe('uploadMeta');
    expect(rec.snapshots).toHaveLength(0); // no snapshot
    expect(rec.replaces).toHaveLength(0); // no overwrite
  });

  it('clean base applies, snapshot first then replace, new body carries the edit', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const body = buildDescriptionEdit(metaText, { description: 'corrected', user: USER, editStamp: 's' });
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur, ['uploadMeta']),
        bodies: { uploadMeta: body },
        dryRun: false,
      },
      io,
    );
    expect(res.status).toBe('edited');
    // Snapshot (current bytes) + manifest precede the replace.
    expect(rec.snapshots.map((s) => s.key.split('/').pop())).toEqual(['UploadMeta.json', 'manifest.json']);
    expect(rec.snapshots[0].body).toBe(metaText); // pre-edit bytes snapshotted
    expect(rec.replaces).toHaveLength(1);
    expect(rec.replaces[0].etag).toBe('"uploadMeta-1"'); // wrote against the reviewed ETag
    expect(parseUploadMeta(rec.replaces[0].body).description).toBe('corrected');
    // Manifest lists the pre-edit ETag (recoverable rollback).
    const manifest = JSON.parse(rec.snapshots[1].body);
    expect(manifest.files[0]).toMatchObject({ name: 'UploadMeta.json', etag: '"uploadMeta-1"' });
  });

  it('dry-run returns planned writes and touches nothing', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const body = buildDescriptionEdit(metaText, { description: 'corrected', user: USER, editStamp: 's' });
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur, ['uploadMeta']),
        bodies: { uploadMeta: body },
        dryRun: true,
      },
      io,
    );
    expect(res.status).toBe('dry-run');
    if (res.status === 'dry-run') {
      expect(res.writes.map((w) => w.role)).toEqual(['uploadMeta']);
      expect(res.snapshotPrefix).toContain('.sparcd-uploader-snapshots/jg/');
    }
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });

  it('unchanged description → noop, no writes', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur, ['uploadMeta']),
        bodies: { uploadMeta: metaText }, // identical body
        dryRun: false,
      },
      io,
    );
    expect(res.status).toBe('noop');
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });
});

describe('runPublishedEdit — deployment correction, guarded', () => {
  const target = locationToDeployment(
    { key: 'SAN20|x', id: 'SAN20', name: 'San Pedro 20', latitude: 32.1, longitude: -111.3, elevation: 1300 },
    UUID,
  );
  const bodiesFor = (cur: EditCanonical) => {
    const next = restampDeployment(
      { deployments: cur.deployments!.text, media: cur.media!.text, observations: cur.observations!.text },
      { fromDeploymentId: DEP_FROM, toDeploymentId: DEP_TO, location: target },
    );
    return { deployments: next.deployments, media: next.media, observations: next.observations };
  };

  it('clean apply re-stamps all three CSVs, snapshot first, in role order', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur, ['deployments', 'media', 'observations']),
        bodies: bodiesFor(cur),
        dryRun: false,
      },
      io,
    );
    expect(res.status).toBe('edited');
    expect(rec.snapshots.map((s) => s.key.split('/').pop())).toEqual([
      'deployments.csv',
      'media.csv',
      'observations.csv',
      'manifest.json',
    ]);
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual([
      'deployments.csv',
      'media.csv',
      'observations.csv',
    ]);
    // The written media body carries the new deployment_id.
    expect(parseCsvRows(rec.replaces[1].body)[0][MEDIA_COL.deploymentId]).toBe(DEP_TO);
  });

  it('stale media ETag → conflict, NEITHER snapshot NOR replace runs', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: {
          deployments: { etag: cur.deployments!.etag, hash: cur.deployments!.hash },
          media: { etag: '"stale"', hash: 'stale' }, // changed remotely
          observations: { etag: cur.observations!.etag, hash: cur.observations!.hash },
        },
        bodies: bodiesFor(cur),
        dryRun: false,
      },
      io,
    );
    expect(res.status).toBe('conflict');
    if (res.status === 'conflict') expect(res.role).toBe('media');
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });

  it('re-stamp to the same deployment → noop', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const same = restampDeployment(
      { deployments: cur.deployments!.text, media: cur.media!.text, observations: cur.observations!.text },
      { fromDeploymentId: DEP_FROM, toDeploymentId: DEP_FROM, location: sourceDeployment },
    );
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur, ['deployments', 'media', 'observations']),
        bodies: { deployments: same.deployments, media: same.media, observations: same.observations },
        dryRun: false,
      },
      io,
    );
    expect(res.status).toBe('noop');
    expect(rec.replaces).toHaveLength(0);
  });

  it('a mid-write 412 maps to conflict; 501 maps to unsupported', async () => {
    const cur1 = await canonical();
    const conflictIO = fakeIO(cur1, { replaceError: (k) => (k.endsWith('media.csv') ? conflictErr() : null) });
    const res1 = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur1, ['deployments', 'media', 'observations']),
        bodies: bodiesFor(cur1),
        dryRun: false,
      },
      conflictIO.io,
    );
    expect(res1.status).toBe('conflict');
    if (res1.status === 'conflict') expect(res1.role).toBe('media');
    // deployments was written before the media conflict; the snapshot preceded it.
    expect(conflictIO.rec.replaces.map((r) => r.key.split('/').pop())).toEqual(['deployments.csv']);
    expect(conflictIO.rec.snapshots.length).toBeGreaterThan(0);

    const cur2 = await canonical();
    const unsupportedIO = fakeIO(cur2, { replaceError: () => unsupportedErr() });
    const res2 = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur2, ['deployments', 'media', 'observations']),
        bodies: bodiesFor(cur2),
        dryRun: false,
      },
      unsupportedIO.io,
    );
    expect(res2.status).toBe('unsupported');
  });

  it('dry-run lists all three planned writes, touches nothing', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const res = await runPublishedEdit(
      {
        bucket: BUCKET,
        uploadPrefix: PREFIX,
        user: USER,
        base: baseFrom(cur, ['deployments', 'media', 'observations']),
        bodies: bodiesFor(cur),
        dryRun: true,
      },
      io,
    );
    expect(res.status).toBe('dry-run');
    if (res.status === 'dry-run') {
      expect(res.writes.map((w) => w.role).sort()).toEqual(['deployments', 'media', 'observations']);
    }
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });
});
