// One batch out to the tagger and back, through the real hand-off code on both
// sides. The four ways a file can get its capture time — the camera's own, one
// typed in, one spread, and one estimated — have to survive the round trip and
// land in media.csv saying where they came from, because the flip record is the
// only thing that carries them: there is no second Inspect pass on the way home.

import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { FlipRecord } from '@sparcd/flip';
import type { NaiveDateTime } from '../src/lib/exifTime';
import type { FileEntry } from '../src/store';

const storage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
(globalThis as any).window = Object.assign(globalThis, {
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: storage(),
  sessionStorage: storage(),
  location: { href: '', search: '' },
});

// The hand-off's transport is IndexedDB, which node has none of; everything
// else in the package — `captureTimestampOf` above all — is the real thing.
const stored = vi.hoisted(() => ({ record: undefined as FlipRecord | undefined, preparation: null as import('../src/lib/preparation').LocalPreparation | null }));
vi.mock('@sparcd/flip', async (importOriginal) => {
  const api = await importOriginal<typeof import('@sparcd/flip')>();
  return {
  ...api,
  loadPreparedSpecies: async (config: import('@sparcd/types').S3Config) => config ? ({ v: 2, endpoint: config.endpoint, ownerScope: await api.deriveFlipOwnerScope(config), collectionKey: 'Settings/species.json', collectionName: 'Settings master list', sourceBucket: 'bucket', sourceKey: 'Settings/species.json', sourceHash: 'a'.repeat(64), preparedAt: new Date().toISOString(), profileId: 'test', overrides: {}, species: [{ key: 'Canis latrans', scientificName: 'Canis latrans', commonName: 'Coyote', iconUrl: '', keyBinding: 'C' }] }) : null,
  flipRecordUnavailableReason: async () => 'This batch is not available for the connected login. Its saved work has been kept.',
  writeFlipRecord: async (r: FlipRecord) => void (stored.record = r),
  readFlipRecord: async (_id: string, expectedOwnerScope?: string) =>
    stored.record && (!expectedOwnerScope || stored.record.ownerScope === expectedOwnerScope) ? stored.record : undefined,
  };
});
vi.mock('../src/lib/preparation', () => ({ recoveryGuard: () => () => {}, flushPreparation: async () => {}, readPreparation: async () => stored.preparation, readPreparationForFlip: async () => stored.preparation, bindCurrentPreparationSpecies: () => {} }));
// Model the worker's hash result; provenance assertions still use real restore.
vi.mock('../src/lib/processPool', () => ({ processBatch: (items: any[], _started: any, result: any) => {
  for (const item of items) result({ id: item.id, sha256: `sha-${item.file.name}`, mediaKind: 'image' });
  return { done: Promise.resolve(), cancel() {} };
} }));

let useStore: typeof import('../src/store')['useStore'];
let handOffToTagger: typeof import('../src/lib/flip')['handOffToTagger'];
let reopenTagger: typeof import('../src/lib/flip')['reopenTagger'];
let resumeFromFlip: typeof import('../src/lib/flip')['resumeFromFlip'];
let adoptReselected: typeof import('../src/lib/flip')['adoptReselected'];
let adoptRecord: typeof import('../src/lib/flip')['adoptRecord'];
let reselectFlip: typeof import('../src/lib/flip')['reselectFlip'];
let buildBundle: typeof import('../src/lib/bundle')['buildBundle'];
let captureTimestampOf: typeof import('@sparcd/flip')['captureTimestampOf'];
const TEST_CONFIG = { endpoint: 'http://storage.test', accessKey: 'test-access-id', secretKey: 'test-secret-token', region: 'us-east-1', secure: false, forcePathStyle: true };
let testOwnerScope: string;

beforeAll(async () => {
  ({ useStore } = await import('../src/store'));
  ({ handOffToTagger, reopenTagger, resumeFromFlip, adoptReselected, adoptRecord, reselectFlip } = await import('../src/lib/flip'));
  ({ buildBundle } = await import('../src/lib/bundle'));
  ({ captureTimestampOf } = await import('@sparcd/flip'));
  const { deriveFlipOwnerScope } = await import('@sparcd/flip');
  testOwnerScope = await deriveFlipOwnerScope(TEST_CONFIG);
  useStore.setState({ s3Config: TEST_CONFIG });
});
beforeEach(() => {
  stored.record = undefined;
  stored.preparation = null;
  window.location.search = '';
  useStore.setState({ s3Config: TEST_CONFIG, files: [], dirHandle: null, flipId: null });
});

