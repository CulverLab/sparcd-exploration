import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScannedFile } from '../src/lib/scanFiles';
import type { ProcessResponse } from '../src/lib/processPool';
import type { FileValidation } from '../src/lib/validation';
import type { NaiveDateTime } from '../src/lib/exifTime';
import type { UploadPhase, UploadSnapshot } from '../src/lib/upload';
import { loginIdentityPreferenceKey, saveLoginIdentityDefault } from '../../../packages/auth-ui/src/loginIdentity';

const storage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};
(globalThis as any).window = Object.assign(globalThis, {
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: storage(),
  sessionStorage: storage(),
});
const { useStore } = await import('../src/store');
const { forwardReadyToStreamingRun, maybeCloseStreamingQueue } = await import('../src/lib/streamingBridge');

const NAIVE: NaiveDateTime = { year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 };

function scanned(id: string, over: Partial<ScannedFile> = {}): ScannedFile {
  const file = new File([new Uint8Array(64)], id.split('/').pop() ?? 'x.jpg', { type: 'image/jpeg' });
  return {
    id,
    file,
    relPath: id,
    fileName: file.name,
    size: file.size,
    mediaKind: 'image',
    ...over,
  };
}

function success(id: string, over: Partial<ProcessResponse> = {}): ProcessResponse {
  return {
    id,
    sha256: `sha-${id}`,
    exifNaive: NAIVE,
    exifCamera: 'Reconyx HF2X',
    gps: { lat: 31.5, lon: -110.2 },
    width: 64,
    height: 48,
    mimeType: 'image/jpeg',
    mediaKind: 'image',
    ...over,
  };
}

function snapshot(sessionId: string, phase: UploadPhase): UploadSnapshot {
  return {
    version: 1,
    sessionId,
    phase,
    dryRun: false,
    files: [],
    uploadedBytes: 0,
    skippedBytes: 0,
    totalBytes: 0,
    log: [],
    bucket: 'sparcd-test',
    collectionUuid: 'collection',
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    '<Error><Code>InvalidBucketName</Code><Message>The specified bucket is not valid.</Message></Error>',
    { status: 400 },
  )));
  useStore.setState({
    s3Config: null,
    uploaderUser: '',
    identityPersistenceError: false,
    identityEditing: false,
    identityResolvedDefault: null,
    identityDefaultSource: null,
    identityUnsavedCustom: null,
    identityResolutionStatus: 'idle',
    identityResolutionError: null,
    files: [],
    validations: {},
    processing: false,
    batchToken: 0,
    step: 'drop',
    dirHandle: null,
    fileAccessMode: 'reselect-required',
    activeRun: null,
    streamingRun: null,
    streamingQueueClosed: false,
    activeSnap: null,
    activeRunGeneration: 0,
    activeRunReserved: false,
    activeRunSource: null,
    historyResumePreparation: null,
  });
});

