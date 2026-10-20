// Opening collections and checking them for new uploads. A collection read
// before on this device opens from the cache at once; the rest are read with
// per-collection progress. Either way the workspace then checks every ETag in
// the background, then which photo files storage lacks.

import type { CollectionRef } from '@sparcd/s3-safe';
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

const db = new ExplorerDb();
let current: { config: S3Config; source: Source } | null = null;

export function sourceFor(config: S3Config): Source {
  if (current?.config !== config) current = { config, source: { client: readClient(config), db, account: accountKey(config) } };
  return current.source;
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

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Open `refs`. When every one is cached this returns at once with the cached
 * copies; otherwise it reads the missing ones, reporting progress. Throws the
 * abort reason when cancelled, and an error naming the collection that failed.
 */
export async function openSelection(
  config: S3Config,
  refs: CollectionRef[],
  opts: { signal: AbortSignal; onProgress: (p: Progress[]) => void },
): Promise<{ loaded: LoadedCollection[]; registries: Registries }> {
  const source = sourceFor(config);
  const cached = await Promise.all(refs.map((ref) => readCachedCollection(source.db, source.account, ref)));
  if (cached.every(Boolean)) return { loaded: cached as LoadedCollection[], registries: await cachedRegistries(source, refs) };

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
  const [loaded, registries] = await Promise.all([
    Promise.all(
      refs.map(async (ref, i) => {
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
          if (!opts.signal.aborted) {
            Object.assign(progress[i], { step: 'failed', error: errorText(err) });
            report();
          }
          throw err;
        }
      }),
    ),
    fetchRegistries(source, refs),
  ]);
  opts.signal.throwIfAborted();
  return { loaded, registries };
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
 * skipped unless `force`. Nothing waits on it, and a failed check changes nothing.
 */
export async function checkFiles(force = false): Promise<void> {
  const { config, loaded, setCheckingFiles, applyMissing } = useStore.getState();
  if (!config || !loaded.length) return;
  filesCheck?.abort();
  const controller = (filesCheck = new AbortController());
  setCheckingFiles(true);
  try {
    const missing = await checkPhotoFiles(sourceFor(config), loaded, { signal: controller.signal, force });
    if (useStore.getState().loaded === loaded) applyMissing(missing);
  } catch {
    // Cancelled, or storage refused: the counts stay as they are.
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
    setChecking(false);
    void checkFiles(force);
  } catch (err) {
    // A newer check replaced this one; leave its spinner alone.
    if (controller.signal.aborted) {
      if (checking === null || checking === controller) setChecking(false);
      return;
    }
    setChecking(false, errorText(err));
    void checkFiles(force);
  } finally {
    if (checking === controller) checking = null;
  }
}
