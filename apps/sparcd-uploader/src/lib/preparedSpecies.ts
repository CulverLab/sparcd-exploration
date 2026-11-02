import { loadSpeciesVocabulary, type CollectionRef, type SpeciesResult } from '@sparcd/s3-safe';
import { keyProfileId, useKeyBindings, activeKeyProfile } from '@sparcd/auth-ui';
import { validPreparedSpecies, type PreparedSpecies } from '@sparcd/flip';
import type { S3Config } from '@sparcd/types';
import { getClient } from './s3';

export async function fetchPreparation(cfg: S3Config, collection: CollectionRef): Promise<SpeciesResult> {
  const result = await loadSpeciesVocabulary(getClient(cfg), collection.key);
  if (!result.species.length || result.skipped.length) {
    throw new Error('The species list is empty or contains invalid entries. Ask an administrator to correct it, then prepare again online.');
  }
  return result;
}

/** Use the same source-aware reconciliation and local key overrides as Tagger. */
export function stagePreparation(cfg: S3Config, result: SpeciesResult): string {
  const profile = keyProfileId(cfg.endpoint, cfg.accessKey);
  const bindings = useKeyBindings.getState();
  bindings.activateProfile(profile);
  useKeyBindings.getState().stageSpecies(`${result.sourceBucket}/${result.sourceKey}`, result.species, result.settingsBucket !== null);
  return profile;
}

/** Re-activate a saved vocabulary's source-aware local key reconciliation offline. */
export function stageSavedPreparation(snapshot: PreparedSpecies): void {
  if (!validPreparedSpecies(snapshot)) throw new Error('The saved species list is invalid.');
  const bindings = useKeyBindings.getState();
  bindings.activateProfile(snapshot.profileId);
  useKeyBindings.getState().stageSpecies(
    `${snapshot.sourceBucket}/${snapshot.sourceKey}`,
    snapshot.species,
    snapshot.sourceKey === 'Settings/species.json',
  );
  const profile = activeKeyProfile(useKeyBindings.getState());
  if (profile.speciesSources?.[`${snapshot.sourceBucket}/${snapshot.sourceKey}`]?.pendingSpeciesChange) {
    throw new Error('Review and accept the species-list changes before using this saved list.');
  }
}

export async function snapshotPreparation(cfg: S3Config, collection: CollectionRef, result: SpeciesResult): Promise<PreparedSpecies> {
  const profileId = stagePreparation(cfg, result);
  const profile = activeKeyProfile(useKeyBindings.getState());
  if (profile.speciesSources?.[`${result.sourceBucket}/${result.sourceKey}`]?.pendingSpeciesChange) {
    throw new Error('Review and accept the species-list changes before preparing.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(speciesFingerprint(result.species)));
  const snapshot: PreparedSpecies = {
    v: 1, endpoint: cfg.endpoint, account: cfg.accessKey,
    collectionKey: collection.key, collectionName: collection.name || collection.uuid,
    sourceBucket: result.sourceBucket, sourceKey: result.sourceKey,
    sourceHash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    preparedAt: new Date().toISOString(), profileId,
    overrides: { ...profile.overrides }, species: structuredClone(result.species),
  };
  if (!validPreparedSpecies(snapshot)) throw new Error('Species preparation could not be validated.');
  return snapshot;
}

export function assertPreparedSpecies(snapshot: unknown): asserts snapshot is PreparedSpecies {
  if (!validPreparedSpecies(snapshot)) throw new Error('The species list is not available on this device. Connect online to download the Settings species list, then try tagging again. Your files are unchanged.');
}

/** Field and row ordering are not vocabulary changes. Include every displayed field. */
export function speciesFingerprint(species: PreparedSpecies['species']): string {
  return JSON.stringify([...species].sort((a, b) => a.scientificName.localeCompare(b.scientificName)).map((s) => [s.scientificName, s.commonName, s.iconUrl, s.keyBinding]));
}
