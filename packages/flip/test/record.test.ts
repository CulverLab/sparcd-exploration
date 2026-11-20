// The hand-off record's contract: a round trip preserves the batch, and the
// merge helpers only ever touch the images they were handed. Runs against
// fake-indexeddb, so it exercises the real Dexie schema — Blobs and directory
// handles are left out because Node has nothing to structured-clone them from.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  flipDb,
  mergeTags,
  captureTimestampOf,
  writeFlipRecord,
  readFlipRecord,
  deleteFlipRecord,
  pruneFlipRecords,
  updateFlipTags,
  finishFlipRecord,
  snapshotOwnedFlipRecords,
  discardOwnedFlipSnapshot,
  deriveFlipOwnerScope,
  canonicalFlipEndpoint,
  type FlipFile,
  type FlipObservation,
  type FlipRecord,
} from '../src/index';

const coyote: FlipObservation = {
  scientificName: 'Canis latrans',
  commonName: 'Coyote',
  count: 2,
  requestedSpecies: '',
  freeTags: '',
};

const ghost: FlipObservation = {
  scientificName: 'Casper',
  commonName: 'Ghost',
  count: 1,
  requestedSpecies: '',
  freeTags: '',
};

const OWNER_A = `flip-owner-v1:${'a'.repeat(64)}`;
const OWNER_B = `flip-owner-v1:${'b'.repeat(64)}`;

/** A file carrying everything the uploader's Inspect pass establishes. */
const inspected = (over: Partial<FlipFile> = {}): FlipFile => ({
  relPath: 'SD/IMG_0001.JPG',
  fileName: 'IMG_0001.JPG',
  size: 100,
  sha256: 'aa',
  mediaKind: 'image',
  exifTimestamp: '2026-07-01T12:00:00',
  mimeType: 'image/jpeg',
  exifCamera: 'RECONYX HP2X',
  gps: { lat: 31.5, lon: -110.2 },
  width: 2048,
  height: 1536,
  ...over,
});

const record = (over: Partial<FlipRecord> = {}): FlipRecord => ({
  id: 'batch-1',
  v: 1,
  createdAt: '2026-08-25T10:00:00.000Z',
  returnUrl: '/sparcd-exploration/uploader/?flip=batch-1',
  files: [inspected(), { ...inspected(), relPath: 'SD/IMG_0002.JPG', fileName: 'IMG_0002.JPG' }],
  tags: {},
  ownerScope: OWNER_A,
  ...over,
});

beforeEach(async () => {
  await flipDb.records.clear();
});

describe('mergeTags', () => {
  it('leaves images the partial does not mention alone', () => {
    const merged = mergeTags({ a: [coyote], b: [ghost] }, { a: [ghost] });
    expect(merged).toEqual({ a: [ghost], b: [ghost] });
  });

  it('treats an empty array as a real value — a detagged image', () => {
    expect(mergeTags({ a: [coyote] }, { a: [] })).toEqual({ a: [] });
  });
});

describe('capture time', () => {
  it('shows the time the camera wrote when there is one', () => {
    expect(captureTimestampOf(inspected())).toBe('2026-07-01T12:00:00');
  });

  it('falls back to a time entered by hand', () => {
    const f = inspected({ exifTimestamp: undefined, manualTimestamp: '2026-07-01T09:30:00' });
    expect(captureTimestampOf(f)).toBe('2026-07-01T09:30:00');
  });

  it('prefers the camera over a stray manual entry, as the bundle does', () => {
    expect(captureTimestampOf(inspected({ manualTimestamp: '2020-01-01T00:00:00' }))).toBe(
      '2026-07-01T12:00:00',
    );
  });

  it('lets a hand entry override an EXIF ModifyDate candidate', () => {
    expect(captureTimestampOf(inspected({
      exifTimestampSource: 'exif-modify', timestampSource: 'manual', manualTimestamp: '2020-01-01T00:00:00',
    }))).toBe('2020-01-01T00:00:00');
  });

  it('is absent for a file with neither', () => {
    expect(captureTimestampOf(inspected({ exifTimestamp: undefined }))).toBeUndefined();
  });
});

