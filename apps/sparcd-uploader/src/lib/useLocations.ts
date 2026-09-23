import { useQuery } from '@tanstack/react-query';
import type { S3Config } from '@sparcd/types';
import { fetchLocations, type LocationsResult } from './s3';
import { readDiscovery, writeDiscovery } from './discoveryCache';

/**
 * Load + cache the selected collection's camera-location registry, falling
 * back to the connected endpoint's settings registry when it is absent or
 * empty.
 * Keyed on the endpoint so a reconnect to a different backend refetches,
 * but section switches and Assign revisits hit the cache. Locations change
 * rarely, so a long stale time avoids redundant reads.
 *
 * Collection files are read live. Only the settings bucket is remembered for
 * fallback reads, which turns a store-wide probe into one HEAD.
 */
export function useLocations(cfg: S3Config | null, connectionId: number, collectionKey: string | null = null) {
  return useQuery<LocationsResult>({
    queryKey: ['locations', connectionId, cfg?.endpoint, collectionKey],
    queryFn: async () => {
      const result = await fetchLocations(cfg!, readDiscovery(cfg!)?.settingsBucket, collectionKey);
      if (result.settingsBucket) writeDiscovery(cfg!, { settingsBucket: result.settingsBucket });
      return result;
    },
    enabled: !!cfg,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
