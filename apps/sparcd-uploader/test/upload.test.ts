import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreconditionFailedError } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import type { BatchRecord, BundleRecord, FileRecord, LoadedSession } from '../src/lib/db';
import type { FileEntry } from '../src/store';
import { resumeUpload, runStreamingUpload, type UploadSnapshot } from '../src/lib/upload';

type FakeClient = {
  statObject: ReturnType<typeof vi.fn>;
  writeImmutableStream: ReturnType<typeof vi.fn>;
  writeImmutable: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  client: null as FakeClient | null,
  openSession: vi.fn(),
  attachBundle: vi.fn(),
  markFileState: vi.fn(),
  markBatchComplete: vi.fn(),
}));

vi.mock('../src/lib/s3', () => ({
  getClient: vi.fn(() => mocks.client),
}));

vi.mock('../src/lib/db', () => ({
  fileRecordId: (sessionId: string, localPath: string) => `${sessionId}::${localPath}`,
  openSession: mocks.openSession,
  attachBundle: mocks.attachBundle,
  markFileState: mocks.markFileState,
  markBatchComplete: mocks.markBatchComplete,
}));

const CONFIG = {} as S3Config;

const LOCATION = {
  key: 'deployment',
  id: 'deployment',
  name: 'Deployment',
  latitude: 1,
  longitude: 2,
  elevation: 3,
};

const badRequest = () =>
  Object.assign(new Error('bad request'), {
    name: 'BadRequest',
    $metadata: { httpStatusCode: 400 },
  });

const forbidden = () =>
  Object.assign(new Error('forbidden'), {
    name: 'Forbidden',
    $metadata: { httpStatusCode: 403 },
  });

// A 403 whose specific reason couldn't be read (CORS hides the body cross-
// origin for some error responses) — the AWS SDK falls back to this generic
// name when it can't parse a code to check against known clock-skew errors.
const unknownError403 = () =>
  Object.assign(new Error('unknown'), {
    name: 'UnknownError',
    $metadata: { httpStatusCode: 403 },
  });

function makeFile(localPath: string, size = 12): File {
  return new File([new Uint8Array(size)], localPath.split('/').pop() ?? localPath, { type: 'image/jpeg' });
}

function makeRecord(sessionId: string, i: number, state: FileRecord['state'] = 'pending'): FileRecord {
  const localPath = `file-${i}.jpg`;
  return {
    id: `${sessionId}::${localPath}`,
    sessionId,
    localPath,
    fileName: localPath,
    relPathInBundle: localPath,
    sanitizedObjectName: localPath,
    size: 12,
    sha256: `sha-${i}`,
    captureTimestamp: '2026-07-01T12:00:00',
    mediaKind: 'image',
    mimeType: 'image/jpeg',
    state,
    remoteKey: `Collections/c/Uploads/u/${localPath}`,
    attempt: 0,
  };
}

function makeBundleRecord(sessionId: string): BundleRecord {
  return {
    sessionId,
    deploymentsCsv: 'deployments',
    mediaCsv: 'media',
    observationsCsv: 'observations',
    uploadMetaJson: '{"meta":true}',
    uploadCompleteJson: '{"complete":true}',
    metadataBundleSha256: 'bundle-sha',
  };
}

function makeBatch(sessionId: string, totalFiles: number): BatchRecord {
  return {
    id: sessionId,
    targetBucket: 'bucket',
    uploadPrefix: 'Collections/c/Uploads/u',
    deploymentId: 'deployment',
    location: LOCATION,
    uploaderUser: 'user',
    uploaderSlug: 'user',
    collectionUuid: 'collection',
    description: 'description',
    startedAt: '2026-07-23T00:00:00.000Z',
    totalFiles,
    totalBytes: totalFiles * 12,
    uploadTimeZone: 'UTC',
    fileAccessMode: 'reselect-required',
  };
}

function makeSession(states: FileRecord['state'][]): LoadedSession {
  const sessionId = 'session-1';
  return {
    batch: makeBatch(sessionId, states.length),
    bundle: makeBundleRecord(sessionId),
    files: states.map((state, i) => makeRecord(sessionId, i, state)),
  };
}

function attachedFor(records: FileRecord[]): Map<string, File> {
  return new Map(records.map((r) => [r.localPath, makeFile(r.localPath, r.size)]));
}

