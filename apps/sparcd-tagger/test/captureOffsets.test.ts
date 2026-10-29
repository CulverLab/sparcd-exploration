import { describe, it, expect } from 'vitest';
import {
  serializeCsvRows,
  parseCsvRows,
  serializeUploadMeta,
  buildUploadMeta,
  serializeDeployments,
  rebaseCaptureTimestamp,
  shiftTimestamp,
  MEDIA_COL,
  OBS_COL,
  MEDIA_COLUMN_COUNT,
  OBS_COLUMN_COUNT,
  ZERO_OFFSET,
  type Deployment,
} from '@sparcd/camtrap';
import { buildSyncPlan, runSync, type CanonicalState, type SyncIO } from '../src/lib/sync';
import { normalizeTimestampInput } from '../src/lib/timeshift';
import { sha256Hex } from '../src/lib/hash';
import type { TagImage } from '../src/lib/workspace';
import type { DraftRecord } from '../src/lib/db';

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

// Phoenix (America/Phoenix, -07:00 all year) → New York (America/New_York, -05:00 in January).
const PHX: Deployment = { deploymentId: DEP, locationId: 'SAN15', locationName: 'San Pedro 15', latitude: 31.5, longitude: -110.2, elevation: 1200 };
const NYC: Deployment = { deploymentId: 'uuid:NYC1', locationId: 'NYC1', locationName: 'New York 1', latitude: 40.7, longitude: -74.0, elevation: 10 };
const META = (captureTimeZone?: string) => serializeUploadMeta(buildUploadMeta({
  uploadUser: 'orig', date: new Date('2024-01-15T10:00:00Z'), imageCount: 2, imagesWithSpecies: 1,
  bucket: 'sparcd-x', uploadPath: PREFIX, description: '', captureTimeZone,
}));

async function canonical(media: string, observations: string, deployments: string, uploadMeta: string): Promise<CanonicalState> {
  return {
    media: { text: media, etag: '"m"', hash: await sha256Hex(media) },
    observations: { text: observations, etag: '"o"', hash: await sha256Hex(observations) },
    deployments: { text: deployments, etag: '"d"', hash: await sha256Hex(deployments) },
    uploadMeta: { text: uploadMeta, etag: '"u"', hash: await sha256Hex(uploadMeta) },
  };
}
function fakeIO(current: CanonicalState) {
  const replaces: { key: string; body: string }[] = [];
  const io: SyncIO = {
    loadCanonical: async () => current,
    writeSnapshot: async () => {},
    replace: async (key, body) => { replaces.push({ key, body }); return { etag: '"n"' }; },
    saveJournal: async () => {},
    clearJournal: async () => {},
    now: () => new Date('2024-01-20T14:30:00'),
  };
  return { io, replaces };
}
const baseFrom = (c: CanonicalState) => ({
  media: { etag: c.media.etag, hash: c.media.hash },
  observations: { etag: c.observations.etag, hash: c.observations.hash },
  deployments: { etag: c.deployments.etag, hash: c.deployments.hash },
  uploadMeta: { etag: c.uploadMeta.etag, hash: c.uploadMeta.hash },
});
const draft = (over: Partial<DraftRecord>): DraftRecord => ({
  id: '', bucket: 'sparcd-x', uploadPrefix: PREFIX, mediaPath: '', deploymentId: DEP, observations: [],
  questionable: false, timeOverride: null, lastEdited: '', dirty: true, ...over,
});

describe('tag edit + location change in one sync', () => {
  it('rebases the freshly written observation row to the new zone too', async () => {
    const ts1 = '2024-01-10T08:00:00.000-07:00';
    const ts2 = '2024-01-10T08:00:30.000-07:00';
    const cur = await canonical(
      serializeCsvRows([mediaRow(K1, ts1), mediaRow(K2, ts2)]),
      serializeCsvRows([obsRow(K1, ts1, 'Puma concolor')]),
      serializeDeployments([PHX]),
      META('America/Phoenix'),
    );
    const images: TagImage[] = [
      { key: K1, fileName: 'IMG001.JPG', deploymentId: DEP, baseTimestamp: ts1, baseObservations: [{ scientificName: 'Puma concolor', commonName: '', count: 1, requestedSpecies: '', freeTags: '' }] },
      { key: K2, fileName: 'IMG002.JPG', deploymentId: DEP, baseTimestamp: ts2, baseObservations: [] },
    ];
    const drafts = { [K2]: draft({ mediaPath: K2, observations: [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 1, requestedSpecies: '', freeTags: '' }] }) };
    // Tag.tsx passes the CURRENT deployment's zone (tzlookup of deployments.csv) as timeZone.
    const plan = buildSyncPlan(images, drafts, null, NYC, '', 'America/Phoenix');
    const { io, replaces } = fakeIO(cur);
    const res = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false }, io);
    expect(res.status).toBe('synced');
    const media = parseCsvRows(replaces.find((r) => r.key.endsWith('media.csv'))!.body);
    const obs = parseCsvRows(replaces.find((r) => r.key.endsWith('observations.csv'))!.body);
    const mediaK2 = media.find((r) => r[MEDIA_COL.mediaId] === K2)![MEDIA_COL.timestamp];
    const obsK2 = obs.find((r) => r[OBS_COL.mediaId] === K2)![OBS_COL.timestamp];
    const obsK1 = obs.find((r) => r[OBS_COL.mediaId] === K1)![OBS_COL.timestamp];
    expect(mediaK2).toBe('2024-01-10T08:00:30.000-05:00');
    expect(obsK1).toBe('2024-01-10T08:00:00.000-05:00');
    // The new observation row for K2 must match its media row.
    expect(obsK2).toBe(mediaK2);
  });
});

