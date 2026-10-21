// Opening collections and checking them for new uploads. A collection read
// before on this device opens from the cache at once; the rest are read with
// per-collection progress. Either way the workspace then checks every ETag in
// the background, then which photo files storage lacks.

import type { CollectionRef, SafeS3Client } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import {
  ExplorerDb,
  REQUESTS_IN_FLIGHT,
  accountKey,
  cachedRegistries,
  checkPhotoFiles,
  createLimiter,
  fetchRegistries,
  readCachedCollection,
  readClient,
  syncCollection,
  type LoadedCollection,
  type OpenStep,
  type Registries,
  type Source,
} from '@/data';
import { useStore } from '@/store';
import { openFailure } from './openingText';

const db = new ExplorerDb();
let current: { config: S3Config; client: SafeS3Client; source: Source } | null = null;

const sameConnection = (a: S3Config, b: S3Config) =>
  a.endpoint === b.endpoint &&
  a.region === b.region &&
  a.accessKey === b.accessKey &&
  a.secretKey === b.secretKey &&
  a.forcePathStyle === b.forcePathStyle &&
  a.secure === b.secure;

/**
 * The one client for a connection. Another tab can hand over the same
 * connection as a new object; the client stays, with the clock offset it
 * learned from the server.
 */
export function sourceFor(config: S3Config): Source {
  if (!current || !sameConnection(current.config, config)) {
    const client = readClient(config);
    current = { config, client, source: { client, db, account: accountKey(config) } };
  }
  return current.source;
}

/** How far the server's clock is ahead of this computer's, in ms, as learned so far. */
export function clockOffsetFor(config: S3Config): number {
  sourceFor(config);
  return current!.client.clockOffset;
}



export type Progress = {
  ref: CollectionRef;
  /** Read from this device; nothing to wait for. */
  cached: boolean;
  step: OpenStep | 'waiting' | 'ready' | 'failed';
  done: number;
  total: number;
  error?: string;
};

/** A collection that couldn't open, and why in plain words. */
export type Failure = { ref: CollectionRef; reason: string };

/** The species lists and registries last read for `refs`, in their order. */
export const registriesFor = (config: S3Config, refs: CollectionRef[]): Promise<Registries> => cachedRegistries(sourceFor(config), refs);

/**
 * Open `refs`. When every one is cached this returns at once with the cached
 * copies; otherwise it reads the missing ones, reporting progress. Every
 * collection is tried; those that fail come back in `failed`, and
 * `registries` covers the loaded ones. Throws the abort reason when cancelled.
 */
export async function openSelection(
  config: S3Config,
  refs: CollectionRef[],
  opts: { signal: AbortSignal; onProgress: (p: Progress[]) => void },
): Promise<{ loaded: LoadedCollection[]; failed: Failure[]; registries: Registries }> {
  const source = sourceFor(config);
  const cached = await Promise.all(refs.map((ref) => readCachedCollection(source.db, source.account, ref)));
  if (cached.every(Boolean)) {
    return { loaded: cached as LoadedCollection[], failed: [], registries: await cachedRegistries(source, refs) };
  }

  const progress: Progress[] = refs.map((ref, i) => ({
    ref,
    cached: Boolean(cached[i]),
    step: cached[i] ? 'ready' : 'waiting',
    done: 0,
    total: 0,
  }));
  const report = () => opts.onProgress(progress.map((p) => ({ ...p })));
  report();
  const run = createLimiter(REQUESTS_IN_FLIGHT);
  const [results] = await Promise.all([
    Promise.all(
      refs.map(async (ref, i): Promise<LoadedCollection | Failure> => {
        if (cached[i]) return cached[i]!;
        try {
          const read = await syncCollection(source, ref, {
            signal: opts.signal,
            run,
            onProgress: (p) => {
              Object.assign(progress[i], { step: p.step, done: p.done, total: p.total });
              report();
            },
          });
          progress[i].step = 'ready';
          report();
          return read;
        } catch (err) {
          if (opts.signal.aborted) throw err;
          const reason = openFailure(err);
          Object.assign(progress[i], { step: 'failed', error: reason });
          report();
          return { ref, reason };
        }
      }),
    ),
    fetchRegistries(source, refs),
  ]);
  opts.signal.throwIfAborted();
  const loaded = results.filter((r): r is LoadedCollection => !('reason' in r));
  const failed = results.filter((r): r is Failure => 'reason' in r);
  return { loaded, failed, registries: await cachedRegistries(source, loaded.map((l) => l.ref)) };
}

/** Keep what the server's answers so far say about this computer's clock, for Data checks. */
export function noteClock(config: S3Config): void {
  if (useStore.getState().config === config) useStore.setState({ clockOffset: clockOffsetFor(config) });
}

let checking: AbortController | null = null;
let filesCheck: AbortController | null = null;

/** Stop the background checks, e.g. when leaving the workspace. */
export function stopChecking(): void {
  checking?.abort();
  checking = null;
  filesCheck?.abort();
  filesCheck = null;
}

/**
 * List the open uploads' folders and leave out the photos whose files aren't
 * there. Folders whose media.csv is unchanged since their last listing are
 * skipped unless `force`. Nothing waits on it; a folder that fails to list
 * keeps its last answer, and Data checks says so.
 */
export async function checkFiles(force = false): Promise<void> {
  const { config, loaded, setCheckingFiles, applyFiles } = useStore.getState();
  if (!config || !loaded.length) return;
  filesCheck?.abort();
  const controller = (filesCheck = new AbortController());
  setCheckingFiles(true);
  try {
    const check = await checkPhotoFiles(sourceFor(config), loaded, { signal: controller.signal, force });
    if (useStore.getState().loaded === loaded) applyFiles(check);
  } catch {
    // Cancelled: the counts stay as they are.
  } finally {
    // A newer check that replaced this one keeps the status.
    if (filesCheck === controller) filesCheck = null;
    if (filesCheck === null) setCheckingFiles(false);
  }
}

/** Check every open collection's ETags and apply what changed, then the photo files. `force` lists every folder again. */
export async function checkForUploads(force = false): Promise<void> {
  const { config, refs, setChecking, applyRefresh } = useStore.getState();
  if (!config || !refs.length) return;
  stopChecking();
  const controller = (checking = new AbortController());
  const source = sourceFor(config);
  setChecking(true);
  try {
    const run = createLimiter(REQUESTS_IN_FLIGHT);
    const [loaded, registries] = await Promise.all([
      Promise.all(refs.map((ref) => syncCollection(source, ref, { signal: controller.signal, run }))),
      fetchRegistries(source, refs),
    ]);
    if (useStore.getState().refs !== refs) return;
    applyRefresh(loaded, registries);
    noteClock(config);
    setChecking(false);
    void checkFiles(force);
  } catch (err) {
    // A newer check replaced this one; leave its spinner alone.
    if (controller.signal.aborted) {
      if (checking === null || checking === controller) setChecking(false);
      return;
    }
    setChecking(false, openFailure(err));
    void checkFiles(force);
  } finally {
    if (checking === controller) checking = null;
  }
}
