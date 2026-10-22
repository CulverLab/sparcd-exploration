// Species and location registries are read the Tagger's way: the
// collection's own `Collections/<UUID>/<file>` when it has entries, else
// `Settings/<file>` from the SPARC'd settings bucket found among the visible
// buckets.

import { translateReadError } from '@sparcd/s3-safe';
import { decode, isMissingObjectError, type ReadClient } from './s3';

export type RegistrySource = {
  /** Settings bucket when the fallback was used; null for the collection's own file. */
  settingsBucket: string | null;
  sourceBucket: string;
  sourceKey: string;
};

export class NoSettingsBucketError extends Error {
  constructor(key: string) {
    super(
      `No readable settings bucket found. The connected credentials must be able to ` +
        `HEAD/GET "${key}" in one visible bucket, and that bucket must allow this origin via CORS.`,
    );
    this.name = 'NoSettingsBucketError';
  }
}

function settingsRank(bucket: string): number {
  if (bucket.startsWith('sparcd-settings-')) return 0;
  if (bucket === 'sparcd') return 1;
  return 2;
}

async function discoverSettingsBucket(client: ReadClient, key: string): Promise<string> {
  const buckets = await client.listBuckets();
  const found: string[] = [];
  await Promise.all(
    buckets.map(async (bucket) => {
      try {
        await client.statObject(bucket, key);
        found.push(bucket);
      } catch {
        // Not a settings bucket, unreadable, or CORS-blocked.
      }
    }),
  );
  // Prefer the official settings bucket name, then the legacy `sparcd` bucket.
  const [best] = found.sort((a, b) => settingsRank(a) - settingsRank(b) || a.localeCompare(b));
  if (!best) throw new NoSettingsBucketError(key);
  return best;
}

/**
 * Read `file` for a collection, falling back to settings when the collection
 * copy is missing or `isEmpty` says it has no entries. A collection copy that
 * fails for any other reason is an error, never a silent switch to global data.
 */
export async function readCollectionOrSettings<T>(
  client: ReadClient,
  collection: { bucket: string; uuid: string } | null,
  file: string,
  parse: (text: string) => T,
  isEmpty: (parsed: T) => boolean,
): Promise<{ parsed: T } & RegistrySource> {
  if (collection) {
    const key = `Collections/${collection.uuid}/${file}`;
    let bytes: Uint8Array | undefined;
    try {
      bytes = await client.getObject(collection.bucket, key);
    } catch (err) {
      if (!isMissingObjectError(err)) throw translateReadError(err, `"${key}" in bucket "${collection.bucket}"`);
    }
    if (bytes) {
      const parsed = parse(decode(bytes));
      if (!isEmpty(parsed)) return { parsed, settingsBucket: null, sourceBucket: collection.bucket, sourceKey: key };
    }
  }
  const key = `Settings/${file}`;
  const settingsBucket = await discoverSettingsBucket(client, key);
  let bytes: Uint8Array;
  try {
    bytes = await client.getObject(settingsBucket, key);
  } catch (err) {
    throw translateReadError(err, `"${key}"`);
  }
  return { parsed: parse(decode(bytes)), settingsBucket, sourceBucket: settingsBucket, sourceKey: key };
}