describe('the record round trip', () => {
  it('reads back everything the uploader wrote', async () => {
    await writeFlipRecord(record());
    const back = await readFlipRecord('batch-1');
    expect(back).toEqual({ ...record(), revision: 2, usedAt: expect.any(String) });
  });

  it('requires an owner scope for newly written handoffs', async () => {
    await expect(writeFlipRecord(record({ ownerScope: undefined }))).rejects.toThrow('owner scope');
    expect(await flipDb.records.count()).toBe(0);
  });

  it('does not read a handoff under another owner scope', async () => {
    await writeFlipRecord(record());
    expect(await readFlipRecord('batch-1', OWNER_B)).toBeUndefined();
    expect((await flipDb.records.get('batch-1'))?.revision).toBe(1);
    expect(await readFlipRecord('batch-1', OWNER_A)).toMatchObject({ ownerScope: OWNER_A, revision: 2 });
  });

  it('enumerates and discards only unchanged records owned by the confirmed login', async () => {
    await writeFlipRecord(record({ id: 'keep-a' }));
    await writeFlipRecord(record({ id: 'change-a' }));
    await writeFlipRecord(record({ id: 'foreign', ownerScope: OWNER_B }));
    await flipDb.records.put({ ...record({ id: 'unsupported-owned' }), v: 3 } as unknown as FlipRecord);
    // Simulate a quarantined legacy row that has no proven owner.
    await flipDb.records.put(record({ id: 'legacy', ownerScope: undefined }));

    const snapshot = await snapshotOwnedFlipRecords(OWNER_A);
    expect(snapshot.map(row => row.id).sort()).toEqual(['change-a', 'keep-a', 'unsupported-owned']);
    const changed = await flipDb.records.get('change-a');
    await flipDb.records.put({ ...changed!, tags: { newer: [coyote] }, revision: changed!.revision! + 1 });
    await flipDb.records.put(record({ id: 'late-a' }));

    const result = await discardOwnedFlipSnapshot(OWNER_A, snapshot);
    expect(result).toEqual({ deleted: 2, retainedChanged: 1 });
    expect(await flipDb.records.get('keep-a')).toBeUndefined();
    expect(await flipDb.records.get('unsupported-owned')).toBeUndefined();
    expect((await flipDb.records.get('change-a'))?.tags).toEqual({ newer: [coyote] });
    expect((await flipDb.records.get('foreign'))?.ownerScope).toBe(OWNER_B);
    expect((await flipDb.records.get('legacy'))?.ownerScope).toBeUndefined();
    expect((await flipDb.records.get('late-a'))?.ownerScope).toBe(OWNER_A);
  });

  it('compares complete thumbnail bytes when an owner record changes during review', async () => {
    const image = (text: string) => new Blob([text], { type: 'image/jpeg' });
    await writeFlipRecord(record({ files: [inspected({ thumb: image('old') })] }));
    const snapshot = await snapshotOwnedFlipRecords(OWNER_A);
    const current = await flipDb.records.get('batch-1');
    await flipDb.records.put({ ...current!, files: [inspected({ thumb: image('new') })] });
    expect(await discardOwnedFlipSnapshot(OWNER_A, snapshot)).toEqual({ deleted: 0, retainedChanged: 1 });
    expect(await flipDb.records.get('batch-1')).toBeDefined();
  });

  // The batch is rebuilt from this record on the way back, and there is no
  // second Inspect pass — a field that does not survive the round trip is a
  // field the uploader has to publish without.
  it('keeps every result Inspect established, not just what draws a tile', async () => {
    await writeFlipRecord(record());
    const [file] = (await readFlipRecord('batch-1'))!.files;
    expect(file.mimeType).toBe('image/jpeg');
    expect(file.exifCamera).toBe('RECONYX HP2X');
    expect(file.gps).toEqual({ lat: 31.5, lon: -110.2 });
    expect(file.width).toBe(2048);
    expect(file.height).toBe(1536);
  });

  it('keeps a hand-entered time in its own slot, never in the camera one', async () => {
    const manual = inspected({ exifTimestamp: undefined, manualTimestamp: '2026-07-01T09:30:00' });
    await writeFlipRecord(record({ files: [manual] }));
    const [file] = (await readFlipRecord('batch-1'))!.files;
    expect(file.exifTimestamp).toBeUndefined();
    expect(file.manualTimestamp).toBe('2026-07-01T09:30:00');
  });

  it('is absent for an id nobody wrote', async () => {
    expect(await readFlipRecord('nope')).toBeUndefined();
  });

  it('reports a record from a schema it does not know as absent', async () => {
    await flipDb.records.put({ ...record(), v: 3 } as unknown as FlipRecord);
    expect(await readFlipRecord('batch-1')).toBeUndefined();
  });
});

