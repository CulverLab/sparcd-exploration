// One batch out to the tagger and back, through the real hand-off code on both
// sides. The four ways a file can get its capture time — the camera's own, one
// typed in, one spread, and one estimated — have to survive the round trip and
// land in media.csv saying where they came from, because the flip record is the
// only thing that carries them: there is no second Inspect pass on the way home.

import { beforeAll, expect, it, vi } from 'vitest';
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
vi.mock('@sparcd/flip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sparcd/flip')>()),
  loadPreparedSpecies: async () => ({ v: 1, endpoint: 'https://prepared.test', account: 'test', collectionKey: 'Settings/species.json', collectionName: 'Settings master list', sourceBucket: 'bucket', sourceKey: 'Settings/species.json', sourceHash: 'a'.repeat(64), preparedAt: new Date().toISOString(), profileId: 'test', overrides: {}, species: [{ key: 'Canis latrans', scientificName: 'Canis latrans', commonName: 'Coyote', iconUrl: '', keyBinding: 'C' }] }),
  writeFlipRecord: async (r: FlipRecord) => void (stored.record = r),
  readFlipRecord: async () => stored.record,
}));
vi.mock('../src/lib/preparation', () => ({ recoveryGuard: () => () => {}, flushPreparation: async () => {}, readPreparation: async () => null, readPreparationForFlip: async () => stored.preparation, bindCurrentPreparationSpecies: () => {} }));
// Model the worker's hash result; provenance assertions still use real restore.
vi.mock('../src/lib/processPool', () => ({ processBatch: (items: any[], _started: any, result: any) => {
  for (const item of items) result({ id: item.id, sha256: `sha-${item.file.name}`, mediaKind: 'image' });
  return { done: Promise.resolve(), cancel() {} };
} }));

let useStore: typeof import('../src/store')['useStore'];
let handOffToTagger: typeof import('../src/lib/flip')['handOffToTagger'];
let resumeFromFlip: typeof import('../src/lib/flip')['resumeFromFlip'];
let adoptReselected: typeof import('../src/lib/flip')['adoptReselected'];
let adoptRecord: typeof import('../src/lib/flip')['adoptRecord'];
let buildBundle: typeof import('../src/lib/bundle')['buildBundle'];
let captureTimestampOf: typeof import('@sparcd/flip')['captureTimestampOf'];

beforeAll(async () => {
  ({ useStore } = await import('../src/store'));
  ({ handOffToTagger, resumeFromFlip, adoptReselected, adoptRecord } = await import('../src/lib/flip'));
  ({ buildBundle } = await import('../src/lib/bundle'));
  ({ captureTimestampOf } = await import('@sparcd/flip'));
});

const at = (hour: number, minute: number): NaiveDateTime => ({ year: 2026, month: 7, day: 1, hour, minute, second: 0 });

it.each(['reselect', 'handle'])('partially restores a tagged Flip through %s without dropping missing or changed originals', async method => {
  stored.preparation = null;
  const original = (name: string) => new File(['original'], name);
  const record: FlipRecord = { v: 1, id: 'partial-flip', createdAt: new Date().toISOString(), returnUrl: '',
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
  useStore.setState({
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

  await handOffToTagger();
  const record = stored.record!;
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
  await adoptReselected({ v: 1, id: 'return', createdAt: new Date().toISOString(), returnUrl: '', files: [{ relPath: file.relPath, fileName: file.fileName, size: file.size, sha256: file.sha256!, mediaKind: 'image' }], tags: {} }, [{ relPath: file.relPath, size: file.size, file: file.file }]);
  expect(useStore.getState()).toMatchObject(stored.preparation.inputs);
  stored.preparation = null;
});
