// The hand-off record between the uploader and the tagger — one not-yet-uploaded
// local batch, handed over for species tagging and handed back with tags.
//
// Both tools deploy under the same origin in production
// (`/sparcd-exploration/uploader/` and `.../tagger/`), so a shared IndexedDB
// database is the transport: the uploader writes a record and navigates, the
// tagger opens it by id, writes tags back into the same row, and navigates home.
// Nothing leaves the browser, so a batch can be tagged with no connection at all.
//
// Blobs (the 64px thumbnails) and a `FileSystemDirectoryHandle` are stored
// directly — IndexedDB structured-clones both, which is the whole reason this
// is a Dexie store and not a query string.
//
// Schema versioning follows the two apps' rule: Dexie's versioning API with
// forward-carrying upgrade callbacks. Dexie v2 adds the vocabulary cache;
// the separate record v2 contract identifies batch-bound species snapshots.

import Dexie, { type Table } from 'dexie';
import { validPreparedSpecies, copyPreparedSpecies, type PreparedSpecies } from './preparedSpecies';
import { deriveFlipOwnerScope, isValidFlipOwnerScope, type FlipOwnerConnection } from './ownerScope';
export { canonicalFlipEndpoint, deriveFlipOwnerScope, isValidFlipOwnerScope } from './ownerScope';
export type { FlipOwnerConnection } from './ownerScope';
export { validPreparedSpecies } from './preparedSpecies';
export type { PreparedSpecies } from './preparedSpecies';

/** One species applied to one image. Structurally identical to the tagger's
 *  `DraftObservation` and deliberately duplicated — the two apps stay
 *  independent, and this shape is the wire contract between them. */
export type FlipObservation = {
  scientificName: string;
  commonName: string;
  count: number;
  requestedSpecies: string;
  freeTags: string;
  /** Identity captured when this identification was made. */
  classifiedBy?: string;
  /** ISO timestamp paired with classifiedBy. */
  classificationTimestamp?: string;
  reviewEvents?: { reviewedBy: string; reviewedAt: string }[];
};

/**
 * One file in the handed-over batch. `relPath` is the uploader's scan id — the
 * path within the chosen folder — and is unique within a batch, so it doubles
 * as the tag key and the tagger's media key.
 *
 * Everything Inspect established rides along, not just what the tagger needs to
 * draw a tile: the batch is rebuilt from this record on the way back, and a
 * field that didn't travel is a field the uploader has to do without. Most of
 * it is display-only, but `mimeType` reaches `media.csv`, so a batch that went
 * through the tagger would otherwise publish differently from the same batch
 * uploaded straight through.
 */
export interface FlipFile {
  relPath: string;
  fileName: string;
  size: number;
  sha256: string;
  lastModified?: number;
  mediaKind: 'image' | 'video';

  // Capture time, naive wall-clock `YYYY-MM-DDTHH:mm:ss` with no zone applied.
  // The two sources stay apart: the uploader shows and offers different things
  // for a time the camera wrote than for one a person entered, so a manual time
  // must not come home looking like EXIF.
  /** The camera's own capture time, from EXIF or the video container. */
  exifTimestamp?: string;
  /** EXIF ModifyDate is metadata-edit time, retained even after a manual correction. */
  exifTimestampSource?: 'exif-modify';
  /** A capture time entered by hand for a file the camera left blank. */
  manualTimestamp?: string;
  /** The sequence start entered when `timestampSource` is `spread`. Absent
   * for a spread based on each file's modified time. */
  manualSpreadStart?: string;
  /** Whether a spread used a typed sequence start or each file's modified time. */
  manualSpreadMethod?: 'sequence' | 'file-modified';
  /** Upload timezone used to convert file modified times when the spread ran. */
  manualSpreadTimeZone?: string;
  estimatedTimestamp?: string;
  timestampSource?: 'manual' | 'spread' | 'interpolated' | 'offset' | 'file-modified' | 'exif-modify';

  /** The worker's own sniff of the media type — authoritative over the file
   *  extension, and the value that lands in `media.csv`. */
  mimeType?: string;
  exifCamera?: string;
  gps?: { lat: number; lon: number };
  width?: number;
  height?: number;

  thumb?: Blob; // the 64px thumbnail the uploader already computed
}

/**
 * The one capture time to display for a file: the camera's own, else the one
 * entered by hand. Mirrors how the uploader resolves it at bundle build, so the
 * tagger shows the same value the upload will carry.
 */
