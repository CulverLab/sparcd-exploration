import { create } from 'zustand';
import {
  KEYBINDING_STORAGE_KEY,
  emptyRevisionedProfile,
  keyProfileId,
  mergeAndWriteRevisionedProfiles,
  mergeRevisionedProfiles,
  nextKeyProfileRevision,
  readRevisionedProfiles,
  type RevisionedKeyProfile,
  type RevisionedKeyProfiles,
  type SpeciesDiff,
  type SpeciesKeyConfig,
  type SpeciesListState,
} from '@sparcd/auth-ui';

export type KeyOverrides = Record<string, string | null>;
export type KeyProfile = RevisionedKeyProfile;
export type { SpeciesDiff, SpeciesKeyConfig };
export { keyProfileId };

type KeyBindingState = {
  profiles: RevisionedKeyProfiles;
  /** The last write to localStorage failed, so changes live only in this tab. */
  unsaved: boolean;
  activeProfileId: string | null;
  activateProfile: (profileId: string) => void;
  assignKey: (
    scientificName: string,
    key: string,
    displacedScientificNames?: string[],
  ) => void;
  clearKey: (scientificName: string) => void;
  /** `source` names the file the list came from; `shared` marks the settings
   * list, which inherits the snapshot stored before lists were kept per source. */
  stageSpecies: (source: string, current: SpeciesKeyConfig[], shared?: boolean) => void;
  acknowledgeSpeciesChange: (source: string) => void;
};

const LEGACY_PROFILE = '__legacy__';

export function normalizeJavaKeyCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  if ([...trimmed].length === 1) return trimmed.toLocaleLowerCase();
  const upper = trimmed.toUpperCase();
  const digit = /^(?:DIGIT|NUMPAD)([0-9])$/.exec(upper);
  if (digit) return digit[1];
  const symbols: Record<string, string> = {
    BACK_QUOTE: '`',
    COMMA: ',',
    PERIOD: '.',
    SLASH: '/',
    SEMICOLON: ';',
    QUOTE: "'",
    OPEN_BRACKET: '[',
    CLOSE_BRACKET: ']',
    BACK_SLASH: '\\',
    MINUS: '-',
    EQUALS: '=',
  };
  return symbols[upper] ?? null;
}

export function normalizeEventKey(key: string): string | null {
  return [...key].length === 1 && !/^\s$/u.test(key) ? key.toLocaleLowerCase() : null;
}

export function normalizeBindableEventKey(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): string | null {
  return event.altKey || event.ctrlKey || event.metaKey ? null : normalizeEventKey(event.key);
}

export function effectiveKey(
  scientificName: string,
  jsonKeyBinding: string | null,
  overrides: KeyOverrides | Record<string, string>,
): string | null {
  let resolved: string | null;
  if (Object.prototype.hasOwnProperty.call(overrides, scientificName)) {
    const override = overrides[scientificName];
    resolved = override === '' ? null : override;
  } else {
    resolved = normalizeJavaKeyCode(jsonKeyBinding);
  }
  return resolved && !/^\d$/.test(resolved) ? resolved : null;
}

function ownersByKey<T extends SpeciesKeyConfig>(
  species: readonly T[],
  overrides: KeyOverrides,
): Map<string, T[]> {
  const owners = new Map<string, T[]>();
  for (const candidate of species) {
    const key = effectiveKey(candidate.scientificName, candidate.keyBinding, overrides);
    if (!key) continue;
    const held = owners.get(key);
    if (held) held.push(candidate);
    else owners.set(key, [candidate]);
  }
  return owners;
}

export function conflictingKeyOwners(
  species: readonly SpeciesKeyConfig[],
  targetScientificName: string,
  key: string,
  overrides: KeyOverrides,
): string[] {
  return (ownersByKey(species, overrides).get(key) ?? [])
    .filter((candidate) => candidate.scientificName !== targetScientificName)
    .map((candidate) => candidate.scientificName);
}

export type ResolvedKeys<T> = {
  /** Keys owned by exactly one species — the only ones that act. */
  byKey: Map<string, T>;
  /** Keys claimed by two or more species; nobody gets them until one gives way. */
  shared: Map<string, T[]>;
};

