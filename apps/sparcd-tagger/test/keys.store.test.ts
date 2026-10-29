import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

type KeyStore = typeof import('../src/lib/keys').useKeyBindings;

const STORAGE_KEY = 'sparcd-tagger-keybindings-v5';
const V4_KEY = 'sparcd-tagger-keybindings';
const values = new Map<string, string>();
let quotaFull = false;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (quotaFull) throw new DOMException('full', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  },
});

let useKeyBindings: KeyStore;
let rehydrateKeyBindings: typeof import('../src/lib/keys').rehydrateKeyBindings;
let effectiveKey: typeof import('../src/lib/keys').effectiveKey;

let MAX_SPECIES_SOURCES: number;

beforeAll(async () => {
  ({ MAX_SPECIES_SOURCES } = await import('@sparcd/auth-ui'));
  ({ useKeyBindings, rehydrateKeyBindings, effectiveKey } = await import('../src/lib/keys'));
});

const original = [
  { scientificName: 'a', commonName: 'Alpha', keyBinding: 'A' },
  { scientificName: 'removed', commonName: 'Removed', keyBinding: 'R' },
];
const SETTINGS = 'sparcd-settings/Settings/species.json';
const COLLECTION = 'sparcd-abc/Collections/abc/species.json';
const OTHER_COLLECTION = 'sparcd-def/Collections/def/species.json';
const changed = [
  { scientificName: 'a', commonName: 'Alpha renamed', keyBinding: '?' },
  { scientificName: 'added', commonName: 'Added', keyBinding: 'N' },
];

describe('per-user keybinding profiles', () => {
  beforeEach(() => {
    values.clear();
    useKeyBindings.setState({ profiles: {}, activeProfileId: null });
  });

  it('isolates assignments for two endpoint/user profiles', () => {
    const store = useKeyBindings.getState();
    store.activateProfile('server\u0000alice');
    useKeyBindings.getState().assignKey('a', '?');
    useKeyBindings.getState().activateProfile('server\u0000bob');
    expect(useKeyBindings.getState().profiles['server\u0000bob'].overrides).toEqual({});
    useKeyBindings.getState().assignKey('a', '#');
    expect(useKeyBindings.getState().profiles['server\u0000alice'].overrides.a).toBe('?');
  });

  it('persists null tombstones and atomic duplicate transfers', () => {
    useKeyBindings.getState().activateProfile('server\u0000alice');
    useKeyBindings.getState().assignKey('a', 'd');
    useKeyBindings.getState().assignKey('b', 'd', ['a']);
    expect(useKeyBindings.getState().profiles['server\u0000alice'].overrides).toEqual({
      a: null,
      b: 'd',
    });
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"a":null');
  });

  it('keeps vocabulary changes pending until explicit acknowledgement', () => {
    useKeyBindings.getState().activateProfile('server\u0000alice');
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    useKeyBindings.getState().assignKey('removed', '!');
    useKeyBindings.getState().stageSpecies(SETTINGS, changed, true);
    let profile = useKeyBindings.getState().profiles['server\u0000alice'];
    expect(profile.speciesSources?.[SETTINGS]?.pendingSpeciesChange?.diff.added[0].scientificName).toBe('added');
    expect(profile.speciesSources?.[SETTINGS]?.acceptedSpecies).toEqual(original);
    expect(profile.overrides.removed).toBe('!');

    useKeyBindings.getState().acknowledgeSpeciesChange(SETTINGS);
    profile = useKeyBindings.getState().profiles['server\u0000alice'];
    expect(profile.speciesSources?.[SETTINGS]?.pendingSpeciesChange).toBeUndefined();
    expect(profile.speciesSources?.[SETTINGS]?.acceptedSpecies).toEqual(changed);
    expect(profile.overrides.removed).toBe('!');
  });

  it('does not revise a profile when the vocabulary is unchanged', () => {
    useKeyBindings.getState().activateProfile('server\u0000alice');
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    const before = localStorage.getItem(STORAGE_KEY);

    useKeyBindings.getState().stageSpecies(SETTINGS, [...original], true);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('restores a default key when the server removes and re-adds a species', () => {
    useKeyBindings.getState().activateProfile('server\u0000alice');
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    useKeyBindings.getState().stageSpecies(SETTINGS, changed, true);
    useKeyBindings.getState().acknowledgeSpeciesChange(SETTINGS);
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    useKeyBindings.getState().acknowledgeSpeciesChange(SETTINGS);
    const { overrides } = useKeyBindings.getState().profiles['server\u0000alice'];
    expect(effectiveKey('removed', 'R', overrides)).toBe('r');
  });

  it('distinguishes an accepted empty vocabulary from an uninitialized profile', () => {
    useKeyBindings.getState().activateProfile('server\u0000alice');
    useKeyBindings.getState().stageSpecies(SETTINGS, [], true);
    useKeyBindings.getState().stageSpecies(SETTINGS, changed, true);
    expect(
      useKeyBindings.getState().profiles['server\u0000alice'].speciesSources?.[SETTINGS]?.pendingSpeciesChange?.diff.added,
    ).toHaveLength(2);
  });

  it('rehydrates another tab\'s update without changing this tab\'s active profile', async () => {
    useKeyBindings.getState().activateProfile('server\u0000alice');
    useKeyBindings.getState().assignKey('a', '?');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      state: { profiles: Record<string, { overrides: Record<string, string | null> }> };
      version: number;
    };
    stored.state.profiles['server\u0000alice'].overrides.b = '#';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    rehydrateKeyBindings();

    expect(useKeyBindings.getState().activeProfileId).toBe('server\u0000alice');
    expect(useKeyBindings.getState().profiles['server\u0000alice'].overrides).toMatchObject({
      a: '?',
      b: '#',
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.profiles[
      'server\u0000alice'
    ].overrides).toMatchObject({ a: '?', b: '#' });
  });

  it('merges a concurrent stale-tab assignment during full store rehydration', () => {
    const profileId = 'server\u0000alice';
    useKeyBindings.getState().activateProfile(profileId);
    const staleTab = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      state: {
        profiles: Record<
          string,
          {
            overrides: Record<string, string | null>;
            overrideRevisions: Record<string, { at: number; sequence: number; writer: string }>;
          }
        >;
      };
      version: number;
    };

    useKeyBindings.getState().assignKey('a', 'a');
    staleTab.state.profiles[profileId].overrides.b = 'b';
    staleTab.state.profiles[profileId].overrideRevisions.b = {
      at: Date.now() + 1,
      sequence: 1,
      writer: 'stale-tab',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staleTab));

    rehydrateKeyBindings();

    expect(useKeyBindings.getState().profiles[profileId].overrides).toMatchObject({ a: 'a', b: 'b' });
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      state: { profiles: Record<string, { overrides: Record<string, string | null> }> };
    };
    expect(persisted.state.profiles[profileId].overrides).toMatchObject({ a: 'a', b: 'b' });
  });
});

