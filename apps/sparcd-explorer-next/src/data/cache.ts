// The local copy of what was read, so a collection opened before renders at
// once. One row per upload folder, keyed by (account, bucket, folder), with
// the parsed rows and the ETag of each file they came from. An account is
// endpoint plus access key, so another server or key never sees these rows.
// Signing out clears nothing.

import Dexie, { type Table } from 'dexie';
import type { Media, NullableDeployment, Observation, UploadMetaJson } from '@sparcd/camtrap';

export const UPLOAD_FILES = ['UploadMeta.json', 'deployments.csv', 'media.csv', 'observations.csv'] as const;
export type UploadFile = (typeof UPLOAD_FILES)[number];

/** One upload folder's parsed files. `etags` names the version each file's rows came from. */
export type LoadedUpload = {
  folder: string; // `Collections/<uuid>/Uploads/<stamp>/`
  etags: Partial<Record<UploadFile, string>>;
  meta: UploadMetaJson | null;
  deployments: NullableDeployment[];
  media: Media[];
  observations: Observation[];
};

/** A file or listing that could not be read. Its rows are missing until a later read succeeds. */
export type ReadProblem = { folder: string; file: UploadFile | 'listing'; message: string };

export type CachedUpload = LoadedUpload & { account: string; bucket: string };

/** Written only after a full read, so a cancelled first open never looks complete. */
export type CachedCollection = {
  account: string;
  bucket: string;
  uuid: string;
  folders: string[];
  hiddenUploads: string[];
  problems: ReadProblem[];
  checkedAt: number;
};

export class ExplorerDb extends Dexie {
  uploads!: Table<CachedUpload, [string, string, string]>;
  collections!: Table<CachedCollection, [string, string, string]>;

  constructor(name = 'sparcd-explorer') {
    super(name);
    this.version(1).stores({
      uploads: '[account+bucket+folder], [account+bucket]',
      collections: '[account+bucket+uuid]',
    });
  }
}

export async function cachedUploads(db: ExplorerDb, account: string, bucket: string): Promise<Map<string, CachedUpload>> {
  const rows = await db.uploads.where('[account+bucket]').equals([account, bucket]).toArray();
  return new Map(rows.map((row) => [row.folder, row]));
}

export async function cachedCollectionKeys(db: ExplorerDb, account: string): Promise<Set<string>> {
  const rows = await db.collections.filter((c) => c.account === account).toArray();
  return new Set(rows.map((c) => `${c.bucket}::${c.uuid}`));
}

export function stripAccount({ account: _a, bucket: _b, ...upload }: CachedUpload): LoadedUpload {
  return upload;
}
