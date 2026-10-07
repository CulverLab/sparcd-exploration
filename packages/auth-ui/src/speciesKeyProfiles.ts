/** Version 5 lives under its own key: a tab still running version 4 code drops
 * fields it does not know on write, so sharing a key would let it erase the
 * per-source lists. Version 4 data is read once, as the starting point. */
export const KEYBINDING_STORAGE_KEY = 'sparcd-tagger-keybindings-v5';
const KEYBINDING_STORAGE_VERSION = 5;
const V4_STORAGE_KEY = 'sparcd-tagger-keybindings';
const V4_STORAGE_VERSION = 4;
/** Each remembered source holds a full species list, so keep only the most recently used. */
export const MAX_SPECIES_SOURCES = 20;

export type SpeciesKeyConfig = {
  scientificName: string;
  commonName: string;
  keyBinding: string | null;
};

export type SpeciesDiff = {
  added: SpeciesKeyConfig[];
  removed: SpeciesKeyConfig[];
  modified: { before: SpeciesKeyConfig; after: SpeciesKeyConfig }[];
};

export type PendingSpeciesChange = { next: SpeciesKeyConfig[]; diff: SpeciesDiff };

export type Revision = { at: number; sequence: number; writer: string };

/** What a user has accepted of one species list, and any unacknowledged change to it. */
export type SpeciesListState = {
  /** When this source was last switched to; orders eviction past MAX_SPECIES_SOURCES. */
  usedAt?: number;
  acceptedSpecies?: SpeciesKeyConfig[];
  acceptedRevision?: Revision;
  pendingSpeciesChange?: PendingSpeciesChange;
  pendingRevision?: Revision;
};

/** Overrides belong to the user; accepted lists belong to the file they came from
 * (`speciesSources`, keyed by bucket + key), since each collection may carry its
 * own. The top-level list fields are the pre-per-source single snapshot, read
 * only as the baseline for the shared settings list. */
export type RevisionedKeyProfile = SpeciesListState & {
  overrides: Record<string, string | null>;
  overrideRevisions: Record<string, Revision>;
  speciesSources?: Record<string, SpeciesListState>;
};

export type RevisionedKeyProfiles = Record<string, RevisionedKeyProfile>;

type PersistedEnvelope = {
  state: { profiles: RevisionedKeyProfiles };
  version: number;
};

const LEGACY_REVISION: Revision = { at: 0, sequence: 0, writer: 'legacy' };
const WRITER_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `writer-${Math.random().toString(36).slice(2)}`;
let revisionSequence = 0;

export function nextKeyProfileRevision(observed?: Revision): Revision {
  revisionSequence += 1;
  return {
    at: Math.max(Date.now(), (observed?.at ?? 0) + 1),
    sequence: revisionSequence,
    writer: WRITER_ID,
  };
}

function compareRevision(a?: Revision, b?: Revision): number {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return a.at - b.at || a.sequence - b.sequence || a.writer.localeCompare(b.writer);
}

function newer<T>(
  aValue: T | undefined,
  aRevision: Revision | undefined,
  bValue: T | undefined,
  bRevision: Revision | undefined,
): { value: T | undefined; revision: Revision | undefined } {
  return compareRevision(aRevision, bRevision) >= 0
    ? { value: aValue, revision: aRevision }
    : { value: bValue, revision: bRevision };
}

export function emptyRevisionedProfile(): RevisionedKeyProfile {
  return { overrides: {}, overrideRevisions: {} };
}