describe('species lists remembered per source', () => {
  const profileId = 'server\u0000alice';
  const sources = () => useKeyBindings.getState().profiles[profileId].speciesSources ?? {};

  beforeEach(() => {
    values.clear();
    useKeyBindings.setState({ profiles: {}, activeProfileId: null });
    useKeyBindings.getState().activateProfile(profileId);
  });

  it('accepts a collection list silently the first time it is seen', () => {
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    expect(sources()[COLLECTION].acceptedSpecies).toEqual(
      [...changed].sort((a, b) => a.scientificName.localeCompare(b.scientificName)),
    );
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeUndefined();
    expect(sources()[SETTINGS].pendingSpeciesChange).toBeUndefined();
  });

  it('switches between collections with different lists without a change', () => {
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    useKeyBindings.getState().stageSpecies(OTHER_COLLECTION, changed);
    const accepted = (source: string) => sources()[source].acceptedRevision;
    const before = [accepted(COLLECTION), accepted(OTHER_COLLECTION)];
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    useKeyBindings.getState().stageSpecies(OTHER_COLLECTION, changed);
    expect([accepted(COLLECTION), accepted(OTHER_COLLECTION)]).toEqual(before);
    expect(Object.values(sources()).some((list) => list.pendingSpeciesChange)).toBe(false);
  });

  it('reports a change to a list already seen, and acknowledges only that list', () => {
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    expect(sources()[COLLECTION].pendingSpeciesChange?.diff.removed[0].scientificName).toBe(
      'removed',
    );
    useKeyBindings.getState().acknowledgeSpeciesChange(SETTINGS);
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeDefined();
    useKeyBindings.getState().acknowledgeSpeciesChange(COLLECTION);
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeUndefined();
    expect(sources()[SETTINGS].acceptedSpecies).toEqual(original);
  });

  it('keeps a binding for a species the next collection lacks', () => {
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    useKeyBindings.getState().assignKey('removed', '!');
    useKeyBindings.getState().stageSpecies(OTHER_COLLECTION, changed);
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    expect(useKeyBindings.getState().profiles[profileId].overrides.removed).toBe('!');
  });

  it('treats a stored single snapshot as the settings list', () => {
    useKeyBindings.setState({
      profiles: {
        [profileId]: {
          overrides: {},
          overrideRevisions: {},
          acceptedSpecies: original,
          acceptedRevision: { at: 1, sequence: 1, writer: 'old' },
        },
      },
      activeProfileId: profileId,
    });
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeUndefined();
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    expect(sources()[SETTINGS].acceptedSpecies).toEqual(original);
    expect(sources()[SETTINGS].pendingSpeciesChange).toBeUndefined();
    useKeyBindings.getState().stageSpecies(SETTINGS, changed, true);
    expect(sources()[SETTINGS].pendingSpeciesChange?.diff.added[0].scientificName).toBe('added');
  });

  it('merges another tab\'s accepted list for a different source', () => {
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    stored.state.profiles[profileId].speciesSources[OTHER_COLLECTION] = {
      acceptedSpecies: changed,
      acceptedRevision: { at: Date.now() + 1, sequence: 1, writer: 'other-tab' },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    rehydrateKeyBindings();
    expect(Object.keys(sources()).sort()).toEqual([COLLECTION, OTHER_COLLECTION].sort());
  });
});

describe('species list storage', () => {
  const profileId = 'server\u0000alice';
  const sources = () => useKeyBindings.getState().profiles[profileId].speciesSources ?? {};
  const openTab = () => {
    useKeyBindings.setState({ profiles: {}, activeProfileId: null });
    rehydrateKeyBindings();
    useKeyBindings.getState().activateProfile(profileId);
    return useKeyBindings.getState();
  };

  beforeEach(() => {
    values.clear();
    quotaFull = false;
    useKeyBindings.setState({ profiles: {}, activeProfileId: null });
    useKeyBindings.getState().activateProfile(profileId);
  });

  it('lets two tabs stage and acknowledge the same change once', () => {
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    const tabA = useKeyBindings.getState();

    openTab();
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeDefined();
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    useKeyBindings.getState().acknowledgeSpeciesChange(COLLECTION);

    useKeyBindings.setState(tabA);
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeUndefined();
    useKeyBindings.getState().acknowledgeSpeciesChange(COLLECTION);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.state.profiles[profileId].speciesSources[COLLECTION].pendingSpeciesChange)
      .toBeUndefined();
    expect(sources()[COLLECTION].acceptedSpecies?.map((s) => s.scientificName)).toEqual([
      'a',
      'added',
    ]);
  });

  it('starts from version 4 data and ignores later version 4 writes', () => {
    const v4 = (acceptedSpecies: typeof original) =>
      JSON.stringify({
        state: { profiles: { [profileId]: { overrides: { a: 'q' }, acceptedSpecies } } },
        version: 4,
      });
    values.clear();
    values.set(V4_KEY, v4(original));
    openTab();
    expect(useKeyBindings.getState().profiles[profileId].overrides.a).toBe('q');
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);

    // A tab still on version 4 code rewrites its own key, without the per-source lists.
    values.set(V4_KEY, v4(changed));
    openTab();
    expect(Object.keys(sources()).sort()).toEqual([COLLECTION, SETTINGS].sort());
    useKeyBindings.getState().stageSpecies(SETTINGS, original, true);
    expect(sources()[SETTINGS].pendingSpeciesChange).toBeUndefined();
  });

  it('keeps only the most recently used sources', () => {
    for (let i = 0; i < MAX_SPECIES_SOURCES + 5; i += 1) {
      useKeyBindings.getState().stageSpecies(`bucket-${i}/species.json`, original);
    }
    useKeyBindings.getState().stageSpecies('bucket-0/species.json', original);
    const kept = Object.keys(sources());
    expect(kept).toHaveLength(MAX_SPECIES_SOURCES);
    expect(kept).toContain('bucket-0/species.json');
    expect(kept).toContain(`bucket-${MAX_SPECIES_SOURCES + 4}/species.json`);
    expect(kept).not.toContain('bucket-1/species.json');
  });

  it('keeps working in memory when localStorage is full', () => {
    quotaFull = true;
    expect(() => useKeyBindings.getState().stageSpecies(COLLECTION, original)).not.toThrow();
    expect(sources()[COLLECTION].acceptedSpecies).toHaveLength(2);
  });

  it('flags changes it could not save, and clears the flag once a write fits', () => {
    quotaFull = true;
    useKeyBindings.getState().assignKey('a', 'x');
    expect(useKeyBindings.getState().unsaved).toBe(true);
    expect(useKeyBindings.getState().profiles[profileId].overrides.a).toBe('x');
    quotaFull = false;
    useKeyBindings.getState().assignKey('a', 'y');
    expect(useKeyBindings.getState().unsaved).toBe(false);
  });

  it('flags an acknowledged vocabulary change when localStorage cannot save it', () => {
    useKeyBindings.getState().stageSpecies(COLLECTION, original);
    useKeyBindings.getState().stageSpecies(COLLECTION, changed);
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeDefined();

    quotaFull = true;
    useKeyBindings.getState().acknowledgeSpeciesChange(COLLECTION);

    expect(useKeyBindings.getState().unsaved).toBe(true);
    expect(sources()[COLLECTION].pendingSpeciesChange).toBeUndefined();
    expect(sources()[COLLECTION].acceptedSpecies?.map((s) => s.scientificName)).toEqual([
      'a',
      'added',
    ]);

    quotaFull = false;
    useKeyBindings.getState().assignKey('a', 'x');
    expect(useKeyBindings.getState().unsaved).toBe(false);
  });
});
