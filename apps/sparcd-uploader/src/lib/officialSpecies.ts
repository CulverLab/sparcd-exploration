import { loadSpeciesVocabulary, type SafeS3Client } from '@sparcd/s3-safe';
import { parseObservations, requestedSpeciesFromComments } from '@sparcd/camtrap';
import type { LoadedSession } from './db';

export type SpeciesIdentification = { scientificName: string; requestedSpecies?: string };
export class OfficialSpeciesError extends Error {}

/** #621 tracks collection-versus-master policy; use the current destination lookup. */
export async function missingOfficialSpecies(client: SafeS3Client, collectionKey: string, tags: SpeciesIdentification[]): Promise<string[]> {
  if (!tags.length) return [];
  const loaded = await loadSpeciesVocabulary(client, collectionKey);
  if (!loaded.species.length || loaded.skipped.length) throw new Error('The official species list is empty or invalid.');
  const allowed = new Set(loaded.species.map(species => species.scientificName));
  return [...new Set(tags.filter(tag => !allowed.has(tag.scientificName)).map(tag => tag.requestedSpecies || tag.scientificName || 'Unnamed species'))];
}

/** Validate the CSV that will actually publish, including legacy sessions without preTags. */
export async function checkResumedSpecies(client: SafeS3Client, session: LoadedSession): Promise<void> {
  if (!session.bundle) return;
  const tags = parseObservations(session.bundle.observationsCsv)
    .filter(row => row.scientificName.trim() || row.observationType === 'animal' || requestedSpeciesFromComments(row.tags))
    .map(row => ({ scientificName: row.scientificName, requestedSpecies: requestedSpeciesFromComments(row.tags) ?? undefined }));
  let missing: string[];
  try {
    missing = await missingOfficialSpecies(client, `${session.batch.targetBucket}::${session.batch.collectionUuid}`, tags);
  } catch {
    throw new OfficialSpeciesError('The current species list could not be checked. Reconnect and retry this saved upload. Your tags and counts are unchanged.');
  }
  if (missing.length) throw new OfficialSpeciesError(
    `Resolve these species before uploading because they are not in the current official collection or master list: ${missing.join(', ')}. ` +
    'Your saved upload, tags and counts have been kept. Start a new upload with corrected identifications, or retry after the official list has been corrected.',
  );
}
