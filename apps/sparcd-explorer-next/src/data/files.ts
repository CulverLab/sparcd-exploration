// Which photos media.csv lists that storage doesn't have. Older uploaders
// write media rows before the files arrive, and some files never do, so the
// rows alone overcount. Every visible upload folder is listed in full in the
// background and compared with its media.csv. The answer is cached per folder
// by media.csv's ETag, so a reopen with nothing new lists nothing; Refresh
// lists every folder again. A folder that fails to list keeps its last answer.

import type { CachedFileCheck } from './cache';
import { createLimiter } from './limit';
import type { LoadedCollection, Source } from './open';

/** Folders listed at once. Each walks its pages one after another. */
export const FOLDERS_IN_FLIGHT = 3;

/** The media rows whose key isn't among `listed`. One pass over each. */
export function missingKeys(media: { mediaPath: string }[], listed: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const m of media) if (!listed.has(m.mediaPath)) missing.push(m.mediaPath);
  return missing;
}

export type FileCheck = {
  /** Photo files media.csv lists that storage lacks, as `bucket/key`. */
  missing: Set<string>;
  /** The folders listed this time, as `bucket/folder`: every file under one is known now. */
  listed: string[];
  /** Uploads whose folder couldn't be listed. Their last listing's answer stands. */
  failed: number;
};

/**
 * The photo files the visible uploads of `collections` lack. A folder that
 * fails to list keeps what its last listing found, or counts as having all
 * its files when it has none, and is listed again next time. Throws the abort
 * reason when cancelled; folders already listed stay cached.
 */
export async function checkPhotoFiles(
  source: Source,
  collections: LoadedCollection[],
  opts: { signal?: AbortSignal; force?: boolean } = {},
): Promise<FileCheck> {
  const { client, db, account } = source;
  const { signal } = opts;
  const run = createLimiter(FOLDERS_IN_FLIGHT);
  const check: FileCheck = { missing: new Set(), listed: [], failed: 0 };
  await Promise.all(
    collections.map(async ({ ref, uploads }) => {
      const { bucket } = ref;
      const cached = new Map<string, CachedFileCheck>();
      for (const row of await db.files.where('[account+bucket]').equals([account, bucket]).toArray()) cached.set(row.folder, row);
      await Promise.all(
        uploads.map(async (upload) => {
          const mediaEtag = upload.etags['media.csv'];
          if (!mediaEtag || !upload.media.length) return;
          const last = cached.get(upload.folder);
          let found = !opts.force && last?.mediaEtag === mediaEtag ? last.missing : null;
          if (!found) {
            const listed = await run(async () => {
              signal?.throwIfAborted();
              const keys = new Set<string>();
              for await (const o of client.listObjects(bucket, upload.folder, { signal })) keys.add(o.key);
              return keys;
            }).catch((err) => {
              if (signal?.aborted) throw err;
              return null;
            });
            if (listed) {
              found = missingKeys(upload.media, listed);
              await db.files.put({ account, bucket, folder: upload.folder, mediaEtag, missing: found });
              check.listed.push(`${bucket}/${upload.folder}`);
            } else {
              check.failed++;
              if (!last) return;
              found = last.missing;
              // Kept, but no longer current, so the next check lists it again.
              if (last.mediaEtag === mediaEtag) await db.files.put({ ...last, mediaEtag: '' });
            }
          }
          for (const key of found) check.missing.add(`${bucket}/${key}`);
        }),
      );
    }),
  );
  signal?.throwIfAborted();
  return check;
}