describe('not keeping batches forever', () => {
  it('deletes a record outright', async () => {
    await writeFlipRecord(record());
    await deleteFlipRecord('batch-1');
    expect(await readFlipRecord('batch-1')).toBeUndefined();
  });

  it('scopes completed-publication cleanup to the owning login', async () => {
    await writeFlipRecord(record({ id: 'owned' }));
    await writeFlipRecord(record({ id: 'foreign', ownerScope: OWNER_B }));
    expect(await deleteFlipRecord('foreign', OWNER_A)).toBe(false);
    expect(await flipDb.records.get('foreign')).toBeDefined();
    expect(await deleteFlipRecord('owned', OWNER_A)).toBe(true);
    expect(await flipDb.records.get('owned')).toBeUndefined();
    expect(await flipDb.records.get('foreign')).toBeDefined();
  });

  it('sweeps up hand-offs nobody came back for', async () => {
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    await writeFlipRecord(record({ id: 'stale', createdAt: old }));
    await writeFlipRecord(record({ id: 'fresh', createdAt: new Date().toISOString() }));
    const removed = await pruneFlipRecords();
    expect(removed).toBe(1);
    expect(await readFlipRecord('stale')).toBeUndefined();
    expect(await readFlipRecord('fresh')).toBeDefined();
  });

  it('keeps a batch that is merely a fortnight old', async () => {
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const fortnight = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    await writeFlipRecord(record({ createdAt: fortnight }));
    expect(await pruneFlipRecords(now)).toBe(0);
  });

  it('prunes v1 records only after the strict 30-day boundary and retains unknown dates', async () => {
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const exact = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const before = new Date(now - 30 * 24 * 60 * 60 * 1000 + 1).toISOString();
    const after = new Date(now - 30 * 24 * 60 * 60 * 1000 - 1).toISOString();
    await flipDb.records.put(record({ id: 'before', ownerScope: OWNER_B, usedAt: before }));
    await flipDb.records.put(record({ id: 'exact', ownerScope: OWNER_B, usedAt: exact }));
    await flipDb.records.put(record({ id: 'after', ownerScope: OWNER_B, usedAt: after }));
    await flipDb.records.put(record({ id: 'ownerless-old', ownerScope: undefined, usedAt: after }));
    await flipDb.records.put(record({ id: 'invalid', ownerScope: undefined, usedAt: 'not-a-date' }));
    await flipDb.records.put(record({ id: 'missing', ownerScope: undefined, createdAt: 'not-a-date', usedAt: undefined }));
    expect(await pruneFlipRecords(now)).toBe(2);
    expect(await flipDb.records.get('before')).toBeDefined();
    expect(await flipDb.records.get('exact')).toBeDefined();
    expect(await flipDb.records.get('after')).toBeUndefined();
    expect(await flipDb.records.get('ownerless-old')).toBeUndefined();
    expect(await flipDb.records.get('invalid')).toBeDefined();
    expect(await flipDb.records.get('missing')).toBeDefined();
  });

  // A batch tagged over weeks and then carried until there is a connection is
  // not abandoned, however long ago it was handed over.
  it('ages a batch from its last use, not from when it was handed over', async () => {
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();
    await writeFlipRecord(record({ id: 'carried', createdAt: daysAgo(45), usedAt: daysAgo(10) }));
    await writeFlipRecord(record({ id: 'abandoned', createdAt: daysAgo(45), usedAt: daysAgo(31) }));
    expect(await pruneFlipRecords(now)).toBe(1);
    expect(await flipDb.records.get('carried')).toBeDefined();
    expect(await flipDb.records.get('abandoned')).toBeUndefined();
  });

  it('counts opening the batch and tagging it as use', async () => {
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    await writeFlipRecord(record({ id: 'opened', createdAt: old }));
    await writeFlipRecord(record({ id: 'tagged', createdAt: old }));
    await writeFlipRecord(record({ id: 'handed-back', createdAt: old }));
    await writeFlipRecord(record({ id: 'untouched', createdAt: old }));
    await readFlipRecord('opened');
    await updateFlipTags('tagged', { 'SD/IMG_0001.JPG': [coyote] });
    await finishFlipRecord('handed-back', {}, 'anita');
    expect(await pruneFlipRecords()).toBe(1);
    expect(await flipDb.records.get('untouched')).toBeUndefined();
  });

  // Opened on day 1, tagged on day 20, swept on day 45: only the tag write
  // keeps it inside the 30 days.
  it.each([
    ['a per-image save', (id: string) => updateFlipTags(id, { 'SD/IMG_0001.JPG': [coyote] })],
    ['the hand-back', (id: string) => finishFlipRecord(id, { 'SD/IMG_0001.JPG': [coyote] }, 'anita')],
  ])('keeps a batch whose last use was %s', async (_, tag) => {
    const day = (d: number) => Date.parse('2026-08-01T00:00:00.000Z') + d * 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(day(0));
      await writeFlipRecord(record({ createdAt: new Date().toISOString() }));
      vi.setSystemTime(day(1));
      await readFlipRecord('batch-1');
      vi.setSystemTime(day(20));
      await tag('batch-1');
      expect(await pruneFlipRecords(day(45))).toBe(0);
      expect((await flipDb.records.get('batch-1'))!.tags['SD/IMG_0001.JPG']).toEqual([coyote]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Flip owner scope', () => {
  it('canonicalizes configured endpoint spelling and drops query/fragment', () => {
    expect(canonicalFlipEndpoint({ endpoint: 'HTTPS://EXAMPLE.ORG:443/api/./v1///?token=x#fragment', region: 'ignored' }))
      .toBe('["url-v1","https","example.org","","/api/v1"]');
    expect(canonicalFlipEndpoint({ endpoint: 'example.org:80/api', secure: false, region: 'ignored' }))
      .toBe('["url-v1","http","example.org","","/api"]');
  });

  it('canonicalizes an implicit endpoint by provider and region', () => {
    expect(canonicalFlipEndpoint({ endpoint: '', providerId: 'AWS-S3', region: 'US-WEST-2' }))
      .toBe('["implicit-s3-v1","aws-s3","us-west-2"]');
    expect(() => canonicalFlipEndpoint({ endpoint: '', region: 'us-east-1' })).toThrow('provider ID');
  });

  it('derives implicit endpoint ownership from provider and region', async () => {
    const config = { endpoint: '', providerId: 'AWS-S3', region: 'US-WEST-2', accessKey: 'AccessId-A', secure: true };
    const first = await deriveFlipOwnerScope(config);
    expect(await deriveFlipOwnerScope({ ...config, providerId: 'aws-s3', region: 'us-west-2' })).toBe(first);
    expect(await deriveFlipOwnerScope({ ...config, providerId: 'r2' })).not.toBe(first);
    expect(await deriveFlipOwnerScope({ ...config, region: 'us-east-1' })).not.toBe(first);
  });

  it('derives stable scopes per endpoint and exact Access key without persisting the key', async () => {
    const config = { endpoint: 'https://EXAMPLE.org:443/s3/', region: 'us-east-1', accessKey: 'AccessId-A', secure: true };
    const first = await deriveFlipOwnerScope(config);
    expect(await deriveFlipOwnerScope({ ...config, endpoint: 'https://example.org/s3' })).toBe(first);
    expect(await deriveFlipOwnerScope({ ...config, accessKey: 'AccessId-B' })).not.toBe(first);
    expect(await deriveFlipOwnerScope({ ...config, endpoint: 'https://other.example/s3' })).not.toBe(first);
    expect(first).toMatch(/^flip-owner-v1:[0-9a-f]{64}$/);
    expect(first).not.toContain(config.accessKey);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      `${canonicalFlipEndpoint({ endpoint: config.endpoint, secure: config.secure, region: config.region })}\0${config.accessKey}`,
    ));
    const expected = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    expect(first).toBe(`flip-owner-v1:${expected}`);
  });

  it('does not change owner scope for editable attribution or other display metadata', async () => {
    const config = { endpoint: 'https://storage.test', region: 'us-east-1', accessKey: 'AccessId-A', secure: true };
    const first = await deriveFlipOwnerScope(config);
    expect(await deriveFlipOwnerScope({ ...config, taggerUser: 'Anita', whoamiName: 'Another display name' })).toBe(first);
  });
});

it('does not expire a prepared handoff while it may be carried offline', async () => {
  await writeFlipRecord(record({ v: 2, createdAt: '2000-01-01T00:00:00.000Z' }));
  expect(await pruneFlipRecords()).toBe(0);
  expect(await flipDb.records.get('batch-1')).toBeDefined();
});

it('does not age-prune a quarantined ownerless v2 handoff', async () => {
  await flipDb.records.put(record({ v: 2, ownerScope: undefined, createdAt: '2000-01-01T00:00:00.000Z' }));
  expect(await pruneFlipRecords()).toBe(0);
  expect(await flipDb.records.get('batch-1')).toBeDefined();
});

describe('tag updates', () => {
  it('merges one image at a time without disturbing the others', async () => {
    await writeFlipRecord(record());
    await updateFlipTags('batch-1', { 'SD/IMG_0001.JPG': [coyote] });
    await updateFlipTags('batch-1', { 'SD/IMG_0002.JPG': [ghost] });
    const back = await readFlipRecord('batch-1');
    expect(back!.tags).toEqual({ 'SD/IMG_0001.JPG': [coyote], 'SD/IMG_0002.JPG': [ghost] });
  });

  it('reports a missing destination instead of claiming tags were saved', async () => {
    await expect(updateFlipTags('gone', { x: [coyote] })).rejects.toThrow('no longer stored');
    await expect(finishFlipRecord('gone', { x: [coyote] }, 'anita')).rejects.toThrow('no longer stored');
    expect(await readFlipRecord('gone')).toBeUndefined();
  });
});

describe('the hand back', () => {
  it('merges the final tags and records who tagged them', async () => {
    await writeFlipRecord(record({ tags: { 'SD/IMG_0001.JPG': [coyote] } }));
    await finishFlipRecord('batch-1', { 'SD/IMG_0002.JPG': [ghost] }, 'anita');
    const back = await readFlipRecord('batch-1');
    expect(back!.tags).toEqual({ 'SD/IMG_0001.JPG': [coyote], 'SD/IMG_0002.JPG': [ghost] });
    expect(back!.taggerUser).toBe('anita');
  });

  it('accepts a blank tagger identity — the tagger never forces one', async () => {
    await writeFlipRecord(record());
    await finishFlipRecord('batch-1', {}, '');
    expect((await readFlipRecord('batch-1'))!.taggerUser).toBe('');
  });
});

it('reads old records and resolves optional estimated timestamps after camera and manual time', async () => {
  await writeFlipRecord(record());
  expect(await readFlipRecord('batch-1')).toEqual({ ...record(), revision: 2, usedAt: expect.any(String) });
  const f = inspected({ exifTimestamp: undefined, estimatedTimestamp: '2024-01-10T08:00:00', timestampSource: 'interpolated' });
  await writeFlipRecord(record({ files: [f] }));
  expect((await readFlipRecord('batch-1'))?.files[0]).toEqual(f);
  expect(captureTimestampOf(f)).toBe(f.estimatedTimestamp);
  expect(captureTimestampOf({ ...f, manualTimestamp: 'manual' })).toBe('manual');
  expect(captureTimestampOf({ ...f, manualTimestamp: 'manual', exifTimestamp: 'camera' })).toBe('camera');
});

it('persists non-secret preparation with account isolation and an immutable handoff snapshot', async () => {
  const { savePreparedSpecies, loadPreparedSpecies, bindPreparedSpecies } = await import('../src/index');
  const login = { endpoint: 'https://storage.test', region: 'us-east-1', accessKey: 'person', secure: true };
  const ownerScope = await deriveFlipOwnerScope(login);
  const snapshot = {
    v: 2 as const, endpoint: 'https://storage.test', ownerScope, collectionKey: 'bucket::one', collectionName: 'One',
    sourceBucket: 'bucket', sourceKey: 'Collections/one/species.json', sourceHash: 'a'.repeat(64), preparedAt: '2026-10-17T12:00:00Z', profileId: 'profile', overrides: { 'Canis latrans': 'y' },
    species: [{ key: 'Canis latrans', scientificName: 'Canis latrans', commonName: 'Coyote', iconUrl: '', keyBinding: 'C' }],
  };
  await savePreparedSpecies({ ...snapshot, secretKey: 'MUST-NOT-PERSIST-SECRET', accessKey: 'MUST-NOT-PERSIST-ACCESS-ID', sessionToken: 'MUST-NOT-PERSIST-TOKEN' } as typeof snapshot);
  expect(JSON.stringify(await flipDb.vocabularies.toArray())).not.toContain('MUST-NOT-PERSIST');
  expect(JSON.stringify(await flipDb.vocabularies.toArray())).not.toContain('MUST-NOT-PERSIST-ACCESS-ID');
  expect(await loadPreparedSpecies({ ...login, accessKey: 'other' })).toBeNull();
  expect(await loadPreparedSpecies({ ...login, endpoint: 'https://other.test' })).toBeNull();
  expect(await loadPreparedSpecies(login)).toEqual(snapshot);
  const legacySnapshot = { ...snapshot, v: 1, account: 'person' } as unknown as typeof snapshot;
  const { validPreparedSpecies } = await import('../src/preparedSpecies');
  expect(validPreparedSpecies(legacySnapshot)).toBe(false);
  await writeFlipRecord(record());
  await bindPreparedSpecies('batch-1', snapshot);
  expect((await readFlipRecord('batch-1'))?.v).toBe(2);
  const persisted = {
    records: await flipDb.records.toArray(),
    vocabularies: await flipDb.vocabularies.toArray(),
    keys: [...await flipDb.records.toCollection().primaryKeys(), ...await flipDb.vocabularies.toCollection().primaryKeys()],
  };
  for (const credential of ['person', 'MUST-NOT-PERSIST-SECRET', 'MUST-NOT-PERSIST-ACCESS-ID', 'MUST-NOT-PERSIST-TOKEN']) {
    expect(JSON.stringify(persisted)).not.toContain(credential);
  }
  snapshot.species[0].commonName = 'Later change';
  await savePreparedSpecies({ ...snapshot, collectionKey: 'bucket::two', collectionName: 'Two' });
  expect((await readFlipRecord('batch-1'))?.preparedSpecies?.collectionKey).toBe('bucket::one');
  expect((await readFlipRecord('batch-1'))?.preparedSpecies?.species[0].commonName).toBe('Coyote');
  await expect(bindPreparedSpecies('batch-1', snapshot)).rejects.toThrow('already has');
  await updateFlipTags('batch-1', { 'SD/IMG_0001.JPG': [coyote] });
  await finishFlipRecord('batch-1', {}, 'anita');
  expect((await readFlipRecord('batch-1'))?.preparedSpecies?.species[0].commonName).toBe('Coyote');
});

it('rejects invalid preparation and preserves the previously saved list on failure', async () => {
  const { savePreparedSpecies, loadPreparedSpecies } = await import('../src/index');
  await flipDb.vocabularies.clear();
  await expect(savePreparedSpecies({ v: 2 } as any)).rejects.toThrow('invalid or empty');
  expect(await loadPreparedSpecies()).toBeNull();
  await flipDb.vocabularies.put({ id: 'selected', snapshot: { v: 1, species: [] } as any });
  expect(await loadPreparedSpecies()).toBeNull();
});

it('a failed preparation write leaves the previous accepted snapshot available', async () => {
  const { savePreparedSpecies, loadPreparedSpecies } = await import('../src/index');
  const snapshot = { v: 2 as const, endpoint: 'https://storage.test', ownerScope: OWNER_A, collectionKey: 'bucket::one', collectionName: 'One', sourceBucket: 'bucket', sourceKey: 'species.json', sourceHash: 'a'.repeat(64), preparedAt: '2026-10-17T12:00:00Z', profileId: 'profile', overrides: {}, species: [{ key: 'Coyote', scientificName: 'Coyote', commonName: 'Coyote', iconUrl: '', keyBinding: null }] };
  await savePreparedSpecies(snapshot);
  const write = vi.spyOn(flipDb.vocabularies, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));
  try {
    await expect(savePreparedSpecies({ ...snapshot, collectionName: 'New list' })).rejects.toThrow('QuotaExceededError');
    expect(await loadPreparedSpecies()).toEqual(snapshot);
  } finally { write.mockRestore(); }
});

