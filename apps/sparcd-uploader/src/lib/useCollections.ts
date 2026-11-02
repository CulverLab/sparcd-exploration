import { useQuery } from '@tanstack/react-query';
import type { S3Config } from '@sparcd/types';
import {
  listCollections,
  listCollectionDeploymentLocationIds,
  listPublishedUploads,
  type CollectionRef,
  type PublishedUpload,
} from './s3';
import { readDiscovery, writeDiscovery } from './discoveryCache';

/**
 * List the collection buckets for the connected endpoint (cached per endpoint).
 * Each ref already carries its human-readable name, so no separate name fetch
 * is needed.
 *
 * The picker renders from the previous connect's answer straight away. Marking
 * that seed as stale (`initialDataUpdatedAt: 1`) is what makes the fresh probe
 * run in the background on every connect rather than at the staleTime the
 * in-session cache uses; once it lands, normal staleTime takes over.
 */
export function useCollections(cfg: S3Config | null, connectionId: number, enabled = true) {
  const remembered = cfg ? readDiscovery(cfg)?.collections : undefined;
  return useQuery<CollectionRef[]>({
    queryKey: ['collections', connectionId, cfg?.endpoint],
    queryFn: async () => {
      const refs = await listCollections(cfg!);
      writeDiscovery(cfg!, { collections: refs });
      return refs;
    },
    enabled: !!cfg && enabled,
    initialData: remembered,
    initialDataUpdatedAt: remembered ? 1 : undefined,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * The location ids the selected collection has already deployed — the set the
 * deployment picker is filtered to. Cached per collection so re-selecting a
 * collection is instant.
 */
export function useCollectionDeployments(
  cfg: S3Config | null,
  connectionId: number,
  collection: CollectionRef | null,
) {
  return useQuery<string[]>({
    queryKey: ['collectionDeployments', connectionId, collection?.key],
    queryFn: () => listCollectionDeploymentLocationIds(cfg!, collection!),
    enabled: !!cfg && !!collection,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * The published uploads of the selected collection — each upload's
 * `UploadMeta.json` + current deployment_id — for the edit-after-publish
 * management surface. Kept short-lived so an applied edit refetch shows fresh
 * descriptions/deployments.
 */
export function usePublishedUploads(
  cfg: S3Config | null,
  connectionId: number,
  collection: CollectionRef | null,
) {
  return useQuery<PublishedUpload[]>({
    queryKey: ['publishedUploads', connectionId, collection?.key],
    queryFn: () => listPublishedUploads(cfg!, collection!),
    enabled: !!cfg && !!collection,
    staleTime: 30 * 1000,
    retry: 1,
  });
}