const at = (hour: number, minute: number): NaiveDateTime => ({ year: 2026, month: 7, day: 1, hour, minute, second: 0 });

it('offers folder reselection when restoring an owned Flip handle fails', async () => {
  const record: FlipRecord = {
    v: 2, id: 'unreadable-handle', createdAt: new Date().toISOString(), returnUrl: '', ownerScope: testOwnerScope,
    files: [{ fileName: 'camera.jpg', relPath: 'SD/camera.jpg', size: 8, sha256: 'sha-camera.jpg', mediaKind: 'image' }],
    tags: { 'SD/camera.jpg': [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: '', freeTags: '' }] },
    dirHandle: { name: 'SD', queryPermission: async () => 'granted', async *values() { throw new Error('folder was removed'); } } as unknown as FileSystemDirectoryHandle,
  };
  expect(await adoptRecord(record)).toMatchObject({ kind: 'needs-reselect', record });
});

it.each(['reselect', 'handle'])('partially restores a tagged Flip through %s without dropping missing or changed originals', async method => {
  stored.preparation = null;
  const original = (name: string) => new File(['original'], name);
  const record: FlipRecord = { v: 1, id: 'partial-flip', createdAt: new Date().toISOString(), returnUrl: '', ownerScope: testOwnerScope,
    files: ['good.jpg', 'missing.jpg', 'changed.jpg'].map(fileName => ({ fileName, relPath: `SD/${fileName}`, size: 8, sha256: `sha-${fileName}`, mediaKind: 'image', exifTimestamp: '2026-07-01T12:00:00' })),
    tags: { 'SD/good.jpg': [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 6, requestedSpecies: '', freeTags: '' }] }, taggerUser: 'Saved Identifier' };
  const selection = [
    { relPath: 'SD/good.jpg', size: 8, file: original('good.jpg') },
    { relPath: 'SD/changed.jpg', size: 8, file: original('edited.jpg') },
  ];
  if (method === 'handle') {
    record.dirHandle = { name: 'SD', queryPermission: async () => 'granted', async *values() {
      for (const entry of selection) yield { kind: 'file', name: entry.relPath.split('/').pop(), getFile: async () => entry.file };
    } } as unknown as FileSystemDirectoryHandle;
    expect(await adoptRecord(record)).toEqual({ kind: 'restored' });
  } else await adoptReselected(record, selection);
  const files = useStore.getState().files;
  expect(files).toHaveLength(3);
  expect(files[0]).toMatchObject({ processState: 'ready', preTags: record.tags['SD/good.jpg'], preTaggerUser: 'Saved Identifier' });
  expect(files.slice(1).every(file => file.needsOriginal && file.processState === 'error' && file.file.size === 0)).toBe(true);
  expect(files[1].processError).toContain('not in the selected folder');
  expect(files[2].processError).toContain('content hash differs');
  expect(record.files).toHaveLength(3); expect(record.tags['SD/good.jpg'][0].count).toBe(6);
  await adoptReselected(record, record.files.map(file => ({ relPath: file.relPath, size: 8, file: original(file.fileName) })));
  expect(useStore.getState().files.every(file => file.processState === 'ready' && !file.needsOriginal)).toBe(true);
  expect(useStore.getState().files[0].preTags).toEqual(record.tags['SD/good.jpg']);
});

const SIZE = 64;
const entry = (name: string, over: Partial<FileEntry>): FileEntry =>
  ({
    id: `trip/${name}`,
    relPath: `trip/${name}`,
    fileName: name,
    size: SIZE,
    mediaKind: 'image',
    processState: 'ready',
    sha256: `sha-${name}`,
    mimeType: 'image/jpeg',
    file: new File([new Uint8Array(SIZE)], name, { type: 'image/jpeg' }),
    ...over,
  }) as FileEntry;

const NAMES = ['1-camera.jpg', '2-manual.jpg', '3-spread.jpg', '4-none.jpg', '5-modified.jpg'];

// A folder that still holds all four files, so the trusted restore reattaches
// every one of them by path + size.
const dirHandle = () =>
  ({
    kind: 'directory',
    name: 'trip',
    values: async function* () {
      for (const name of NAMES) {
        yield {
          kind: 'file' as const,
          name,
          getFile: async () => new File([new Uint8Array(SIZE)], name, { type: 'image/jpeg' }),
        };
      }
    },
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
  }) as unknown as FileSystemDirectoryHandle;

