import { useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from '../store';
import { useLocalBatch } from '../lib/localBatch';
import { useSpecies } from '../lib/queries';
import { DEFAULT_SPECIES } from '../lib/defaultSpecies';
import {
  activeKeyProfile,
  keyProfileId,
  useKeyBindings,
  type SpeciesKeyConfig,
} from '../lib/keys';
import { SpeciesChangedModal } from './SpeciesChangedModal';

function keyConfig(
  species: readonly {
    scientificName: string;
    commonName: string;
    keyBinding: string | null;
  }[],
): SpeciesKeyConfig[] {
  return species.map(({ scientificName, commonName, keyBinding }) => ({
    scientificName,
    commonName,
    keyBinding,
  }));
}

/** Activates the user's keybinding profile and reconciles vocabulary changes
 * as soon as the app has a species list, before the user enters Tag. Lists are
 * reconciled per source file: a collection's own list seen for the first time
 * is accepted silently, and only a change to a list already seen is reported. */
export function SpeciesKeyBindingGate({ children }: { children: ReactNode }) {
  const cfg = useStore((state) => state.s3Config);
  const connectionId = useStore((state) => state.connectionId);
  const collectionKey = useStore((state) => state.selectedCollectionKey);
  const localRecord = useLocalBatch((state) => (state.status === 'ready' ? state.record : null));
  const species = useSpecies(cfg, connectionId, collectionKey);
  const activeProfileId = useKeyBindings((state) => state.activeProfileId);
  const activateProfile = useKeyBindings((state) => state.activateProfile);
  const stageSpecies = useKeyBindings((state) => state.stageSpecies);
  const acknowledgeSpeciesChange = useKeyBindings(
    (state) => state.acknowledgeSpeciesChange,
  );

  const profileId = cfg
    ? keyProfileId(cfg.endpoint, cfg.accessKey)
    : localRecord
      ? keyProfileId('local-batch', localRecord.taggerUser || 'anonymous')
      : null;
  const current = useMemo(
    () =>
      cfg
        ? species.data
          ? {
              source: `${species.data.sourceBucket}/${species.data.sourceKey}`,
              shared: species.data.settingsBucket !== null,
              species: keyConfig(species.data.species),
            }
          : null
        : localRecord
          ? { source: 'local-batch', shared: true, species: keyConfig(DEFAULT_SPECIES) }
          : null,
    [cfg, localRecord, species.data],
  );
  const source = current?.source;
  const pending = useKeyBindings((state) =>
    state.activeProfileId === profileId && source
      ? activeKeyProfile(state).speciesSources?.[source]?.pendingSpeciesChange
      : undefined,
  );

  useEffect(() => {
    if (profileId) activateProfile(profileId);
  }, [activateProfile, profileId]);

  useEffect(() => {
    if (profileId === activeProfileId && current) {
      stageSpecies(current.source, current.species, current.shared);
    }
  }, [activeProfileId, current, profileId, stageSpecies]);

  return (
    <>
      {children}
      {pending && source && (
        <SpeciesChangedModal
          added={pending.diff.added.map((entry) => entry.commonName)}
          removed={pending.diff.removed.map((entry) => entry.commonName)}
          modified={pending.diff.modified.map((entry) => entry.after.commonName)}
          onAcknowledge={() => acknowledgeSpeciesChange(source)}
        />
      )}
    </>
  );
}