/**
 * A key a second species also claims belongs to neither. A server default and a
 * local override collide on equal terms: silently letting one win is how a
 * volunteer ends up tagging the wrong animal.
 */
export function resolveSpeciesKeys<T extends SpeciesKeyConfig>(
  species: readonly T[],
  overrides: KeyOverrides,
): ResolvedKeys<T> {
  const byKey = new Map<string, T>();
  const shared = new Map<string, T[]>();
  for (const [key, owners] of ownersByKey(species, overrides)) {
    if (owners.length > 1) shared.set(key, owners);
    else byKey.set(key, owners[0]);
  }
  return { byKey, shared };
}

export function diffSpecies(
  accepted: readonly SpeciesKeyConfig[],
  current: readonly SpeciesKeyConfig[],
): SpeciesDiff {
  const before = new Map(accepted.map((species) => [species.scientificName, species]));
  const after = new Map(current.map((species) => [species.scientificName, species]));
  return {
    added: current.filter((species) => !before.has(species.scientificName)),
    removed: accepted.filter((species) => !after.has(species.scientificName)),
    modified: current.flatMap((species) => {
      const prior = before.get(species.scientificName);
      return prior &&
        (prior.commonName !== species.commonName || prior.keyBinding !== species.keyBinding)
        ? [{ before: prior, after: species }]
        : [];
    }),
  };
}

function normalizedSpecies(species: readonly SpeciesKeyConfig[]): SpeciesKeyConfig[] {
  return species
    .map(({ scientificName, commonName, keyBinding }) => ({
      scientificName,
      commonName,
      keyBinding,
    }))
    .sort((a, b) => a.scientificName.localeCompare(b.scientificName));
}

function hasDiff(diff: SpeciesDiff): boolean {
  return !!(diff.added.length || diff.removed.length || diff.modified.length);
}

function storedProfiles(): RevisionedKeyProfiles {
  return typeof localStorage === 'undefined' ? {} : readRevisionedProfiles(localStorage);
}

function latestProfiles(local: RevisionedKeyProfiles): RevisionedKeyProfiles {
  return mergeRevisionedProfiles(local, storedProfiles());
}

function commitProfiles(
  profiles: RevisionedKeyProfiles,
): Pick<KeyBindingState, 'profiles' | 'unsaved'> {
  if (typeof localStorage === 'undefined') return { profiles, unsaved: false };
  const { profiles: merged, saved } = mergeAndWriteRevisionedProfiles(localStorage, profiles);
  return { profiles: merged, unsaved: !saved };
}

function updateActiveProfile(
  state: KeyBindingState,
  update: (profile: RevisionedKeyProfile) => RevisionedKeyProfile,
): Partial<KeyBindingState> {
  if (!state.activeProfileId) return {};
  const profiles = latestProfiles(state.profiles);
  const profile = profiles[state.activeProfileId] ?? emptyRevisionedProfile();
  return commitProfiles({ ...profiles, [state.activeProfileId]: update(profile) });
}

function legacyList({
  acceptedSpecies,
  acceptedRevision,
  pendingSpeciesChange,
  pendingRevision,
}: RevisionedKeyProfile): SpeciesListState {
  return { acceptedSpecies, acceptedRevision, pendingSpeciesChange, pendingRevision };
}

function isMostRecent(profile: RevisionedKeyProfile, source: string): boolean {
  const lists = Object.entries(profile.speciesSources ?? {});
  const usedAt = profile.speciesSources?.[source]?.usedAt ?? 0;
  return lists.every(([other, list]) => other === source || (list.usedAt ?? 0) < usedAt);
}

function nextUsedAt(profile: RevisionedKeyProfile): number {
  const lists = Object.values(profile.speciesSources ?? {});
  return Math.max(Date.now(), ...lists.map((list) => (list.usedAt ?? 0) + 1));
}

function withSource(
  profile: RevisionedKeyProfile,
  source: string,
  list: SpeciesListState,
): RevisionedKeyProfile {
  return { ...profile, speciesSources: { ...profile.speciesSources, [source]: list } };
}