const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';

/** The `comments` column of the media.csv row for one file — every field is
 *  quoted and comments is the last one. */
const commentsFor = (csv: string, fileName: string): string =>
  csv
    .split('\n')
    .find((line) => line.includes(`"${fileName}"`))!
    .split(',')
    .pop()!
    .replace(/"/g, '');

it('carries every kind of capture time out to the tagger and home into media.csv', async () => {
  const handoffConfig = { ...TEST_CONFIG, sessionToken: 'test-session-token' };
  useStore.setState({
    s3Config: handoffConfig,
    uploadTimeZone: 'UTC',
    dirHandle: dirHandle(),
    files: [
      entry('1-camera.jpg', { exifNaive: at(12, 0) }),
      entry('2-manual.jpg', { manualNaive: at(12, 5), manualSource: 'manual' }),
      entry('3-spread.jpg', {
        manualNaive: at(12, 6),
        manualSource: 'spread',
        manualSpreadStart: at(12, 5),
        manualSpreadMethod: 'sequence',
      }),
      entry('4-none.jpg', {}),
      entry('5-modified.jpg', {
        exifNaive: at(12, 7),
        exifTimestampSource: 'exif-modify',
        manualNaive: at(12, 8),
        manualSource: 'manual',
      }),
    ],
  });

  const logSpies = [
    vi.spyOn(console, 'debug').mockImplementation(() => {}),
    vi.spyOn(console, 'info').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
  try { await handOffToTagger(); }
  finally { logSpies.forEach(spy => spy.mockRestore()); }
  const record = stored.record!;
  expect(record.ownerScope).toMatch(/^flip-owner-v1:[a-f0-9]{64}$/);
  const logged = logSpies.flatMap(spy => spy.mock.calls.flat()).map(String).join('\n');
  for (const credential of [handoffConfig.accessKey, handoffConfig.secretKey, handoffConfig.sessionToken]) {
    expect(JSON.stringify(record)).not.toContain(credential);
    expect(logged).not.toContain(credential);
  }
  expect(new URL(window.location.href, 'https://test.invalid').searchParams.get('ownerScope')).toBe(record.ownerScope);
  record.taggerUser = 'anita';
  record.tags = {
    'trip/1-camera.jpg': [{
      scientificName: 'Canis latrans', commonName: 'Coyote', count: 1,
      requestedSpecies: '', freeTags: '',
      classifiedBy: 'alice',
      classificationTimestamp: '2026-07-02T10:00:00.000Z',
    }],
  };
  expect(record.files.map((f) => f.relPath)).toEqual(NAMES.map((n) => `trip/${n}`));
  expect(record.files.find((f) => f.fileName === '3-spread.jpg')?.manualSpreadStart)
    .toBe('2026-07-01T12:05:00');
  expect(record.files.find((f) => f.fileName === '3-spread.jpg')?.manualSpreadMethod)
    .toBe('sequence');
  // Only file with no time of its own: 30 minutes past the one camera time,
  // three ten-minute steps down the gap it opens.
  expect(captureTimestampOf(record.files[3])).toBe('2026-07-01T12:30:00');
  expect(record.files[4]).toMatchObject({
    exifTimestamp: '2026-07-01T12:07:00',
    exifTimestampSource: 'exif-modify',
    manualTimestamp: '2026-07-01T12:08:00',
    timestampSource: 'manual',
  });
  expect(captureTimestampOf(record.files[4])).toBe('2026-07-01T12:08:00');

  useStore.setState({ files: [], dirHandle: null });
  expect(await resumeFromFlip(record.id)).toEqual({ kind: 'restored' });
  expect(useStore.getState().files.find((f) => f.fileName === '3-spread.jpg')?.manualSpreadStart)
    .toEqual(at(12, 5));
  expect(useStore.getState().files.find((f) => f.fileName === '3-spread.jpg')?.manualSpreadMethod)
    .toBe('sequence');
  expect(useStore.getState().files.find((f) => f.fileName === '1-camera.jpg'))
    .toMatchObject({ preTaggerUser: 'anita' });

  const bundle = await buildBundle({
    location: { key: 'SAN15|31.5,-110.2', id: 'SAN15', name: 'San Pedro 15', latitude: 31.5, longitude: -110.2, elevation: 1200 },
    collectionUuid: UUID,
    bucket: `sparcd-${UUID}`,
    uploaderSlug: 'jdoe',
    description: 'july',
    timeZone: 'UTC',
    files: useStore.getState().files,
    now: new Date('2026-07-02T10:00:00.000Z'),
  });

  expect(commentsFor(bundle.mediaCsv, '1-camera.jpg')).toBe('');
  expect(commentsFor(bundle.mediaCsv, '2-manual.jpg')).toBe('[TIMESTAMP:manual]');
  expect(commentsFor(bundle.mediaCsv, '3-spread.jpg')).toBe('[TIMESTAMP:spread]');
  expect(commentsFor(bundle.mediaCsv, '4-none.jpg')).toBe('[TIMESTAMP:offset]');
  expect(commentsFor(bundle.mediaCsv, '5-modified.jpg')).toBe('[TIMESTAMP:manual]');
  expect(bundle.mediaCsv).toContain('2026-07-01T12:08:00.000+00:00');
  expect(bundle.mediaCsv).toContain('2026-07-01T12:30:00.000+00:00');
  expect(bundle.deploymentsCsv.split(',')[15]).toBe('"true"'); // timestamp_issues
  expect(bundle.observationsCsv.split('\n')[0].split(',')[16]).toBe('"alice"');
  expect(bundle.observationsCsv.split('\n')[0].split(',')[17]).toBe('"2026-07-02T10:00:00.000Z"');
});

it('does not reopen or restore a saved handoff after the effective login changes', async () => {
  useStore.setState({
    s3Config: TEST_CONFIG,
    files: [entry('owned.jpg', {})],
    dirHandle: null,
  });
  await handOffToTagger();
  const record = stored.record!;
  const savedCopy = structuredClone(record);
  useStore.setState({ s3Config: { ...TEST_CONFIG, accessKey: 'different-access-id' }, files: [] });
  expect(await resumeFromFlip(record.id)).toMatchObject({ kind: 'not-found' });
  await expect(reopenTagger(record.id)).rejects.toThrow('not available for the connected login');
  expect(stored.record).toEqual(savedCopy);
});

it('blocks a new handoff without a saved connected-login scope and preserves Inspect data', async () => {
  const inspectedFiles = [entry('not-yet-owned.jpg', {})];
  useStore.setState({ s3Config: null, files: inspectedFiles, dirHandle: null, flipId: null });
  await expect(handOffToTagger()).rejects.toThrow('Connect with the login that owns this batch');
  expect(stored.record).toBeUndefined();
  expect(useStore.getState().files).toEqual(inspectedFiles);
  expect(useStore.getState().flipId).toBeNull();
});

it('round-trips file-modified spread provenance, including its applied timezone', async () => {
  useStore.setState({
    uploadTimeZone: 'Europe/London',
    dirHandle: dirHandle(),
    files: [entry('1-camera.jpg', {
      manualNaive: at(11, 0),
      manualSource: 'spread',
      manualSpreadMethod: 'file-modified',
      manualSpreadTimeZone: 'America/Phoenix',
    })],
  });

  await handOffToTagger();
  const record = stored.record!;
  expect(record.files[0]).toMatchObject({
    manualSpreadMethod: 'file-modified',
    manualSpreadTimeZone: 'America/Phoenix',
  });

  useStore.setState({ files: [], dirHandle: null });
  expect(await resumeFromFlip(record.id)).toEqual({ kind: 'restored' });
  expect(useStore.getState().files[0]).toMatchObject({
    manualSpreadMethod: 'file-modified',
    manualSpreadTimeZone: 'America/Phoenix',
  });
});

it('does not classify a legacy Flip spread as file-modified', async () => {
  const legacy: FlipRecord = {
    id: 'legacy-spread',
    v: 1,
    createdAt: '2026-07-01T12:00:00.000Z',
    returnUrl: '/uploader/',
    ownerScope: testOwnerScope,
    files: [{
      relPath: 'trip/1-camera.jpg',
      fileName: '1-camera.jpg',
      size: SIZE,
      sha256: 'sha-1-camera.jpg',
      mediaKind: 'image',
      manualTimestamp: '2026-07-01T11:00:00',
      timestampSource: 'spread',
    }],
    tags: {},
  };

  await adoptReselected(legacy, [{
    relPath: 'trip/1-camera.jpg',
    size: SIZE,
    file: new File([new Uint8Array(SIZE)], '1-camera.jpg', { type: 'image/jpeg' }),
  }]);

  expect(useStore.getState().files[0]).toMatchObject({
    manualSource: 'spread',
    manualSpreadMethod: undefined,
    manualSpreadTimeZone: undefined,
  });
});

it('restores only the returning batch’s saved inputs instead of another window’s defaults', async () => {
  const file = entry('return.jpg', {});
  stored.preparation = { v: 1, id: 'batch-owned', savedAt: new Date().toISOString(), files: [], flipId: 'return', species: null, inputs: { selectedBucket: 'own bucket', selectedLocationId: 'own location', uploadDescription: 'own notes', uploadTimeZone: 'America/Phoenix' } };
  useStore.setState({ uploadDescription: 'other window notes', selectedBucket: 'other bucket', uploadTimeZone: 'America/New_York' });
  await adoptReselected({ v: 1, id: 'return', createdAt: new Date().toISOString(), returnUrl: '', ownerScope: testOwnerScope, files: [{ relPath: file.relPath, fileName: file.fileName, size: file.size, sha256: file.sha256!, mediaKind: 'image' }], tags: {} }, [{ relPath: file.relPath, size: file.size, file: file.file }]);
  expect(useStore.getState()).toMatchObject(stored.preparation.inputs);
  stored.preparation = null;
});

it('preserves the prepared owner through an offline handoff and return, while refusing a different login', async () => {
  const { loadPreparedSpecies } = await import('@sparcd/flip');
  const species = await loadPreparedSpecies(TEST_CONFIG);
  stored.preparation = { species } as import('../src/lib/preparation').LocalPreparation;
  useStore.setState({ s3Config: null, files: [entry('offline.jpg', {})], dirHandle: null });
  await handOffToTagger();
  const record = stored.record!;
  expect(record.ownerScope).toBe(testOwnerScope);
  expect(record.preparedSpecies).toEqual(species);
  expect(record.returnUrl).toContain(`ownerScope=${encodeURIComponent(testOwnerScope)}`);
  window.location.search = `?flip=${record.id}&ownerScope=${encodeURIComponent(testOwnerScope)}`;
  expect(await resumeFromFlip(record.id)).toMatchObject({ kind: 'needs-reselect', record });
  useStore.setState({ s3Config: { ...TEST_CONFIG, accessKey: 'different-login' } });
  expect(await resumeFromFlip(record.id)).toMatchObject({ kind: 'not-found' });
  await expect(adoptRecord(record)).rejects.toThrow('not available for the connected login');
  useStore.setState({ s3Config: null });
  window.location.search = `?flip=${record.id}&ownerScope=invalid`;
  expect(await resumeFromFlip(record.id)).toMatchObject({ kind: 'not-found' });
  await expect(reopenTagger(record.id)).rejects.toThrow('Reconnect with the login');
  window.location.search = `?flip=${record.id}&ownerScope=${encodeURIComponent(testOwnerScope)}`;
  await reopenTagger(record.id);
  expect(window.location.href).toContain(`batch=${record.id}&ownerScope=${encodeURIComponent(testOwnerScope)}`);
  expect(stored.record).toEqual(record);
});

it('captures a live picker FileList before asynchronous ownership checks', async () => {
  const file = new File(['original'], 'camera.jpg');
  const record: FlipRecord = {
    v: 2, id: 'live-list', createdAt: new Date().toISOString(), returnUrl: '', ownerScope: testOwnerScope,
    files: [{ fileName: 'camera.jpg', relPath: 'camera.jpg', size: 8, sha256: 'sha-camera.jpg', mediaKind: 'image' }],
    tags: { 'camera.jpg': [{ scientificName: 'Canis latrans', commonName: 'Coyote', count: 2, requestedSpecies: '', freeTags: '' }] },
  };
  const list = { 0: file, length: 1 };
  const pending = reselectFlip(record, list as unknown as FileList);
  // The React input handler clears its value before the ownership digest settles.
  list.length = 0;
  await pending;
  expect(useStore.getState().files[0].preTags).toEqual(record.tags['camera.jpg']);
  expect(useStore.getState().files[0].file.size).toBe(8);
});