function mergeRevisionedProfile(
  a: RevisionedKeyProfile | undefined,
  b: RevisionedKeyProfile | undefined,
): RevisionedKeyProfile {
  if (!a) return b ?? emptyRevisionedProfile();
  if (!b) return a;
  const overrides: Record<string, string | null> = {};
  const overrideRevisions: Record<string, Revision> = {};
  const names = new Set([
    ...Object.keys(a.overrides),
    ...Object.keys(b.overrides),
    ...Object.keys(a.overrideRevisions),
    ...Object.keys(b.overrideRevisions),
  ]);
  for (const name of names) {
    const selected = newer(
      a.overrides[name],
      a.overrideRevisions[name] ?? (name in a.overrides ? LEGACY_REVISION : undefined),
      b.overrides[name],
      b.overrideRevisions[name] ?? (name in b.overrides ? LEGACY_REVISION : undefined),
    );
    if (selected.revision) {
      overrides[name] = selected.value ?? null;
      overrideRevisions[name] = selected.revision;
    }
  }
  const sources = new Set([
    ...Object.keys(a.speciesSources ?? {}),
    ...Object.keys(b.speciesSources ?? {}),
  ]);
  return {
    overrides,
    overrideRevisions,
    ...mergeSpeciesListState(a, b),
    ...(sources.size
      ? {
          speciesSources: Object.fromEntries(
            [...sources]
              .map((source): [string, SpeciesListState] => [
                source,
                mergeSpeciesListState(
                  a.speciesSources?.[source] ?? {},
                  b.speciesSources?.[source] ?? {},
                ),
              ])
              .sort(
                ([aSource, aList], [bSource, bList]) =>
                  (bList.usedAt ?? 0) - (aList.usedAt ?? 0) || aSource.localeCompare(bSource),
              )
              .slice(0, MAX_SPECIES_SOURCES),
          ),
        }
      : {}),
  };
}

function mergeSpeciesListState(a: SpeciesListState, b: SpeciesListState): SpeciesListState {
  const accepted = newer(
    a.acceptedSpecies,
    a.acceptedRevision ?? (a.acceptedSpecies ? LEGACY_REVISION : undefined),
    b.acceptedSpecies,
    b.acceptedRevision ?? (b.acceptedSpecies ? LEGACY_REVISION : undefined),
  );
  const pending = newer(
    a.pendingSpeciesChange,
    a.pendingRevision,
    b.pendingSpeciesChange,
    b.pendingRevision,
  );
  const usedAt = Math.max(a.usedAt ?? 0, b.usedAt ?? 0);
  return {
    ...(usedAt ? { usedAt } : {}),
    ...(accepted.value ? { acceptedSpecies: accepted.value } : {}),
    ...(accepted.revision ? { acceptedRevision: accepted.revision } : {}),
    ...(pending.value ? { pendingSpeciesChange: pending.value } : {}),
    ...(pending.revision ? { pendingRevision: pending.revision } : {}),
  };
}

export function mergeRevisionedProfiles(
  a: RevisionedKeyProfiles,
  b: RevisionedKeyProfiles,
): RevisionedKeyProfiles {
  const merged: RevisionedKeyProfiles = {};
  for (const profileId of new Set([...Object.keys(a), ...Object.keys(b)])) {
    merged[profileId] = mergeRevisionedProfile(a[profileId], b[profileId]);
  }
  // The unscoped profile exists only long enough to migrate pre-profile data.
  // Once any endpoint/user profile has claimed it, never let a stale tab bring
  // it back or make tests/callers accidentally select it as an active profile.
  if (Object.keys(merged).some((profileId) => profileId !== '__legacy__')) {
    delete merged.__legacy__;
  }
  return merged;
}

function migrateProfile(raw: unknown): RevisionedKeyProfile {
  const profile = (raw ?? {}) as Partial<RevisionedKeyProfile>;
  const overrides = Object.fromEntries(
    Object.entries(profile.overrides ?? {}).map(([name, key]) => [name, key === '' ? null : key]),
  );
  return {
    overrides,
    overrideRevisions: {
      ...Object.fromEntries(Object.keys(overrides).map((name) => [name, LEGACY_REVISION])),
      ...(profile.overrideRevisions ?? {}),
    },
    ...(profile.acceptedSpecies ? { acceptedSpecies: profile.acceptedSpecies } : {}),
    ...(profile.acceptedRevision
      ? { acceptedRevision: profile.acceptedRevision }
      : profile.acceptedSpecies
        ? { acceptedRevision: LEGACY_REVISION }
        : {}),
    ...(profile.pendingSpeciesChange
      ? { pendingSpeciesChange: profile.pendingSpeciesChange }
      : {}),
    ...(profile.pendingRevision
      ? { pendingRevision: profile.pendingRevision }
      : profile.pendingSpeciesChange
        ? { pendingRevision: LEGACY_REVISION }
        : {}),
    ...(profile.speciesSources ? { speciesSources: profile.speciesSources } : {}),
  };
}