describe('a Z (UTC) value read as local wall clock', () => {
  // 15:00Z is 08:00 in Phoenix. An upload-wide +1h correction must land on 09:00 Phoenix (16:00Z).
  it('upload-level time shift in the Tagger keeps the instant of a Z base', () => {
    const plan = buildSyncPlan(
      [{ key: K1, fileName: 'IMG001.JPG', deploymentId: DEP, baseTimestamp: '2024-01-10T15:00:00.000Z', baseObservations: [] }],
      {},
      { ...ZERO_OFFSET, hours: 1 },
      null,
      '',
      'America/Phoenix',
    );
    expect(plan.timeEdits[0].mediaTimestamp).toBe('2024-01-10T09:00:00.000-07:00');
  });

  it('bulk/selection shift (shiftTimestamp with a zone) keeps the instant of a Z value', () => {
    const out = shiftTimestamp('2024-01-10T15:00:00.000Z', { ...ZERO_OFFSET, minutes: 15 }, 'America/Phoenix');
    expect(out).toBe('2024-01-10T08:15:00.000-07:00');
  });

  it('a per-image edit on a Z image, then a location change, keeps the capture instant', () => {
    // PerImageTime seeds the box with the raw Z value; user changes 15:00 → 15:30 and commits.
    const committed = normalizeTimestampInput('2024-01-10T15:30:00.000Z', 'Z', 'America/Phoenix')!;
    expect(committed).toBe('2024-01-10T08:30:00.000-07:00');
    // Later location correction Phoenix → New York.
    const rebased = rebaseCaptureTimestamp(committed, 'America/Phoenix', 'America/New_York');
    // 15:30Z was 08:30 Phoenix wall clock → 08:30 New York wall clock.
    expect(rebased).toBe('2024-01-10T08:30:00.000-05:00');
  });

  it('the per-image editor accepts a stored six-digit fraction', () => {
    expect(normalizeTimestampInput('2024-01-10T15:30:00.123456Z', 'Z', 'America/Phoenix')).toBe('2024-01-10T08:30:00.123456-07:00');
  });
});

describe('stale UploadMeta.captureTimeZone on a second location change', () => {
  it('Phoenix → (already rebased) → back to New York still rebases', async () => {
    // Upload was made in New York (captureTimeZone persisted), then corrected once to Phoenix,
    // so the file now holds Phoenix offsets. Correct it back to New York.
    const ts = '2024-07-10T08:00:00.000-07:00';
    const cur = await canonical(
      serializeCsvRows([mediaRow(K1, ts)]),
      serializeCsvRows([obsRow(K1, ts, 'Puma concolor')]),
      serializeDeployments([PHX]),
      META('America/New_York'),
    );
    const images: TagImage[] = [{ key: K1, fileName: 'IMG001.JPG', deploymentId: DEP, baseTimestamp: ts, baseObservations: [{ scientificName: 'Puma concolor', commonName: '', count: 1, requestedSpecies: '', freeTags: '' }] }];
    const plan = buildSyncPlan(images, {}, null, NYC, '', 'America/Phoenix');
    const { io, replaces } = fakeIO(cur);
    await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false }, io);
    const media = parseCsvRows(replaces.find((r) => r.key.endsWith('media.csv'))!.body);
    expect(media[0][MEDIA_COL.deploymentId]).toBe(NYC.deploymentId);
    expect(media[0][MEDIA_COL.timestamp]).toBe('2024-07-10T08:00:00.000-04:00');
  });
});

describe('same deployment id, different coordinates (duplicate locations.json ids)', () => {
  it('keeps a deployments.csv row when the picked location shares the current deployment id', async () => {
    const ts = '2024-01-10T08:00:00.000-07:00';
    const cur = await canonical(
      serializeCsvRows([mediaRow(K1, ts)]),
      serializeCsvRows([obsRow(K1, ts, 'Puma concolor')]),
      serializeDeployments([PHX]),
      META('America/Phoenix'),
    );
    // Same locationId (so same deploymentId), different name/coords — allowed by ChangeLocationModal.sameLocation.
    const sameIdOtherCoords: Deployment = { ...PHX, locationName: '*DO NOT USE* San Pedro 15', latitude: 31.6, longitude: -110.3 };
    const images: TagImage[] = [{ key: K1, fileName: 'IMG001.JPG', deploymentId: DEP, baseTimestamp: ts, baseObservations: [{ scientificName: 'Puma concolor', commonName: '', count: 1, requestedSpecies: '', freeTags: '' }] }];
    const plan = buildSyncPlan(images, {}, null, sameIdOtherCoords, '', 'America/Phoenix');
    const { io, replaces } = fakeIO(cur);
    const res = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false }, io);
    expect(res.status).toBe('synced');
    const dep = replaces.find((r) => r.key.endsWith('deployments.csv'))?.body ?? '(not written)';
    expect(parseCsvRows(dep)).toHaveLength(1);
  });
});