export const captureTimestampOf = (file: FlipFile): string | undefined =>
  file.exifTimestampSource === 'exif-modify' && file.manualTimestamp
    ? file.manualTimestamp
    : file.exifTimestamp ?? file.manualTimestamp ?? file.estimatedTimestamp;

export interface FlipRecord {
  id: string;
  /** Schema version. A record this build does not understand is treated as
   *  absent rather than guessed at. v2 carries a prepared species snapshot. */
  v: 1 | 2;
  createdAt: string; // ISO
  /** ISO; bumped on every read and tag write, and what the pruning sweep ages
   *  from. Absent on a record neither tool has touched since it was written. */
  usedAt?: string;
  returnUrl: string; // where the tagger sends the user back to
  /** Present when the browser granted a durable folder handle. Its presence is
   *  the only thing anything branches on — no handle means thumbnails only,
   *  and the folder has to be chosen again on the way back. */
  dirHandle?: FileSystemDirectoryHandle;
  files: FlipFile[];
  tags: Record<string, FlipObservation[]>; // keyed by relPath; `[]` means detagged
  taggerUser?: string;
  /** Optional for legacy records; new local tagging requires preparation. */
  preparedSpecies?: PreparedSpecies;
  /** Non-secret, endpoint-and-login scope. Missing/invalid legacy rows are quarantined. */
  ownerScope?: string;
  /** Monotonic record revision; all supported writes increment it for safe discard checks. */
  revision?: number;
}

class FlipDb extends Dexie {
  records!: Table<FlipRecord, string>;
  preparations!: Table<{ id: string; value: unknown }, string>;
  removalIntents!: Table<{ id: string; value: unknown }, string>;
  vocabularies!: Table<{ id: string; snapshot: PreparedSpecies }, string>;

  constructor() {
    super('sparcd-flip');
    this.version(1).stores({ records: 'id' });
    this.version(2).stores({ records: 'id', vocabularies: 'id' });
    this.version(3).stores({ records: 'id', vocabularies: 'id', preparations: 'id' });
    this.version(4).stores({ records: 'id, ownerScope', vocabularies: 'id', preparations: 'id' });
    this.version(5).stores({ records: 'id, ownerScope', vocabularies: 'id', preparations: 'id', removalIntents: 'id' });
  }
}

export const flipDb = new FlipDb();

export const newFlipId = (): string => crypto.randomUUID();

/**
 * Merge a partial tag map over the stored one. Only the images the partial
 * mentions change, so a debounced per-image save can never clobber tags for
 * images it wasn't carrying. An empty array is a real value — the image was
 * deliberately detagged — not an absence.
 */
export function mergeTags(
  existing: Record<string, FlipObservation[]>,
  partial: Record<string, FlipObservation[]>,
): Record<string, FlipObservation[]> {
  return { ...existing, ...partial };
}

export async function writeFlipRecord(record: FlipRecord): Promise<void> {
  if (!isValidFlipOwnerScope(record.ownerScope)) {
    throw new Error('A valid connected-login owner scope is required before creating a Tagger handoff.');
  }
  await flipDb.transaction('rw', flipDb.records, async () => {
    const existing = await flipDb.records.get(record.id);
    await flipDb.records.put({ ...record, revision: (existing?.revision ?? 0) + 1 });
  });
}

/**
 * Read a record this build understands. A row stamped with a schema version
 * this build has never seen is reported absent rather than half-read: both
 * tools already have an honest "no such batch" state. Version 1 remains
 * readable for explicit legacy preparation; version 2 requires a snapshot.
 */
export async function readFlipRecord(id: string, expectedOwnerScope?: string): Promise<FlipRecord | undefined> {
  return flipDb.transaction('rw', flipDb.records, async () => {
    const rec = await flipDb.records.get(id);
    if (rec?.v !== 1 && rec?.v !== 2) return undefined;
    if (expectedOwnerScope !== undefined && (!isValidFlipOwnerScope(expectedOwnerScope) || rec.ownerScope !== expectedOwnerScope)) return undefined;
    const usedAt = new Date().toISOString();
    const revision = (rec.revision ?? 0) + 1;
    const updated = { ...rec, usedAt, revision };
    await flipDb.records.put(updated);
    return updated;
  });
}

export async function flipRecordUnavailableReason(id: string, expectedOwnerScope?: string): Promise<string> {
  const record = await flipDb.records.get(id);
  if (expectedOwnerScope !== undefined && (!isValidFlipOwnerScope(expectedOwnerScope) || record?.ownerScope !== expectedOwnerScope)) {
    return 'This batch is not available for the connected login. Reopen it from Uploader using the login that started it; saved work has been kept.';
  }
  return record ? 'This batch uses an unsupported app version. Reconnect and reopen a compatible updated app. The stored batch has been kept unchanged.' : 'The local batch is missing. Browser storage may have been cleared; reselect your originals in Uploader.';
}