function parseRevisionedProfiles(raw: string | null, version: number): RevisionedKeyProfiles {
  if (!raw) return {};
  try {
    const envelope = JSON.parse(raw) as {
      version?: number;
      state?: {
        profiles?: Record<string, unknown>;
        overrides?: Record<string, string | null>;
        knownSpecies?: string[];
      };
    };
    if (envelope.version !== version) return {};
    if (envelope.state?.profiles) {
      return Object.fromEntries(
        Object.entries(envelope.state.profiles).map(([id, profile]) => [id, migrateProfile(profile)]),
      );
    }
    const acceptedSpecies = envelope.state?.knownSpecies?.map((scientificName) => ({
      scientificName,
      commonName: scientificName,
      keyBinding: null,
    }));
    return {
      __legacy__: migrateProfile({
        overrides: envelope.state?.overrides ?? {},
        acceptedSpecies,
      }),
    };
  } catch {
    return {};
  }
}

function serializeRevisionedProfiles(profiles: RevisionedKeyProfiles): string {
  const orderedProfiles = Object.fromEntries(
    Object.entries(profiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([profileId, profile]) => [
        profileId,
        {
          ...profile,
          overrides: Object.fromEntries(
            Object.entries(profile.overrides).sort(([a], [b]) => a.localeCompare(b)),
          ),
          overrideRevisions: Object.fromEntries(
            Object.entries(profile.overrideRevisions).sort(([a], [b]) => a.localeCompare(b)),
          ),
        },
      ]),
  );
  const envelope: PersistedEnvelope = {
    state: { profiles: orderedProfiles },
    version: KEYBINDING_STORAGE_VERSION,
  };
  return JSON.stringify(envelope);
}

export function readRevisionedProfiles(storage: Storage): RevisionedKeyProfiles {
  const current = storage.getItem(KEYBINDING_STORAGE_KEY);
  return current === null
    ? parseRevisionedProfiles(storage.getItem(V4_STORAGE_KEY), V4_STORAGE_VERSION)
    : parseRevisionedProfiles(current, KEYBINDING_STORAGE_VERSION);
}

/** `saved` is false when the write failed (usually a full localStorage): the
 * merged profiles still apply in this tab, but a reload would lose them. */
export function mergeAndWriteRevisionedProfiles(
  storage: Storage,
  local: RevisionedKeyProfiles,
): { profiles: RevisionedKeyProfiles; saved: boolean } {
  const merged = mergeRevisionedProfiles(readRevisionedProfiles(storage), local);
  const serialized = serializeRevisionedProfiles(merged);
  if (storage.getItem(KEYBINDING_STORAGE_KEY) !== serialized) {
    try {
      storage.setItem(KEYBINDING_STORAGE_KEY, serialized);
    } catch {
      return { profiles: merged, saved: false };
    }
  }
  return { profiles: merged, saved: true };
}

function fnv1a(input: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Hashed so the access key never lands in the clear inside the stored profile
 * name. Two seeds give 64 bits, so two profiles on one machine won't share a slot. */
export function keyProfileId(endpoint: string, accessKey: string): string {
  const input = `${endpoint.trim()}\u0000${accessKey.trim()}`;
  return fnv1a(input, 0x811c9dc5) + fnv1a(input, 0x9747b28c);
}
