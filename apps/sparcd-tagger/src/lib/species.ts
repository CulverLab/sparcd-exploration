import type { S3Config } from '@sparcd/types';
import { loadSpeciesVocabulary } from '@sparcd/s3-safe';
import { getClient } from './s3';
export { parseSpecies, SpeciesShapeError, SPECIES_KEY } from '@sparcd/s3-safe';
export type { RawSpecies, Species, SkippedSpecies, SpeciesParse, SpeciesResult } from '@sparcd/s3-safe';

export function fetchSpecies(cfg: S3Config, collectionKey?: string | null, client = getClient(cfg)) {
  return loadSpeciesVocabulary(client, collectionKey);
}