export async function deleteFlipRecord(id: string, expectedOwnerScope?: string): Promise<boolean> {
  if (expectedOwnerScope === undefined) {
    await flipDb.records.delete(id);
    return true;
  }
  return flipDb.transaction('rw', flipDb.records, async () => {
    const record = await flipDb.records.get(id);
    if (!record || record.ownerScope !== expectedOwnerScope) return false;
    await flipDb.records.delete(id);
    return true;
  });
}

export type FlipRecordSnapshot = { id: string; ownerScope: string; revision: number; fingerprint: string; record: FlipRecord };

async function stableValue(value: unknown): Promise<unknown> {
  if (value === undefined) return { $undefined: true };
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { $blob: [value.type, value.size, Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')] };
  }
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return Promise.all(value.map(stableValue));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof FileSystemHandle !== 'undefined' && value instanceof FileSystemHandle) {
      return { $handle: [record.kind, record.name] };
    }
    return Object.fromEntries(await Promise.all(Object.keys(record).sort().map(async (key) => [key, await stableValue(record[key])] as const)));
  }
  return value;
}

async function flipFingerprint(record: FlipRecord): Promise<string> {
  return JSON.stringify(await stableValue(record));
}

/** Read only this login's records without bumping usedAt or changing retention. */
export async function snapshotOwnedFlipRecords(ownerScope: string): Promise<FlipRecordSnapshot[]> {
  if (!isValidFlipOwnerScope(ownerScope)) return [];
  const records = await flipDb.records.where('ownerScope').equals(ownerScope).toArray();
  return Promise.all(records
    // An unsupported version can still contain recoverable work. Ownership
    // and the complete snapshot are enough to offer an explicit decision;
    // do not silently omit it from Disconnect review.
    .filter((record) => isValidFlipOwnerScope(record.ownerScope))
    .map(async (record) => ({
      id: record.id,
      ownerScope,
      revision: record.revision ?? 0,
      fingerprint: await flipFingerprint(record),
      record: structuredClone(record),
    })));
}

async function sameDirectoryEntry(a: FileSystemDirectoryHandle | undefined, b: FileSystemDirectoryHandle | undefined): Promise<boolean> {
  if (!a || !b) return a === b;
  if (typeof a.isSameEntry !== 'function') return false;
  try { return await a.isSameEntry(b); } catch { return false; }
}

/**
 * Atomically delete only the unchanged owner-scoped rows the user confirmed.
 * Changed/new rows survive and are returned for an updated confirmation.
 */
export async function discardOwnedFlipSnapshot(
  ownerScope: string,
  snapshot: FlipRecordSnapshot[],
): Promise<{ deleted: number; retainedChanged: number }> {
  if (!isValidFlipOwnerScope(ownerScope)) return { deleted: 0, retainedChanged: 0 };
  let deleted = 0;
  let retainedChanged = 0;
  await flipDb.transaction('rw', flipDb.records, async () => {
    for (const item of snapshot) {
      if (item.ownerScope !== ownerScope) continue;
      const current = await flipDb.records.get(item.id);
      if (!current || current.ownerScope !== ownerScope) continue;
      // Keep the read, complete-content comparison, and delete in one
      // IndexedDB read-write transaction so another tab cannot change a row
      // between confirmation validation and deletion.
      const fingerprint = await Dexie.waitFor(flipFingerprint(current));
      const sameHandle = await Dexie.waitFor(sameDirectoryEntry(current.dirHandle, item.record.dirHandle));
      if ((current.revision ?? 0) !== item.revision || fingerprint !== item.fingerprint || !sameHandle) { retainedChanged++; continue; }
      await flipDb.records.delete(item.id);
      deleted++;
    }
  });
  return { deleted, retainedChanged };
}

/** Legacy v1 retention only. Prepared v2 work is never expired implicitly. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drop hand-offs nobody came back for. A record holds file paths, content
 * hashes, thumbnails and sometimes a live folder handle; the uploader deletes
 * one the moment its batch publishes, so what this sweeps up is the batches
 * that were started and abandoned. Without it the store only ever grows.
 *
 * Aged from last use, not creation: a batch tagged over three weeks and then
 * carried for two more until there is a connection is not abandoned, and its
 * tags exist nowhere else until it uploads.
 *
 * A full scan, because neither timestamp is indexed — the store holds one row
 * per hand-off a person has personally started, so there is nothing here worth
 * an index for.
 */