describe('active run ownership', () => {
  it('ignores a late snapshot after the run is invalidated', () => {
    const store = useStore.getState();
    const generation = store.beginActiveRun();
    const cancel = vi.fn();
    store.setActiveRun({ cancel, done: Promise.resolve() }, generation!);

    store.cancelActiveRun();
    store.setActiveSnap(snapshot('stale', 'error'), generation!);

    expect(cancel).toHaveBeenCalledOnce();
    expect(useStore.getState().activeRun).toBeNull();
    expect(useStore.getState().activeSnap).toBeNull();
    expect(useStore.getState().activeRunSource).toBeNull();
  });

  it('refuses a second reservation without cancelling or replacing the first', () => {
    const store = useStore.getState();
    const cancel = vi.fn();
    const generation = store.beginActiveRun();
    store.setActiveRun({ cancel, done: Promise.resolve() }, generation!);

    expect(store.beginActiveRun()).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect(useStore.getState().activeRunReserved).toBe(true);
    expect(useStore.getState().activeRunSource).toBe('upload');
  });

  it('cancels a runner attached after its reservation was invalidated', () => {
    const store = useStore.getState();
    const generation = store.beginActiveRun();
    const cancel = vi.fn();

    store.cancelActiveRun();
    store.setActiveRun({ cancel, done: Promise.resolve() }, generation!);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('releases the reservation but retains a terminal snapshot for display', () => {
    const store = useStore.getState();
    const generation = store.beginActiveRun();
    const done = snapshot('finished', 'done');

    store.setActiveSnap(done, generation!);

    expect(useStore.getState().activeRunReserved).toBe(false);
    expect(useStore.getState().activeSnap).toBe(done);
    expect(useStore.getState().activeRunSource).toBe('upload');
    expect(store.beginActiveRun()).not.toBeNull();
  });
});

describe('streaming bridge ownership', () => {
  const streamingRun = () => ({
    cancel: vi.fn(),
    done: Promise.resolve(),
    notifyReady: vi.fn(),
    close: vi.fn(),
  });

  it('forwards ready files and closes a complete queue exactly once', () => {
    useStore.getState().setFiles([scanned('a.jpg')]);
    useStore.getState().applyProgress([], [success('a.jpg')]);
    const run = streamingRun();
    const generation = useStore.getState().beginActiveRun();
    useStore.getState().setActiveRun(run, generation!, run);

    forwardReadyToStreamingRun([{ id: 'a.jpg' }]);
    const files = useStore.getState().files;
    maybeCloseStreamingQueue(files);
    maybeCloseStreamingQueue(files);

    expect(run.notifyReady).toHaveBeenCalledWith([expect.objectContaining({ id: 'a.jpg' })]);
    expect(run.close).toHaveBeenCalledTimes(1);
    expect(run.close).toHaveBeenCalledWith(files);
    expect(useStore.getState().streamingQueueClosed).toBe(true);
  });

  it('atomically drops the old bridge owner when a plain run replaces it or the run is cleared', () => {
    useStore.getState().setFiles([scanned('a.jpg')]);
    useStore.getState().applyProgress([], [success('a.jpg')]);
    const old = streamingRun();
    const resume = { cancel: vi.fn(), done: Promise.resolve() };
    const oldGeneration = useStore.getState().beginActiveRun();
    useStore.getState().setActiveRun(old, oldGeneration!, old);

    useStore.getState().setActiveSnap(snapshot('old', 'done'), oldGeneration!);
    const resumeGeneration = useStore.getState().beginActiveRun();
    useStore.getState().setActiveRun(resume, resumeGeneration!);
    forwardReadyToStreamingRun([{ id: 'a.jpg' }]);
    maybeCloseStreamingQueue(useStore.getState().files);

    expect(useStore.getState().activeRun).toBe(resume);
    expect(useStore.getState().streamingRun).toBeNull();
    expect(old.notifyReady).not.toHaveBeenCalled();
    expect(old.close).not.toHaveBeenCalled();

    useStore.getState().clearActiveRun();
    expect(useStore.getState()).toMatchObject({
      activeRun: null,
      streamingRun: null,
      streamingQueueClosed: false,
    });
  });

  it('cleans up a settled owner without detaching a newer streaming run', async () => {
    let finishOld!: () => void;
    let finishNew!: () => void;
    const old = {
      ...streamingRun(),
      done: new Promise<void>((resolve) => { finishOld = resolve; }),
    };
    const replacement = {
      ...streamingRun(),
      done: new Promise<void>((resolve) => { finishNew = resolve; }),
    };

    const oldGeneration = useStore.getState().beginActiveRun();
    useStore.getState().setActiveRun(old, oldGeneration!, old);
    useStore.getState().setActiveSnap(snapshot('old', 'done'), oldGeneration!);
    const replacementGeneration = useStore.getState().beginActiveRun();
    useStore.getState().setActiveRun(replacement, replacementGeneration!, replacement);
    finishOld();
    await old.done;
    await Promise.resolve();
    expect(useStore.getState().streamingRun).toBe(replacement);

    finishNew();
    await replacement.done;
    await Promise.resolve();
    expect(useStore.getState()).toMatchObject({
      activeRun: replacement,
      streamingRun: null,
      streamingQueueClosed: false,
    });
  });
});

describe('store persistence', () => {
  it('persists wizard prefs and never the in-flight batch', () => {
    useStore.getState().setUploaderUser('Ada Lovelace');
    useStore.getState().setUploadDescription('Sky Island transect');
    useStore.getState().setMountainRange('Santa Catalina Mountains');
    useStore.getState().setDateCollected('2026-10-01');
    useStore.getState().setSelectedBucket('bucket::uuid');
      useStore.getState().setSelectedLocationId('loc-7');
    useStore.getState().setUploadTimeZone('America/Phoenix');
    useStore.getState().setDryRun(false);
    useStore.getState().setConcurrencyMode('manual');
    useStore.getState().setUploadConcurrency(16);
    useStore.getState().setFiles([scanned('a.jpg')]);
    const generation = useStore.getState().beginActiveRun();
    useStore.getState().setActiveSnap({ sessionId: 'session-1' } as never, generation!);

    const persisted = JSON.parse(window.sessionStorage.getItem('sparcd-uploader-session')!).state;

    expect(persisted).toEqual({
      elevationUnit: 'meters',
      uploadDescription: 'Sky Island transect',
      uploadCommentDate: null,
      mountainRange: 'Santa Catalina Mountains',
      dateCollected: '2026-10-01',
      selectedBucket: 'bucket::uuid',
      selectedLocationId: 'loc-7',
      requireCollectionSelection: false,
      uploadTimeZone: 'America/Phoenix',
      dryRun: false,
      concurrencyMode: 'manual',
      uploadConcurrency: 16,
    });
  });
});

describe('account-scoped uploader identity', () => {
  const config = (accessKey: string) => ({
    endpoint: 'http://localhost',
    accessKey,
    secretKey: 'test-secret',
    region: 'us-east-1',
    forcePathStyle: true,
    secure: false,
  });

  it('loads each login identity on direct login and account replacement', async () => {
    useStore.setState({ s3Config: null, uploaderUser: '' });
    useStore.getState().connect(config('login-a'), false);
    useStore.getState().setUploaderUser('Ada');
    useStore.getState().connect(config('login-b'), false);
    await vi.waitFor(() => expect(useStore.getState().uploaderUser).toBe('login-b'));

    useStore.getState().setUploaderUser('Grace');
    useStore.getState().connect(config('login-a'), false);
    expect(useStore.getState().uploaderUser).toBe('Ada');
    useStore.getState().connect(config('login-b'), false);
    expect(useStore.getState().uploaderUser).toBe('Grace');
  });

  it('uses login identity in new state without persisting it in the tab session', () => {
    useStore.setState({ s3Config: null, uploaderUser: '' });
    useStore.getState().connect(config('login-a'), false);
    useStore.getState().setUploaderUser('Ada');
    const persisted = JSON.parse(window.sessionStorage.getItem('sparcd-uploader-session')!).state;
    expect(persisted).not.toHaveProperty('uploaderUser');
    expect(useStore.getState().uploaderUser).toBe('Ada');
  });
});

describe('starting a new batch', () => {
  it('clears assignment details while preserving identity and run preferences', () => {
    useStore.setState({
      uploaderUser: 'Ada Lovelace',
      selectedBucket: 'bucket::uuid',
      selectedLocationId: 'loc-7',
      uploadDescription: 'July retrieval',
      uploadTimeZone: 'America/Phoenix',
      dryRun: true,
      concurrencyMode: 'manual',
      uploadConcurrency: 16,
    });

    useStore.getState().nextBatch();

    expect(useStore.getState()).toMatchObject({
      uploaderUser: 'Ada Lovelace',
      selectedBucket: null,
      selectedLocationId: null,
      requireCollectionSelection: true,
      uploadDescription: '',
      uploadTimeZone: '',
      dryRun: true,
      concurrencyMode: 'manual',
      uploadConcurrency: 16,
    });
    const persisted = JSON.parse(window.sessionStorage.getItem('sparcd-uploader-session')!).state;
    expect(persisted).toMatchObject({
      selectedBucket: null,
      selectedLocationId: null,
      requireCollectionSelection: true,
      uploadDescription: '',
      uploadTimeZone: '',
    });
    expect(persisted).not.toHaveProperty('uploaderUser');
  });
});

describe('History resume preparation', () => {
  it('keeps the active session and progress in shared state', () => {
    const store = useStore.getState();
    store.beginHistoryResumePreparation('session-a');
    store.setHistoryResumeProgress('session-a', 7, 12);

    expect(useStore.getState().historyResumePreparation).toEqual({
      sessionId: 'session-a',
      progress: { done: 7, total: 12 },
    });
  });

  it('ignores stale progress and cleanup from an older preparation', () => {
    const store = useStore.getState();
    store.beginHistoryResumePreparation('session-new');
    store.setHistoryResumeProgress('session-old', 4, 10);
    store.clearHistoryResumePreparation('session-old');

    expect(useStore.getState().historyResumePreparation).toEqual({
      sessionId: 'session-new',
      progress: null,
    });
  });
});

describe('store applyProgress', () => {
  it('marks started ids processing and leaves queued others untouched', () => {
    useStore.getState().setFiles([scanned('a.jpg'), scanned('b.jpg'), scanned('c.jpg')]);

    useStore.getState().applyProgress(['a.jpg', 'b.jpg'], []);

    const states = Object.fromEntries(useStore.getState().files.map((f) => [f.id, f.processState]));
    expect(states).toEqual({ 'a.jpg': 'processing', 'b.jpg': 'processing', 'c.jpg': 'queued' });
  });

  it('applies success and error results', () => {
    useStore.getState().setFiles([scanned('a.jpg'), scanned('b.jpg')]);

    useStore.getState().applyProgress(
      [],
      [success('a.jpg'), { id: 'b.jpg', error: 'decode failed' }],
    );

    const files = useStore.getState().files;
    expect(files[0]).toMatchObject({
      processState: 'ready',
      sha256: 'sha-a.jpg',
      exifNaive: NAIVE,
      exifCamera: 'Reconyx HF2X',
      gps: { lat: 31.5, lon: -110.2 },
      width: 64,
      height: 48,
      mimeType: 'image/jpeg',
    });
    expect(files[1]).toMatchObject({ processState: 'error', processError: 'decode failed' });
  });

  it('lets a result win over a started marker in the same flush', () => {
    useStore.getState().setFiles([scanned('a.jpg')]);

    useStore.getState().applyProgress(['a.jpg'], [success('a.jpg')]);

    expect(useStore.getState().files[0].processState).toBe('ready');
  });

  it('updates validations only for result files', () => {
    useStore
      .getState()
      .setFiles([scanned('unsafe', { relPath: 'folder/../x.jpg' }), scanned('other.jpg')]);
    const unchanged: FileValidation = { severity: 'ok', issues: [] };
    const staleUnsafe: FileValidation = { severity: 'ok', issues: [] };
    useStore.setState({ validations: { unsafe: staleUnsafe, 'other.jpg': unchanged } });

    useStore.getState().applyProgress([], [success('unsafe')]);

    const validations = useStore.getState().validations;
    expect(validations.unsafe.severity).toBe('error');
    expect(validations.unsafe.issues.some((i) => i.message.includes('Unsafe filename'))).toBe(true);
    expect(validations['other.jpg']).toBe(unchanged);
  });

  it('defers duplicate warnings until revalidate', () => {
    useStore.getState().setFiles([scanned('a.jpg'), scanned('b.jpg')]);

    useStore
      .getState()
      .applyProgress([], [success('a.jpg', { sha256: 'dup' }), success('b.jpg', { sha256: 'dup' })]);

    expect(useStore.getState().validations['a.jpg'].severity).toBe('ok');
    expect(useStore.getState().validations['b.jpg'].severity).toBe('ok');

    useStore.getState().revalidate();

    expect(useStore.getState().validations['a.jpg'].severity).toBe('warning');
    expect(useStore.getState().validations['b.jpg'].severity).toBe('warning');
    expect(useStore.getState().validations['a.jpg'].issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
  });

  it(
    'processes a 17,000-file batch in bounded flush time',
    () => {
      const count = 17_000;
      const flushSize = 200;
      const file = new File([new Uint8Array(64)], 'x.jpg', { type: 'image/jpeg' });
      const files = Array.from({ length: count }, (_, i) =>
        scanned(`IMG_${i.toString().padStart(5, '0')}.jpg`, { file, fileName: file.name, size: file.size }),
      );
      useStore.getState().setFiles(files);

      const startedAt = performance.now();
      for (let offset = 0; offset < count; offset += flushSize) {
        const ids = files.slice(offset, offset + flushSize).map((f) => f.id);
        useStore.getState().applyProgress(
          ids,
          ids.map((id, i) => success(id, { sha256: `sha-${offset + i}` })),
        );
      }
      useStore.getState().revalidate();
      const elapsed = performance.now() - startedAt;

      console.log(`store applyProgress 17000 files: ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(2000);
    },
    30_000,
  );
});

it('sets and clears manual sources, and applies a spread in one store update', () => {
  useStore.getState().setFiles([scanned('a'), scanned('b')]);
  const state = useStore.getState();
  state.setManualNaive('a', NAIVE);
  expect(useStore.getState().files[0].manualSource).toBe('manual');
  const listener = vi.fn();
  const unsubscribe = useStore.subscribe(listener);
  const SPREAD_START: NaiveDateTime = { year: 2026, month: 7, day: 1, hour: 8, minute: 0, second: 0 };
  state.setManualNaiveMany(
    [{ id: 'a', naive: NAIVE }, { id: 'b', naive: NAIVE }],
    'spread',
    { method: 'sequence', start: SPREAD_START },
  );
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(useStore.getState().files.every((f) => f.manualSource === 'spread' && f.manualNaive === NAIVE)).toBe(true);
  // Stamped at application time so display never has to re-derive it (#256).
  expect(useStore.getState().files.every((f) => f.manualSpreadStart === SPREAD_START)).toBe(true);
  expect(useStore.getState().files.every((f) => f.manualSpreadMethod === 'sequence')).toBe(true);
  state.setManualNaive('a', null);
  expect(useStore.getState().files[0].manualNaive).toBeUndefined();
  expect(useStore.getState().files[0].manualSource).toBeUndefined();
  expect(useStore.getState().files[0].manualSpreadStart).toBeUndefined();
  // The optional third argument is meaningful only for a sequence spread.
  state.setManualNaiveMany([{ id: 'b', naive: NAIVE }], 'manual');
  expect(useStore.getState().files[1].manualSpreadStart).toBeUndefined();

  state.setManualNaiveMany(
    [{ id: 'b', naive: NAIVE }],
    'spread',
    { method: 'file-modified', timeZone: 'America/Phoenix' },
  );
  expect(useStore.getState().files[1]).toMatchObject({
    manualSpreadMethod: 'file-modified',
    manualSpreadStart: undefined,
    manualSpreadTimeZone: 'America/Phoenix',
  });
});

it('keeps two separately-spread folders\' starts distinct (#256)', () => {
  useStore.getState().setFiles([scanned('folderA/1'), scanned('folderB/1')]);
  const state = useStore.getState();
  const START_A: NaiveDateTime = { year: 2026, month: 7, day: 1, hour: 8, minute: 0, second: 0 };
  const START_B: NaiveDateTime = { year: 2026, month: 7, day: 1, hour: 14, minute: 0, second: 0 };
  state.setManualNaiveMany([{ id: 'folderA/1', naive: NAIVE }], 'spread', { method: 'sequence', start: START_A });
  state.setManualNaiveMany([{ id: 'folderB/1', naive: NAIVE }], 'spread', { method: 'sequence', start: START_B });
  const files = useStore.getState().files;
  expect(files.find((f) => f.id === 'folderA/1')?.manualSpreadStart).toEqual(START_A);
  expect(files.find((f) => f.id === 'folderB/1')?.manualSpreadStart).toEqual(START_B);
});

describe('upload comment preview date', () => {
  it('retains the first preview date across midnight and resets for the next batch', () => {
    vi.useFakeTimers();
    try {
      useStore.setState({ uploadCommentDate: null });
      vi.setSystemTime(new Date(2026, 9, 14, 23, 59));
      useStore.getState().captureUploadCommentDate();
      vi.setSystemTime(new Date(2026, 9, 15, 0, 1));
      useStore.getState().captureUploadCommentDate();
      expect(useStore.getState().uploadCommentDate).toBe('2026-10-14');
      const persisted = JSON.parse(window.sessionStorage.getItem('sparcd-uploader-session')!).state;
      expect(persisted.uploadCommentDate).toBe('2026-10-14');
      useStore.getState().nextBatch();
      expect(useStore.getState().uploadCommentDate).toBeNull();
      useStore.getState().captureUploadCommentDate();
      expect(useStore.getState().uploadCommentDate).toBe('2026-10-15');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('connected identity fallback', () => {
  const config = { endpoint: 'http://localhost', accessKey: 'storage-user', secretKey: 'test-secret', region: 'us-east-1', forcePathStyle: true, secure: false };
  it('fills empty and whitespace identities from the current account only after route absence is confirmed', async () => {
    for (const uploaderUser of ['', '   ']) {
      useStore.setState({ uploaderUser, s3Config: config });
      useStore.getState().ensureUploaderIdentity();
      await vi.waitFor(() => expect(useStore.getState().uploaderUser).toBe('storage-user'));
    }
  });
  it('preserves custom identity and leaves an offline blank unchanged', () => {
    useStore.setState({ s3Config: config, uploaderUser: '' });
    useStore.getState().setUploaderUser('Ada');
    useStore.getState().ensureUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('Ada');
    useStore.setState({ uploaderUser: '', s3Config: null });
    useStore.getState().ensureUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('');
  });

  it('keeps a cached account name or custom value through lookup failures and leaves an unresolved login blank', async () => {
    useStore.setState({ s3Config: config, connectionId: 81, uploaderUser: '', identityResolutionStatus: 'idle' });
    saveLoginIdentityDefault('storage-user', 'Research Account', 'whoami');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<Error><Code>AccessDenied</Code><Message>Access denied</Message></Error>',
      { status: 403 },
    )));
    await useStore.getState().refreshUploaderIdentity();
    expect(useStore.getState()).toMatchObject({
      uploaderUser: 'Research Account',
      identityResolutionStatus: 'error',
    });

    useStore.getState().setUploaderUser('Custom Field Name');
    await useStore.getState().refreshUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('Custom Field Name');

    window.localStorage.clear();
    useStore.getState().connect({ ...config, accessKey: 'unresolved-login' }, false);
    await vi.waitFor(() => expect(useStore.getState().identityResolutionStatus).toBe('error'));
    expect(useStore.getState()).toMatchObject({ uploaderUser: '', identityResolutionStatus: 'error' });
  });

  it.each([200, 403])('preserves an unsaved custom name when a pending lookup completes with %s and when retry starts', async (status) => {
    useStore.setState({ s3Config: config, connectionId: 84, uploaderUser: '' });
    const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const lookup = useStore.getState().refreshUploaderIdentity();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    useStore.getState().setUploaderUser('Unsaved Custom Name');
    respond(new Response(status === 200 ? JSON.stringify({ id: 'person', name: 'Default Name' }) : 'denied', { status }));
    await lookup;
    expect(useStore.getState()).toMatchObject({ uploaderUser: 'Unsaved Custom Name', identityPersistenceError: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const retry = useStore.getState().refreshUploaderIdentity();
    expect(useStore.getState().uploaderUser).toBe('Unsaved Custom Name');
    await retry;
    expect(useStore.getState().uploaderUser).toBe('Unsaved Custom Name');
    write.mockRestore();
  });

  it('refreshes the cached account-name default without affecting the login key', async () => {
    useStore.setState({ s3Config: config, connectionId: 83, uploaderUser: 'Previous Name' });
    saveLoginIdentityDefault('storage-user', 'Previous Name', 'whoami');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'person-123', name: 'Updated Name' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    await useStore.getState().refreshUploaderIdentity();
    expect(useStore.getState()).toMatchObject({ uploaderUser: 'Updated Name', identityResolutionStatus: 'ready' });
    expect(JSON.parse(window.localStorage.getItem(loginIdentityPreferenceKey('storage-user'))!).defaultIdentity).toBe('Updated Name');
  });
});
