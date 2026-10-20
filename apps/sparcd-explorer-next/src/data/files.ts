// Which photos media.csv lists that storage doesn't have. Older uploaders
// write media rows before the files arrive, and some files never do, so the
// rows alone overcount. Every visible upload folder is listed in full in the
// background and compared with its media.csv. The answer is cached per folder
// by media.csv's ETag, so a reopen with nothing new lists nothing; Refresh
// lists every folder again.

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

/**
 * The photo files the visible uploads of `collections` list but storage
 * lacks, as `bucket/key`. A folder that fails to list counts as having all
 * its files, and is listed again next time. Throws the abort reason when
 * cancelled; folders already listed stay cached.
 */
export async function checkPhotoFiles(
  source: Source,
  collections: LoadedCollection[],
  opts: { signal?: AbortSignal; force?: boolean } = {},
): Promise<Set<string>> {
  const { client, db, account } = source;
  const { signal } = opts;
  const run = createLimiter(FOLDERS_IN_FLIGHT);
  const missing = new Set<string>();
  await Promise.all(
    collections.map(async ({ ref, uploads }) => {
      const { bucket } = ref;
      const cached = new Map<string, CachedFileCheck>();
      if (!opts.force) {
        for (const row of await db.files.where('[account+bucket]').equals([account, bucket]).toArray()) cached.set(row.folder, row);
      }
      await Promise.all(
        uploads.map(async (upload) => {
          const mediaEtag = upload.etags['media.csv'];
          if (!mediaEtag || !upload.media.length) return;
          let found = cached.get(upload.folder)?.mediaEtag === mediaEtag ? cached.get(upload.folder)!.missing : null;
          if (!found) {
            try {
              const listed = await run(async () => {
                signal?.throwIfAborted();
                const keys = new Set<string>();
                for await (const o of client.listObjects(bucket, upload.folder, { signal })) keys.add(o.key);
                return keys;
              });
              found = missingKeys(upload.media, listed);
            } catch (err) {
              if (signal?.aborted) throw err;
              return;
            }
            await db.files.put({ account, bucket, folder: upload.folder, mediaEtag, missing: found });
          }
          for (const key of found) missing.add(`${bucket}/${key}`);
        }),
      );
    }),
  );
  signal?.throwIfAborted();
  return missing;
}