export const useKeyBindings = create<KeyBindingState>()((set) => ({
  profiles: storedProfiles(),
  unsaved: false,
  activeProfileId: null,
  activateProfile: (profileId) =>
    set((state) => {
      if (state.activeProfileId === profileId) return state;
      const profiles = latestProfiles(state.profiles);
      if (profiles[profileId]) return { profiles, activeProfileId: profileId };
      const legacy = Object.keys(profiles).some((id) => id !== LEGACY_PROFILE)
        ? undefined
        : profiles[LEGACY_PROFILE];
      return {
        ...commitProfiles({ ...profiles, [profileId]: legacy ?? emptyRevisionedProfile() }),
        activeProfileId: profileId,
      };
    }),
  assignKey: (scientificName, key, displacedScientificNames = []) =>
    set((state) =>
      updateActiveProfile(state, (profile) => {
        const overrides = { ...profile.overrides };
        const overrideRevisions = { ...profile.overrideRevisions };
        for (const displaced of displacedScientificNames) {
          if (displaced === scientificName) continue;
          overrides[displaced] = null;
          overrideRevisions[displaced] = nextKeyProfileRevision(
            profile.overrideRevisions[displaced],
          );
        }
        overrides[scientificName] = key;
        overrideRevisions[scientificName] = nextKeyProfileRevision(
          profile.overrideRevisions[scientificName],
        );
        return { ...profile, overrides, overrideRevisions };
      }),
    ),
  clearKey: (scientificName) =>
    set((state) =>
      updateActiveProfile(state, (profile) => ({
        ...profile,
        overrides: { ...profile.overrides, [scientificName]: null },
        overrideRevisions: {
          ...profile.overrideRevisions,
          [scientificName]: nextKeyProfileRevision(profile.overrideRevisions[scientificName]),
        },
      })),
    ),
  stageSpecies: (source, current, shared = false) =>
    set((state) =>
      updateActiveProfile(state, (profile) => {
        const known = profile.speciesSources?.[source];
        // Recency is written only on a switch, so a refetch of the open list stays a no-op.
        const latest = !!known && isMostRecent(profile, source);
        const list = {
          ...(known ?? (shared ? legacyList(profile) : {})),
          usedAt: latest ? known.usedAt : nextUsedAt(profile),
        };
        const next = normalizedSpecies(current);
        if (!list.acceptedSpecies) {
          return withSource(profile, source, {
            usedAt: list.usedAt,
            acceptedSpecies: next,
            acceptedRevision: nextKeyProfileRevision(list.acceptedRevision),
          });
        }
        if (
          list.pendingSpeciesChange &&
          JSON.stringify(list.pendingSpeciesChange.next) === JSON.stringify(next)
        ) {
          return latest ? profile : withSource(profile, source, list);
        }
        const diff = diffSpecies(list.acceptedSpecies, next);
        if (!hasDiff(diff) && !list.pendingSpeciesChange) {
          return latest ? profile : withSource(profile, source, list);
        }
        return withSource(profile, source, {
          ...list,
          pendingSpeciesChange: hasDiff(diff) ? { next, diff } : undefined,
          pendingRevision: nextKeyProfileRevision(list.pendingRevision),
        });
      }),
    ),
  acknowledgeSpeciesChange: (source) =>
    set((state) =>
      updateActiveProfile(state, (profile) => {
        const list = profile.speciesSources?.[source];
        const pending = list?.pendingSpeciesChange;
        if (!pending) return profile;
        return withSource(profile, source, {
          usedAt: list.usedAt,
          acceptedSpecies: pending.next,
          acceptedRevision: nextKeyProfileRevision(list.acceptedRevision),
          pendingSpeciesChange: undefined,
          pendingRevision: nextKeyProfileRevision(list.pendingRevision),
        });
      }),
    ),
}));

export function activeKeyProfile(state: KeyBindingState): KeyProfile {
  return state.activeProfileId
    ? state.profiles[state.activeProfileId] ?? emptyRevisionedProfile()
    : emptyRevisionedProfile();
}

export function rehydrateKeyBindings(): void {
  useKeyBindings.setState((state) =>
    commitProfiles(mergeRevisionedProfiles(state.profiles, storedProfiles())),
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEYBINDING_STORAGE_KEY) rehydrateKeyBindings();
  });
}