export async function pruneFlipRecords(now = Date.now()): Promise<number> {
  const cutoff = now - MAX_AGE_MS;
  return flipDb.records.filter((record) => {
    if (record.v !== 1) return false;
    const timestamp = Date.parse(record.usedAt ?? record.createdAt);
    return Number.isFinite(timestamp) && timestamp < cutoff;
  }).delete();
}

// Sweep on first import, in both tools. Nothing waits on it and nothing depends
// on it having finished — an old record costs space, never correctness — so a
// failure here must not stop a batch from opening.
void pruneFlipRecords().catch(() => {});

/**
 * Merge tags for some images into the record. Runs inside a read-write
 * transaction so a debounced save and a whole-record write never interleave
 * into a lost update.
 */
export async function updateFlipTags(
  id: string,
  partial: Record<string, FlipObservation[]>,
  expectedOwnerScope?: string,
): Promise<void> {
  await flipDb.transaction('rw', flipDb.records, async () => {
    const rec = await flipDb.records.get(id);
    if (!rec) throw new Error('This local batch is no longer stored. Keep this tab open and retry after checking browser storage.');
    if (expectedOwnerScope !== undefined && rec.ownerScope !== expectedOwnerScope) throw new Error('This local batch is not available for the connected login. Its saved work has been kept.');
    await flipDb.records.put({ ...rec, tags: mergeTags(rec.tags, partial), usedAt: new Date().toISOString(), revision: (rec.revision ?? 0) + 1 });
  });
}

/** The tagger's final hand-back: merge the last tags, record who tagged. */
export async function finishFlipRecord(
  id: string,
  tags: Record<string, FlipObservation[]>,
  taggerUser: string,
  expectedOwnerScope?: string,
): Promise<void> {
  await flipDb.transaction('rw', flipDb.records, async () => {
    const rec = await flipDb.records.get(id);
    if (!rec) throw new Error('This local batch is no longer stored. Keep this tab open and retry after checking browser storage.');
    if (expectedOwnerScope !== undefined && rec.ownerScope !== expectedOwnerScope) throw new Error('This local batch is not available for the connected login. Its saved work has been kept.');
    await flipDb.records.put({ ...rec, tags: mergeTags(rec.tags, tags), taggerUser, usedAt: new Date().toISOString(), revision: (rec.revision ?? 0) + 1 });
  });
}


/** Store only the explicit non-secret snapshot shape, never a connection config. */
export async function savePreparedSpecies(snapshot: PreparedSpecies): Promise<void> {
  if (!validPreparedSpecies(snapshot)) throw new Error('Species preparation is invalid or empty. Prepare it online again.');
  await flipDb.vocabularies.put({ id: 'selected', snapshot: copyPreparedSpecies(snapshot) });
}

export async function loadPreparedSpecies(scope?: FlipOwnerConnection): Promise<PreparedSpecies | null> {
  const value = (await flipDb.vocabularies.get('selected'))?.snapshot;
  if (!validPreparedSpecies(value)) return null;
  if (scope && value.ownerScope !== await deriveFlipOwnerScope(scope)) return null;
  return value;
}

/** A legacy handoff may be prepared explicitly; existing snapshots never change. */
export async function bindPreparedSpecies(id: string, snapshot: PreparedSpecies, expectedOwnerScope?: string): Promise<void> {
  if (!validPreparedSpecies(snapshot)) throw new Error('Prepare species online before tagging.');
  await flipDb.transaction('rw', flipDb.records, async () => {
    const record = await flipDb.records.get(id);
    if (!record) throw new Error('This local batch is no longer available.');
    if (expectedOwnerScope !== undefined && record.ownerScope !== expectedOwnerScope) throw new Error('This local batch is not available for the connected login. Its saved work has been kept.');
    if (validPreparedSpecies(record.preparedSpecies)) throw new Error('This batch already has its own prepared species list.');
    await flipDb.records.update(id, { v: 2, preparedSpecies: copyPreparedSpecies(snapshot), revision: (record.revision ?? 0) + 1 });
  });
}

/** Bounded-memory verification for originals reopened after a browser restart. */
export async function hashOriginal(blob: Blob): Promise<string> {
  const { createSHA256 } = await import('hash-wasm');
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) hasher.update(new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer()));
  return hasher.digest('hex');
}