function makeFileEntry(i: number, size = 12): FileEntry {
  const relPath = `file-${i}.jpg`;
  return {
    id: relPath,
    file: makeFile(relPath, size),
    relPath,
    fileName: relPath,
    size,
    mediaKind: 'image',
    processState: 'ready',
    sha256: `sha-${i}`,
    exifNaive: { year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 },
    mimeType: 'image/jpeg',
  };
}

function makeClient(records: FileRecord[], failingKeys = new Set<string>()): FakeClient {
  const byKey = new Map(records.map((r) => [r.remoteKey, r]));
  return {
    statObject: vi.fn(async (_bucket: string, key: string) => {
      const r = byKey.get(key);
      if (!r) throw Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return { size: r.size, metadata: { sha256: r.sha256 } };
    }),
    writeImmutableStream: vi.fn(async (_bucket: string, key: string) => {
      if (failingKeys.has(key)) throw badRequest();
      return { etag: `etag-${key}` };
    }),
    writeImmutable: vi.fn(async () => undefined),
  };
}

// Unlike makeClient, doesn't need to know exact keys upfront — a streamed
// run's keys depend on a real timestamp stamp, not a fixture. Matches a
// failing file by whether the key ends with its relPath, and derives the
// post-write stat from what was actually written (opts.sha256, file.size).
function makeStreamingClient(failingRelPaths = new Set<string>()): FakeClient {
  const written = new Map<string, { size: number; sha256: string }>();
  return {
    statObject: vi.fn(async (_bucket: string, key: string) => {
      const w = written.get(key);
      if (!w) throw Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return { size: w.size, metadata: { sha256: w.sha256 } };
    }),
    writeImmutableStream: vi.fn(async (_bucket: string, key: string, file: File, opts: { sha256: string }) => {
      if ([...failingRelPaths].some((p) => key.endsWith(p))) throw badRequest();
      written.set(key, { size: file.size, sha256: opts.sha256 });
      return { etag: `etag-${key}` };
    }),
    writeImmutable: vi.fn(async () => undefined),
  };
}

async function collect(run: { done: Promise<void> }, onDone: () => UploadSnapshot | null): Promise<UploadSnapshot> {
  await run.done;
  const snap = onDone();
  expect(snap).not.toBeNull();
  return snap!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = null;
});

