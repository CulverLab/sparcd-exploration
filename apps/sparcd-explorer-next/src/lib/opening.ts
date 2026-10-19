// Opening collections and checking them for new uploads. A collection read
// before on this device opens from the cache at once; the rest are read with
// per-collection progress. Either way the workspace then checks every ETag in
// the background.

import type { CollectionRef } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import {
  ExplorerDb,
  REQUESTS_IN_FLIGHT,
  accountKey,
  createLimiter,
  fetchLocations,
  fetchSpecies,
  readCachedCollection,
  readClient,
  syncCollection,
  type LoadedCollection,
  type OpenStep,
  type RegistryLocation,
  type Source,
  type Species,
} from '@/data';
import { useStore, type Registries } from '@/store';

const db = new ExplorerDb();
let current: { config: S3Config; source: Source } | null = null;

export function sourceFor(config: S3Config): Source {
  if (current?.config !== config) current = { config, source: { client: readClient(config), db, account: accountKey(config) } };
  return current.source;
}

type CollectionRegistries = { species: Species[]; registry: RegistryLocation[] };
const remembered = new Map<string, CollectionRegistries>();

const combine = (parts: CollectionRegistries[]): Registries => ({
  species: parts.map((p) => p.species),
  registry: parts.flatMap((p) => p.registry),
});

/**
 * Species lists and the location registry for the open collections. They only
 * improve names and fill blanks, so one that can't be read is left out.
 */
export async function loadRegistries(source: Source, refs: CollectionRef[]): Promise<Registries> {
  const parts = await Promise.all(
    refs.map(async (ref) => {
      const [species, locations] = await Promise.allSettled([fetchSpecies(source.client, ref), fetchLocations(source.client, ref)]);
      const part = {
        species: species.status === 'fulfilled' ? species.value.species : [],
        registry: locations.status === 'fulfilled' ? locations.value.locations : [],
      };
      remembered.set(`${source.account}|${ref.key}`, part);
      return part;
    }),
  );
  return combine(parts);
}

/** What this session already read, so a cached collection opens with its names at once. */
export const rememberedRegistries = (source: Source, refs: CollectionRef[]): Registries =>
  combine(refs.map((ref) => remembered.get(`${source.account}|${ref.key}`) ?? { species: [], registry: [] }));

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
  if (cached.every(Boolean)) return { loaded: cached as LoadedCollection[], registries: rememberedRegistries(source, refs) };

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
    loadRegistries(source, refs),
  ]);
  opts.signal.throwIfAborted();
  return { loaded, registries };
}

let checking: AbortController | null = null;

/** Stop a background check, e.g. when leaving the workspace. */
export function stopChecking(): void {
  checking?.abort();
  checking = null;
}

/** Check every open collection's ETags and apply what changed. */
export async function checkForUploads(): Promise<void> {
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
      loadRegistries(source, refs),
    ]);
    if (useStore.getState().refs !== refs) return;
    applyRefresh(loaded, registries);
    setChecking(false);
  } catch (err) {
    // A newer check replaced this one; leave its spinner alone.
    if (controller.signal.aborted) {
      if (checking === null || checking === controller) setChecking(false);
      return;
    }
    setChecking(false, errorText(err));
  } finally {
    if (checking === controller) checking = null;
  }
}
