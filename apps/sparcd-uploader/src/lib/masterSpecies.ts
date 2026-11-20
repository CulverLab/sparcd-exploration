import { loadSpeciesVocabulary, SPECIES_KEY } from '@sparcd/s3-safe';
import { deriveFlipOwnerScope, loadPreparedSpecies, savePreparedSpecies, validPreparedSpecies, type PreparedSpecies } from '@sparcd/flip';
import { keyProfileId, useKeyBindings } from '@sparcd/auth-ui';
import type { S3Config } from '@sparcd/types';
import { getClient } from './s3';
import { speciesFingerprint } from './preparedSpecies';

/** Only the Settings master catalog may seed a new batch. Legacy batch snapshots stay intact. */
export async function loadMasterSpecies(cfg?: S3Config): Promise<PreparedSpecies | null> {
  const saved = await loadPreparedSpecies(cfg);
  return validPreparedSpecies(saved) && saved.collectionKey === SPECIES_KEY && saved.sourceKey === SPECIES_KEY ? saved : null;
}

/** Validate before replacing the last good copy. Never persist credentials. */
export async function refreshMasterSpecies(cfg: S3Config, current: () => boolean = () => true): Promise<PreparedSpecies | null> {
  const loaded = await loadSpeciesVocabulary(getClient(cfg));
  if (!loaded.species.length || loaded.skipped.length) throw new Error('The Settings species list is empty or invalid.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(speciesFingerprint(loaded.species)));
  const profileId = keyProfileId(cfg.endpoint, cfg.accessKey);
  const snapshot: PreparedSpecies = {
    v: 2, endpoint: cfg.endpoint, ownerScope: await deriveFlipOwnerScope(cfg), collectionKey: SPECIES_KEY, collectionName: 'Settings master list',
    sourceBucket: loaded.sourceBucket, sourceKey: loaded.sourceKey,
    sourceHash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''),
    preparedAt: new Date().toISOString(), profileId,
    overrides: { ...(useKeyBindings.getState().profiles[profileId]?.overrides ?? {}) }, species: structuredClone(loaded.species),
  };
  if (!validPreparedSpecies(snapshot)) throw new Error('The Settings species list is invalid.');
  if (!current()) return null;
  await savePreparedSpecies(snapshot);
  return current() ? snapshot : null;
}
