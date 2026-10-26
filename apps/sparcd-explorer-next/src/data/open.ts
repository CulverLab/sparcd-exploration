// Opening collections. Each collection lists its upload folders, then each
// folder once (one delimiter listing) for the ETags of its four files, and
// only files that are new or whose ETag changed are fetched. Every request
// shares one pool of 8 and one AbortSignal. A collection read before can be
// shown from the cache first, then checked with `openCollections`.
//
// An upload without UploadMeta.json is incomplete (the Tagger's rule): it is
// hidden, and counted so the hiding is visible.

import {
  parseDeploymentsNullable,
  parseMedia,
  parseObservations,
  parseUploadMeta,
} from '@sparcd/camtrap';
import { listCollections, translateReadError, type CollectionRef } from '@sparcd/s3-safe';
import {
  UPLOAD_FILES,
  cachedCollectionKeys,
  cachedUploads,
  stripAccount,
  type ExplorerDb,
  type LoadedUpload,
  type ReadProblem,
  type UploadFile,
} from './cache';
import { createLimiter, type Limiter } from './limit';
import { decode, type ReadClient } from './s3';

/** Where collections are read from and cached to. */
export type Source = { client: ReadClient; db: ExplorerDb; account: string };

export type LoadedCollection = {
  ref: CollectionRef;
  uploads: LoadedUpload[];
  hiddenUploads: string[];
  problems: ReadProblem[];
  /** True when this read changed anything since the cached copy. */
  changed: boolean;
  checkedAt: number;
};

export type OpenStep = 'finding' | 'reading' | 'drawing';
export type OpenProgress = { collection: string; step: OpenStep; done: number; total: number };

export const REQUESTS_IN_FLIGHT = 8;

export async function discoverCollections(source: Source): Promise<(CollectionRef & { cached: boolean })[]> {
  const [refs, cached] = await Promise.all([
    listCollections(source.client),
    cachedCollectionKeys(source.db, source.account),
  ]);
  return refs.map((ref) => ({ ...ref, cached: cached.has(ref.key) }));
}

const uploadsPrefix = (ref: CollectionRef) => `Collections/${ref.uuid}/Uploads/`;

/** The collection as last read in full, or null when it was never read here. */
export async function readCachedCollection(
  db: ExplorerDb,
  account: string,
  ref: CollectionRef,
): Promise<LoadedCollection | null> {
  const record = await db.collections.get([account, ref.bucket, ref.uuid]);
  if (!record) return null;
  const rows = await cachedUploads(db, account, ref.bucket);
  return {
    ref,
    uploads: record.folders.flatMap((folder) => {
      const row = rows.get(folder);
      return row ? [stripAccount(row)] : [];
    }),
    hiddenUploads: record.hiddenUploads,
    problems: record.problems,
    changed: false,
    checkedAt: record.checkedAt,
  };
}

function parseFile(file: UploadFile, text: string): Partial<LoadedUpload> {
  switch (file) {
    case 'UploadMeta.json':
      return { meta: parseUploadMeta(text) };
    case 'deployments.csv':
      return { deployments: parseDeploymentsNullable(text) };
    case 'media.csv':
      return { media: parseMedia(text) };
    case 'observations.csv':
      return { observations: parseObservations(text) };
  }
}

const EMPTY_FILE: Record<UploadFile, Partial<LoadedUpload>> = {
  'UploadMeta.json': { meta: null },
  'deployments.csv': { deployments: [] },
  'media.csv': { media: [] },
  'observations.csv': { observations: [] },
};

type FolderResult =
  | { kind: 'visible'; upload: LoadedUpload; changed: boolean; problems: ReadProblem[] }
  | { kind: 'hidden' }
  | { kind: 'unlisted'; problem: ReadProblem };

async function readFolder(
  source: Source,
  bucket: string,
  folder: string,
  cached: LoadedUpload | undefined,
  run: Limiter,
  signal?: AbortSignal,
): Promise<FolderResult> {
  let objects;
  try {
    ({ objects } = await run(() => source.client.listFolder(bucket, folder, { signal })));
  } catch (err) {
    if (signal?.aborted) throw err;
    return { kind: 'unlisted', problem: { folder, file: 'listing', message: translateReadError(err, folder).message } };
  }
  const listed = new Map<string, string>();
  for (const o of objects) listed.set(o.key.slice(folder.length), o.etag ?? '');
  if (!listed.has('UploadMeta.json')) return { kind: 'hidden' };

  const upload: LoadedUpload = cached
    ? { ...cached, etags: { ...cached.etags } }
    : { folder, etags: {}, meta: null, deployments: [], media: [], observations: [] };
  const problems: ReadProblem[] = [];
  let changed = !cached;
  await Promise.all(
    UPLOAD_FILES.map(async (file) => {
      const etag = listed.get(file);
      if (etag === undefined) {
        if (upload.etags[file] !== undefined) changed = true;
        Object.assign(upload, EMPTY_FILE[file]);
        delete upload.etags[file];
        return;
      }
      if (cached?.etags[file] === etag) return;
      try {
        const bytes = await run(() => source.client.getObject(bucket, folder + file, { signal }));
        Object.assign(upload, parseFile(file, decode(bytes)));
        upload.etags[file] = etag;
        changed = true;
      } catch (err) {
        if (signal?.aborted) throw err;
        // Older rows, if any, keep their own ETag, so the next read retries this file.
        problems.push({ folder, file, message: translateReadError(err, file).message });
      }
    }),
  );
  return { kind: 'visible', upload, changed, problems };
}

