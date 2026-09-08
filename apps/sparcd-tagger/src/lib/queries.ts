// TanStack Query wrappers. Every key is scoped by `connectionId` (not raw
// credentials), and the client cache is cleared on connect/disconnect, so
// reconnecting with new credentials never serves a previous connection's data.

import { useQuery, useQueries } from '@tanstack/react-query';
import type { S3Config } from '@sparcd/types';
import {
  listCollections,
  listUploads,
  listUploadImages,
  listCollectionSnapshots,
  listSnapshots,
  loadCanonicalState,
  loadUploadSummary,
  parseCollectionKey,
  type CollectionRef,
  type UploadRef,
  type UploadImage,
  type UploadSnapshots,
  type UploadSummary,
  type SnapshotRef,
} from './s3';
import { fetchSpecies, type SpeciesResult } from './species';
import { buildTagImages, type TagImage } from './workspace';
import {
  groundUpload,
  getUpload,
  hasDirtyDraftsForUpload,
  uploadDraftStates,
  uploadId,
  type UploadDraftState,
} from './db';
import { useDraftStore, dirtyCount } from './drafts';

export function useCollections(cfg: S3Config | null, connectionId: number) {
  return useQuery<CollectionRef[]>({
    queryKey: ['collections', connectionId, cfg?.endpoint],
    queryFn: () => listCollections(cfg!),
    enabled: !!cfg,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useUploads(cfg: S3Config | null, connectionId: number, collectionKey: string | null) {
  return useQuery<UploadRef[]>({
    queryKey: ['uploads', connectionId, collectionKey],
    queryFn: () => {
      const { bucket, uuid } = parseCollectionKey(collectionKey!);
      return listUploads(cfg!, bucket, uuid);
    },
    enabled: !!cfg && !!collectionKey,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Per-upload Browse summaries (image tally + deployment label), one query per
 * upload so each row carries its own loading/error state and they fetch in
 * parallel. Returns the `UseQueryResult[]` aligned to `uploads` order; the caller
 * reads `[i]` alongside `uploads[i]`. `UploadSummary` includes the type re-export
 * so callers don't reach into `./s3`. */
export type { UploadSummary, UploadDraftState };

export function useUploadSummaries(
  cfg: S3Config | null,
  connectionId: number,
  collectionKey: string | null,
  uploads: UploadRef[] | undefined,
) {
  return useQueries({
    queries: (uploads ?? []).map((u) => ({
      queryKey: ['uploadSummary', connectionId, collectionKey, u.prefix],
      queryFn: () => {
        const { bucket } = parseCollectionKey(collectionKey!);
        return loadUploadSummary(cfg!, bucket, u.prefix);
      },
      enabled: !!cfg && !!collectionKey,
      staleTime: 60 * 1000,
      retry: 1,
    })),
  });
}

/** Local edit state per upload (drives the Sync column). Cheap IndexedDB scan;
 *  short stale time so returning from a tagging session refreshes the pills. */
export function useUploadDraftStates(connectionId: number, collectionKey: string | null) {
  return useQuery<Map<string, UploadDraftState>>({
    queryKey: ['uploadDraftStates', connectionId, collectionKey],
    queryFn: () => uploadDraftStates(parseCollectionKey(collectionKey!).bucket),
    enabled: !!collectionKey,
    staleTime: 5 * 1000,
  });
}

export function useUploadImages(
  cfg: S3Config | null,
  connectionId: number,
  collectionKey: string | null,
  uploadPrefix: string | null,
) {
  return useQuery<UploadImage[]>({
    queryKey: ['uploadImages', connectionId, collectionKey, uploadPrefix],
    queryFn: () => {
      const { bucket } = parseCollectionKey(collectionKey!);
      return listUploadImages(cfg!, bucket, uploadPrefix!);
    },
    enabled: !!cfg && !!collectionKey && !!uploadPrefix,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/** The canonical base for the Tag workspace: `media.csv` joined with existing
 *  `observations.csv` into per-image state. Loading also grounds the upload —
 *  it records the canonical ETags/hashes the sync path writes against, so the
 *  on-screen base and the sync ground never drift apart. */
export function useTagImages(
  cfg: S3Config | null,
  connectionId: number,
  collectionKey: string | null,
  uploadPrefix: string | null,
) {
  return useQuery<TagImage[]>({
    queryKey: ['tagImages', connectionId, collectionKey, uploadPrefix],
    queryFn: async () => {
      const { bucket } = parseCollectionKey(collectionKey!);
      const state = await loadCanonicalState(cfg!, bucket, uploadPrefix!);
      // Pin the conflict base to the session: only (re-)ground when the upload
      // has no base yet or no unsaved edits. Once edits exist the base is frozen,
      // so a background refetch can't silently absorb a remote change — drift
      // surfaces as a conflict at sync. Post-sync/restore re-grounding is
      // explicit (in syncRunner) and bypasses this.
      const existing = await getUpload(bucket, uploadPrefix!);
      // Draft writes are debounced, so Dexie can lag a live edit by up to the
      // debounce window. Consult the in-memory store synchronously too — an
      // optimistic edit already flips its record dirty there — so a refetch that
      // resolves inside that window can't re-ground the base under active edits.
      const store = useDraftStore.getState();
      const memDirty =
        store.loadedKey === uploadId(bucket, uploadPrefix!) && dirtyCount(store.drafts) > 0;
      if (
        !existing?.mediaETag ||
        (!memDirty && !(await hasDirtyDraftsForUpload(bucket, uploadPrefix!)))
      ) {
        await groundUpload(bucket, uploadPrefix!, state);
      }
      return buildTagImages({
        mediaCsv: state.media.text,
        observationsCsv: state.observations.text,
      });
    },
    enabled: !!cfg && !!collectionKey && !!uploadPrefix,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/** Every upload in a collection that has a recoverable snapshot — the History
 *  section's cross-upload recovery browser. Reads only. */
export function useCollectionSnapshots(
  cfg: S3Config | null,
  connectionId: number,
  collectionKey: string | null,
) {
  return useQuery<UploadSnapshots[]>({
    queryKey: ['collectionSnapshots', connectionId, collectionKey],
    queryFn: () => {
      const { bucket, uuid } = parseCollectionKey(collectionKey!);
      return listCollectionSnapshots(cfg!, bucket, uuid);
    },
    enabled: !!cfg && !!collectionKey,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/** Recoverable snapshots for one upload — shared by the Snapshots button's
 *  availability check and the Snapshots dialog itself, so opening the dialog
 *  never re-fetches what the button already loaded. */
export function useUploadSnapshots(
  cfg: S3Config | null,
  connectionId: number,
  collectionKey: string | null,
  uploadPrefix: string | null,
) {
  return useQuery<SnapshotRef[]>({
    queryKey: ['snapshots', connectionId, collectionKey, uploadPrefix],
    queryFn: () => {
      const { bucket } = parseCollectionKey(collectionKey!);
      return listSnapshots(cfg!, bucket, uploadPrefix!);
    },
    enabled: !!cfg && !!collectionKey && !!uploadPrefix,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/** The species vocabulary, loaded once per connection from the settings bucket. */
export function useSpecies(cfg: S3Config | null, connectionId: number) {
  return useQuery<SpeciesResult>({
    queryKey: ['species', connectionId, cfg?.endpoint],
    queryFn: () => fetchSpecies(cfg!),
    enabled: !!cfg,
    staleTime: Infinity, // vocabulary is stable for a session
    retry: 1,
  });
}
