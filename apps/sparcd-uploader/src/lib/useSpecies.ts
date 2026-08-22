import { useQuery } from '@tanstack/react-query';
import type { S3Config } from '@sparcd/types';
import { fetchSpecies, type SpeciesResult } from './species';

/** Species vocabulary, loaded once per connection from the settings bucket. */
export function useSpecies(cfg: S3Config | null, connectionId: number) {
  return useQuery<SpeciesResult>({
    queryKey: ['species', connectionId, cfg?.endpoint],
    queryFn: () => fetchSpecies(cfg!),
    enabled: !!cfg,
    staleTime: Infinity,
    retry: 1,
  });
}