/**
 * Read one collection from storage, reusing cached rows whose ETag still
 * matches, and update the cache. Folders that fail to list keep their cached
 * rows; files that fail to read are reported in `problems`.
 */
export async function syncCollection(
  source: Source,
  ref: CollectionRef,
  opts: { signal?: AbortSignal; run?: Limiter; onProgress?: (p: OpenProgress) => void } = {},
): Promise<LoadedCollection> {
  const { signal, onProgress } = opts;
  const run: Limiter = opts.run ?? createLimiter(REQUESTS_IN_FLIGHT);
  const guarded: Limiter = (task) =>
    run(() => {
      signal?.throwIfAborted();
      return task();
    });
  const report = (step: OpenStep, done = 0, total = 0) => onProgress?.({ collection: ref.key, step, done, total });

  report('finding');
  let listing;
  try {
    listing = await guarded(() => source.client.listFolder(ref.bucket, uploadsPrefix(ref), { signal }));
  } catch (err) {
    if (signal?.aborted) throw err;
    throw translateReadError(err, `the uploads of "${ref.name ?? ref.bucket}"`);
  }
  const folders = [...listing.prefixes].sort();
  const cached = await cachedUploads(source.db, source.account, ref.bucket);

  let done = 0;
  report('reading', done, folders.length);
  const results = await Promise.all(
    folders.map(async (folder) => {
      const row = cached.get(folder);
      const result = await readFolder(source, ref.bucket, folder, row && stripAccount(row), guarded, signal);
      report('reading', ++done, folders.length);
      return { folder, result };
    }),
  );

  // Nothing is written until every folder is read, so a cancel at any point
  // leaves the cache exactly as it was.
  const uploads: LoadedUpload[] = [];
  const changedUploads: LoadedUpload[] = [];
  const hiddenUploads: string[] = [];
  const problems: ReadProblem[] = [];
  let changed = false;
  for (const { folder, result } of results) {
    if (result.kind === 'hidden') hiddenUploads.push(folder);
    else if (result.kind === 'unlisted') {
      problems.push(result.problem);
      const row = cached.get(folder);
      if (row) uploads.push(stripAccount(row));
    } else {
      uploads.push(result.upload);
      problems.push(...result.problems);
      if (result.changed) changedUploads.push(result.upload);
      changed ||= result.changed;
    }
  }
  const kept = new Set(uploads.map((u) => u.folder));
  const gone = [...cached.keys()].filter((folder) => !kept.has(folder));
  const { db, account } = source;
  const previous = await db.collections.get([account, ref.bucket, ref.uuid]);
  if (gone.length || !previous || previous.hiddenUploads.join() !== hiddenUploads.join()) changed = true;
  report('drawing', folders.length, folders.length);
  signal?.throwIfAborted();

  const checkedAt = Date.now();
  // A cancel until the transaction commits rolls the whole write back, so the
  // listener stays until the transaction settles, not just its callback.
  let abort: (() => void) | undefined;
  try {
    await db.transaction('rw', db.uploads, db.collections, async (tx) => {
      abort = () => tx.abort();
      signal?.addEventListener('abort', abort);
      signal?.throwIfAborted();
      await db.uploads.bulkPut(changedUploads.map((u) => ({ ...u, account, bucket: ref.bucket })));
      signal?.throwIfAborted();
      await db.uploads.bulkDelete(gone.map((folder) => [account, ref.bucket, folder]));
      signal?.throwIfAborted();
      await db.collections.put({
        account,
        bucket: ref.bucket,
        uuid: ref.uuid,
        folders: uploads.map((u) => u.folder),
        hiddenUploads,
        problems,
        checkedAt,
      });
      signal?.throwIfAborted();
    });
  } catch (err) {
    signal?.throwIfAborted();
    throw err;
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
  }
  signal?.throwIfAborted();
  return { ref, uploads, hiddenUploads, problems, changed, checkedAt };
}

/** Read several collections together; all their requests share one pool of 8. */
export function openCollections(
  source: Source,
  refs: CollectionRef[],
  opts: { signal?: AbortSignal; onProgress?: (p: OpenProgress) => void } = {},
): Promise<LoadedCollection[]> {
  const run = createLimiter(REQUESTS_IN_FLIGHT);
  return Promise.all(refs.map((ref) => syncCollection(source, ref, { ...opts, run })));
}