describe('upload runs continue past per-file blob failures', () => {
  it('leaves a partial run open and skips metadata when some files fail', async () => {
    const session = makeSession(Array.from({ length: 6 }, () => 'pending'));
    const failing = new Set([session.files[1].remoteKey!, session.files[4].remoteKey!]);
    mocks.client = makeClient(session.files, failing);
    let last: UploadSnapshot | null = null;

    const run = resumeUpload(
      { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 3 },
      (snap) => {
        last = snap;
      },
    );
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('partial');
    expect(snap.files.filter((f) => f.state === 'failed')).toHaveLength(2);
    expect(snap.files.filter((f) => f.state === 'done')).toHaveLength(4);
    expect(mocks.client.writeImmutable).not.toHaveBeenCalled();
    expect(mocks.markBatchComplete).not.toHaveBeenCalled();
  });

  it('treats the per-file failure threshold as systemic', async () => {
    const session = makeSession(Array.from({ length: 15 }, () => 'pending'));
    mocks.client = makeClient(session.files, new Set(session.files.map((f) => f.remoteKey!)));
    let last: UploadSnapshot | null = null;

    const run = resumeUpload(
      { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 4 },
      (snap) => {
        last = snap;
      },
    );
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('error');
    expect(snap.error).toMatch(/file failures/);
  });

  it('aborts immediately on systemic access failures', async () => {
    expect(new PreconditionFailedError('x')).toBeInstanceOf(Error);
    const session = makeSession(Array.from({ length: 3 }, () => 'pending'));
    mocks.client = makeClient(session.files);
    mocks.client.writeImmutableStream.mockRejectedValueOnce(forbidden());
    let last: UploadSnapshot | null = null;

    const run = resumeUpload(
      { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 1 },
      (snap) => {
        last = snap;
      },
    );
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('error');
    expect(mocks.client.writeImmutable).not.toHaveBeenCalled();
  });

  it('retries a 403 with no readable reason instead of aborting immediately', async () => {
    const session = makeSession(Array.from({ length: 1 }, () => 'pending'));
    mocks.client = makeClient(session.files);
    mocks.client.writeImmutableStream.mockRejectedValueOnce(unknownError403());
    let last: UploadSnapshot | null = null;

    const run = resumeUpload(
      { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 1 },
      (snap) => {
        last = snap;
      },
    );
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('done');
    expect(mocks.client.writeImmutableStream).toHaveBeenCalledTimes(2);
  });

  it('waits for reconnect instead of spending a retry attempt while offline', async () => {
    // Node's test environment has no `window`; stub a minimal one so the
    // offline-wait branch (guarded on `typeof window !== 'undefined'`) is
    // actually reachable here, matching a real browser.
    const fakeWindow = new EventTarget();
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('navigator', { onLine: false });
    try {
      const session = makeSession(Array.from({ length: 1 }, () => 'pending'));
      mocks.client = makeClient(session.files);
      let last: UploadSnapshot | null = null;

      const run = resumeUpload(
        { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 1 },
        (snap) => {
          last = snap;
        },
      );

      // Give the lane a moment to reach the offline-wait branch — it should
      // sit there rather than attempting (or failing) anything.
      await new Promise((r) => setTimeout(r, 20));
      expect(mocks.client.writeImmutableStream).not.toHaveBeenCalled();

      vi.stubGlobal('navigator', { onLine: true });
      fakeWindow.dispatchEvent(new Event('online'));

      const snap = await collect(run, () => last);
      expect(snap.phase).toBe('done');
      expect(mocks.client.writeImmutableStream).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('waits for reconnect before the resume verify pass too, not just the upload retry loop', async () => {
    // A `doneAlready` file's first network call is `statObject` (verify),
    // not `writeImmutableStream` — the offline wait has to guard that call
    // too, or a resume started offline burns a lane failure on it before
    // ever reaching the retry loop's own check.
    const fakeWindow = new EventTarget();
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('navigator', { onLine: false });
    try {
      const session = makeSession(['done']);
      mocks.client = makeClient(session.files);
      let last: UploadSnapshot | null = null;

      const run = resumeUpload(
        { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 1 },
        (snap) => {
          last = snap;
        },
      );

      await new Promise((r) => setTimeout(r, 20));
      expect(mocks.client.statObject).not.toHaveBeenCalled();

      vi.stubGlobal('navigator', { onLine: true });
      fakeWindow.dispatchEvent(new Event('online'));

      const snap = await collect(run, () => last);
      expect(snap.phase).toBe('done');
      expect(mocks.client.statObject).toHaveBeenCalledTimes(1);
      expect(mocks.client.writeImmutableStream).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('publishes metadata after a clean sweep', async () => {
    const session = makeSession(Array.from({ length: 2 }, () => 'pending'));
    mocks.client = makeClient(session.files);
    let last: UploadSnapshot | null = null;

    const run = resumeUpload(
      { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 2 },
      (snap) => {
        last = snap;
      },
    );
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('done');
    expect(mocks.client.writeImmutable.mock.calls.map((c) => c[1])).toEqual([
      'Collections/c/Uploads/u/deployments.csv',
      'Collections/c/Uploads/u/media.csv',
      'Collections/c/Uploads/u/observations.csv',
      'Collections/c/Uploads/u/UploadMeta.json',
      'Collections/c/Uploads/u/UploadComplete.json',
    ]);
    expect(mocks.markBatchComplete).toHaveBeenCalledTimes(1);
  });

  it('retries only failed or pending files and then completes', async () => {
    const session = makeSession(['done', 'done', 'done', 'done', 'failed', 'pending']);
    mocks.client = makeClient(session.files);
    let last: UploadSnapshot | null = null;

    const run = resumeUpload(
      { config: CONFIG, session, attached: attachedFor(session.files), concurrency: 3 },
      (snap) => {
        last = snap;
      },
    );
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('done');
    expect(mocks.client.writeImmutableStream).toHaveBeenCalledTimes(2);
    expect(mocks.client.writeImmutableStream.mock.calls.map((c) => c[1])).toEqual([
      session.files[4].remoteKey,
      session.files[5].remoteKey,
    ]);
    expect(mocks.client.writeImmutable).toHaveBeenCalledTimes(5);
  });

});

describe('streamed runs upload as files individually become ready', () => {
  it('publishes once a file that arrives after start() via notifyReady finishes too', async () => {
    const entries = [makeFileEntry(0), makeFileEntry(1)];
    const client = makeStreamingClient();
    mocks.client = client;
    let last: UploadSnapshot | null = null;

    // Only the first file is known/ready at start() — the second arrives
    // later, exactly like a file that's still mid-Inspect when Upload starts.
    const run = runStreamingUpload(
      {
        config: CONFIG,
        dryRun: false,
        concurrency: 2,
        uploaderUser: 'user',
        fileAccessMode: 'reselect-required',
        build: {
          location: LOCATION,
          collectionUuid: 'collection',
          bucket: 'bucket',
          uploaderSlug: 'user',
          description: 'description',
          timeZone: 'UTC',
          files: [entries[0], { ...entries[1], processState: 'processing', sha256: undefined }],
        },
      },
      (snap) => {
        last = snap;
      },
    );

    run.notifyReady([entries[1]]);
    run.close([entries[0], entries[1]]);
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('done');
    expect(client.writeImmutableStream).toHaveBeenCalledTimes(2);
    expect(mocks.attachBundle).toHaveBeenCalledTimes(1);
    expect(mocks.markBatchComplete).toHaveBeenCalledTimes(1);
  });

  it('persists a bundle for later retry even on partial failure, once every file is known', async () => {
    const entries = [makeFileEntry(0), makeFileEntry(1), makeFileEntry(2)];
    const client = makeStreamingClient(new Set([entries[1].relPath]));
    mocks.client = client;
    let last: UploadSnapshot | null = null;

    const run = runStreamingUpload(
      {
        config: CONFIG,
        dryRun: false,
        concurrency: 2,
        uploaderUser: 'user',
        fileAccessMode: 'reselect-required',
        build: {
          location: LOCATION,
          collectionUuid: 'collection',
          bucket: 'bucket',
          uploaderSlug: 'user',
          description: 'description',
          timeZone: 'UTC',
          files: entries,
        },
      },
      (snap) => {
        last = snap;
      },
    );
    run.close(entries);
    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('partial');
    expect(snap.files.filter((f) => f.state === 'failed')).toHaveLength(1);
    expect(snap.files.filter((f) => f.state === 'done')).toHaveLength(2);
    // The bundle is built (and persisted) once the full batch is known, even
    // though this run failed — so a retry has a real ledger to resume from.
    expect(mocks.attachBundle).toHaveBeenCalledTimes(1);
    expect(client.writeImmutable).not.toHaveBeenCalled();
    expect(mocks.markBatchComplete).not.toHaveBeenCalled();
  });

  it('publishes after the queue genuinely empties and every lane is parked waiting', async () => {
    // Regression test: with concurrency > the number of items enqueued so
    // far, every lane blocks on the same underlying queue at once. A queue
    // that only remembers a single waiter silently orphans every lane but
    // the last, and the run hangs forever instead of ever publishing — this
    // only surfaces when there's a real gap between "queue empties" and
    // "more work arrives", which a synchronous enqueue-then-close never
    // exercises. Real setTimeout delays force that gap here.
    const entries = [makeFileEntry(0), makeFileEntry(1), makeFileEntry(2)];
    const client = makeStreamingClient();
    mocks.client = client;
    let last: UploadSnapshot | null = null;

    const run = runStreamingUpload(
      {
        config: CONFIG,
        dryRun: false,
        concurrency: 4, // more lanes than the single file enqueued at start()
        uploaderUser: 'user',
        fileAccessMode: 'reselect-required',
        build: {
          location: LOCATION,
          collectionUuid: 'collection',
          bucket: 'bucket',
          uploaderSlug: 'user',
          description: 'description',
          timeZone: 'UTC',
          files: [
            entries[0],
            { ...entries[1], processState: 'processing', sha256: undefined },
            { ...entries[2], processState: 'processing', sha256: undefined },
          ],
        },
      },
      (snap) => {
        last = snap;
      },
    );

    // Let the first file finish and drain — every lane should now be parked.
    await new Promise((r) => setTimeout(r, 20));
    run.notifyReady([entries[1]]);
    await new Promise((r) => setTimeout(r, 20));
    run.notifyReady([entries[2]]);
    await new Promise((r) => setTimeout(r, 20));
    run.close(entries);

    const snap = await collect(run, () => last);

    expect(snap.phase).toBe('done');
    expect(client.writeImmutableStream).toHaveBeenCalledTimes(3);
    expect(mocks.markBatchComplete).toHaveBeenCalledTimes(1);
  });
});