it('upgrades the original database without losing handoff metadata or tags', async () => {
  const { default: Dexie } = await import('dexie');
  flipDb.close();
  await Dexie.delete('sparcd-flip');
  const legacy = new Dexie('sparcd-flip');
  legacy.version(1).stores({ records: 'id' });
  const original = record({ tags: { 'SD/IMG_0001.JPG': [coyote] } });
  await legacy.table('records').put(original);
  legacy.close();
  await flipDb.open();
  expect((await readFlipRecord(original.id))?.tags).toEqual(original.tags);
  expect(await flipDb.preparations.toArray()).toEqual([]);
  expect(await flipDb.vocabularies.toArray()).toEqual([]);
});

it('an aborted journal transaction preserves the previously committed preparation', async () => {
  await flipDb.preparations.put({ id: 'active', value: { id: 'stable-batch', files: ['unchanged'] } });
  await expect(flipDb.transaction('rw', flipDb.preparations, async () => {
    await flipDb.preparations.put({ id: 'active', value: { id: 'interrupted', files: [] } });
    throw new Error('interrupted write');
  })).rejects.toThrow('interrupted write');
  expect((await flipDb.preparations.get('active'))?.value).toEqual({ id: 'stable-batch', files: ['unchanged'] });
});

it('explains unsupported handoffs without changing their stored contents', async () => {
  const { flipRecordUnavailableReason } = await import('../src/index');
  const future = { ...record(), v: 99 } as unknown as FlipRecord;
  await flipDb.records.put(future);
  expect(await readFlipRecord(future.id)).toBeUndefined();
  expect(await flipRecordUnavailableReason(future.id)).toContain('unsupported app version');
  expect(await flipDb.records.get(future.id)).toEqual(future);
  expect(await flipRecordUnavailableReason('missing')).toContain('missing');
});
