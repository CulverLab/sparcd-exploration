import { create } from 'zustand';
import type { S3Config } from '@sparcd/types';
import {
  loadSessionConnection,
  saveSharedConnection,
  clearSharedConnection,
  subscribeSharedConnection,
  loadSharedTheme,
  saveSharedTheme,
  type Theme,
  loadLoginIdentityPreference,
  loginIdentityPreferenceKey,
  saveLoginIdentity,
  saveLoginIdentityDefault,
  subscribeLoginIdentityChanges,
  fetchWhoAmI,
  type LoginIdentityPreference,
} from '@sparcd/auth-ui';
import { clearClientCache } from './lib/s3';
import { localBatchId } from './lib/localBatch';
import type { DateFormat, TimeFormat } from './lib/formatting';

export type Section = 'browse' | 'tag' | 'history' | 'settings';
export type { Theme };
export type DistanceUnit = 'meters' | 'feet';

/** Top-bar sync state. P0 is read-only, so live values are `local-only`; the
 *  rest of the union exists so the pill is built once and P4 just feeds it. */
export type SyncState =
  | 'local-only'
  | 'unsynced'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'dry-run'
  | 'error';

type TaggerState = {
  s3Config: S3Config | null;
  connectionId: number; // increments on connect/disconnect to scope client-side caches
  section: Section;
  theme: Theme;
  syncState: SyncState;

  // What the researcher has drilled into (Browse → Tag).
  selectedCollectionKey: string | null; // `${bucket}::${uuid}`
  selectedUploadPrefix: string | null; // full `Collections/<uuid>/Uploads/<stamp>/`

  // Set when History routes to an upload to restore a snapshot: the Tag
  // workspace consumes it once to auto-open its Snapshots dialog, then clears it.
  pendingSnapshots: boolean;

  // Active login’s display identity used for attribution and audit paths. Local
  // batch mode may carry its handoff identity separately because it has no S3.
  taggerUser: string;
  identityPersistenceError: boolean;
  identityEditing: boolean;
  identityResolvedDefault: string | null;
  identityDefaultSource: 'whoami' | 'access-key' | null;
  beginTaggerIdentityEdit: () => void;
  identityUnsavedCustom: string | null;
  identityResolutionStatus: 'idle' | 'loading' | 'ready' | 'error';
  identityResolutionError: string | null;
  ensureTaggerIdentity: () => void;
  refreshTaggerIdentity: () => Promise<void>;
  dryRun: boolean; // off by default; on to preview a sync without writing anything
  burstGroupingEnabled: boolean; // off by default — our cameras shoot no bursts
  burstThresholdSec: number; // sequence grouping threshold (5–600s), used when enabled
  dateFormat: DateFormat; // display only — media.csv col 4 is always stored as full ISO
  timeFormat: TimeFormat; // display only, ditto
  distanceUnit: DistanceUnit; // preferred unit emphasized in location elevation details
  autoAdvanceOnTag: boolean; // on by default — advances Focus after an assignment

  connect: (config: S3Config, remember: boolean) => void;
  disconnect: () => void;
  setSection: (section: Section) => void;
  toggleTheme: () => void;
  selectCollection: (key: string | null) => void;
  selectUpload: (prefix: string | null) => void;
  openUploadForSnapshots: (collectionKey: string, uploadPrefix: string) => void;
  clearPendingSnapshots: () => void;
  setSyncState: (state: SyncState) => void;
  /** Custom identity for this login, or the disconnected local batch. */
  setTaggerUser: (value: string) => void;
  setDryRun: (value: boolean) => void;
  setBurstGrouping: (value: boolean) => void;
  setBurstThreshold: (value: number) => void;
  setDateFormat: (value: DateFormat) => void;
  setTimeFormat: (value: TimeFormat) => void;
  setDistanceUnit: (value: DistanceUnit) => void;
  setAutoAdvanceOnTag: (value: boolean) => void;
};

// This tab's own session, if it has one — same tab, so a BrandSwitcher hop to
// another SPARC'd tool or a reload lands straight back in the app. Nothing is
// cached yet at module init, so unlike the cross-tab handler below this needs
// no cache clear and no connectionId bump.
// A local handoff is deliberately storage-free even when this tab inherited a
// shared S3 session from another SPARC'd tool. Do not let that session replace
// the handoff identity or expose connected-only actions in the local workspace.
const initialSession = localBatchId ? null : loadSessionConnection();

const LEGACY_THEME_KEY = 'sparcd-tagger-session';
const DISPLAY_PREFERENCES_KEY = 'sparcd-tagger-display-preferences';
const AUTO_ADVANCE_KEY = 'sparcd-tagger-auto-advance-on-tag';
const LOCAL_BATCH_IDENTITY_KEY = 'sparcd-tagger-local-batch-identity';

type DisplayPreferences = Pick<TaggerState, 'dateFormat' | 'timeFormat' | 'distanceUnit'>;

const defaultDisplayPreferences: DisplayPreferences = {
  dateFormat: 'iso-local',
  timeFormat: '24h',
  distanceUnit: 'meters',
};

function loadDisplayPreferences(): DisplayPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(DISPLAY_PREFERENCES_KEY) ?? '{}') as Partial<DisplayPreferences>;
    return {
      dateFormat: ['long', 'short', 'numeric', 'iso-local'].includes(stored.dateFormat ?? '')
        ? stored.dateFormat as DisplayPreferences['dateFormat']
        : defaultDisplayPreferences.dateFormat,
      timeFormat: ['24h', '24h-seconds', '12h', '12h-seconds'].includes(stored.timeFormat ?? '')
        ? stored.timeFormat as DisplayPreferences['timeFormat']
        : defaultDisplayPreferences.timeFormat,
      distanceUnit: stored.distanceUnit === 'feet' ? 'feet' : defaultDisplayPreferences.distanceUnit,
    };
  } catch {
    return defaultDisplayPreferences;
  }
}

function saveDisplayPreferences(preferences: DisplayPreferences) {
  try {
    localStorage.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable or full; the in-memory choice still applies.
  }
}

function loadAutoAdvance(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_ADVANCE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function saveAutoAdvance(value: boolean) {
  try {
    localStorage.setItem(AUTO_ADVANCE_KEY, String(value));
  } catch {
    // Storage can be unavailable or full; the in-memory choice still applies.
  }
}

function clearAutoAdvance() {
  try {
    localStorage.removeItem(AUTO_ADVANCE_KEY);
  } catch {
    // Disconnect still clears the active connection and in-memory preference.
  }
}

function loadLocalBatchIdentity(): string {
  try {
    return sessionStorage.getItem(LOCAL_BATCH_IDENTITY_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveLocalBatchIdentity(value: string): void {
  try {
    sessionStorage.setItem(LOCAL_BATCH_IDENTITY_KEY, value);
  } catch {
    // The in-memory value still makes the current local batch usable.
  }
}

function clearLocalBatchIdentity(): void {
  try {
    sessionStorage.removeItem(LOCAL_BATCH_IDENTITY_KEY);
  } catch {
    // The in-memory value is cleared below even when storage is unavailable.
  }
}

// A local-batch handoff has no storage account to provide attribution, so its
// identity survives a reload in this tab only. Connected sessions instead
// use the shared custom identity or resolved account default for their login.
const initialDisplayPreferences = loadDisplayPreferences();

export function connectedIdentity(config: S3Config | null): string {
  const preference = loadLoginIdentityPreference(config?.accessKey);
  return preference.customIdentity ?? preference.defaultIdentity ?? '';
}

/** The choice this tool persisted for itself before the shared home existed. */
function legacyTheme(): Theme | null {
  try {
    const raw = sessionStorage.getItem(LEGACY_THEME_KEY);
    if (!raw) return null;
    const theme = (JSON.parse(raw) as { state?: { theme?: string } }).state?.theme;
    return theme === 'light' || theme === 'dark' ? theme : null;
  } catch {
    return null;
  }
}

function initialTheme(): Theme {
  const shared = loadSharedTheme();
  if (shared) return shared;
  const legacy = legacyTheme();
  if (legacy) saveSharedTheme(legacy);
  return legacy ?? 'light';
}

function effectiveIdentity(
  state: Pick<TaggerState, 'identityEditing' | 'taggerUser' | 'identityUnsavedCustom' | 'identityResolvedDefault' | 'identityDefaultSource' | 'identityResolutionStatus'>,
  preference: LoginIdentityPreference,
  defaultIdentity = state.identityResolutionStatus === 'error'
    ? (state.identityDefaultSource === 'whoami' ? state.identityResolvedDefault : null)
      ?? (preference.defaultSource === 'whoami' ? preference.defaultIdentity : null) ?? ''
    : state.identityResolvedDefault ?? preference.defaultIdentity ?? '',
): string {
  if (state.identityEditing) return state.taggerUser;
  if (state.identityUnsavedCustom !== null) {
    return state.identityUnsavedCustom.trim() ? state.identityUnsavedCustom : defaultIdentity;
  }
  return preference.customIdentity ?? defaultIdentity;
}

let identityLookupGeneration = 0;
const emptyIdentityState = {
  identityPersistenceError: false,
  identityEditing: false,
  identityResolvedDefault: null,
  identityDefaultSource: null,
  identityUnsavedCustom: null,
  identityResolutionStatus: 'idle' as const,
  identityResolutionError: null,
};

export const useStore = create<TaggerState>()(
  // The secret key never reaches localStorage — only non-secret connection
  // fields live there (see @sparcd/auth-ui's session module), to pre-fill the
  // Connect form on a machine with no session running. s3Config starts from
  // this tab's own sessionStorage session, so switching tools or reloading
  // keeps the user in; failing that, a sibling tab's live relay
  // (`subscribeSharedConnection`) supplies one within a message round-trip of
  // mount, and otherwise the user enters the secret. The theme lives in the
  // shared home every SPARC'd tool reads; date/time/distance display prefs,
  // auto-advance persist to their own localStorage keys (see the loaders
  // above); attribution comes from the active connection. Everything else —
  // selection, sync state, pendingSnapshots, dryRun — is transient and dropped
  // on reload by design.
  (set, get) => ({
    s3Config: initialSession,
    connectionId: 0,
    section: 'browse',
    theme: initialTheme(),
    syncState: 'local-only',
    selectedCollectionKey: null,
    selectedUploadPrefix: null,
    pendingSnapshots: false,
    taggerUser: initialSession ? connectedIdentity(initialSession) : loadLocalBatchIdentity(),
    ...emptyIdentityState,
    dryRun: false,
    burstGroupingEnabled: false,
    burstThresholdSec: 60,
    ...initialDisplayPreferences,
    autoAdvanceOnTag: loadAutoAdvance(),

    connect: (config, remember) => {
      const current = get();
      const sameLogin = current.s3Config?.accessKey.trim() === config.accessKey.trim();
      const transient = sameLogin ? current.identityUnsavedCustom : null;
      clearClientCache();
      saveSharedConnection(config, remember);
      set((s) => ({
        s3Config: config,
        connectionId: s.connectionId + 1,
        selectedCollectionKey: null,
        selectedUploadPrefix: null,
        ...emptyIdentityState,
        taggerUser: sameLogin && current.identityEditing ? current.taggerUser : transient ?? connectedIdentity(config),
        identityEditing: sameLogin && current.identityEditing,
        identityUnsavedCustom: transient,
        identityPersistenceError: transient !== null,
        identityResolvedDefault: sameLogin ? current.identityResolvedDefault : null,
        identityDefaultSource: sameLogin ? current.identityDefaultSource : null,
      }));
      void get().refreshTaggerIdentity();
    },
    disconnect: () => {
      clearClientCache();
      clearSharedConnection();
      clearAutoAdvance();
      clearLocalBatchIdentity();
      set((s) => ({
        s3Config: null,
        connectionId: s.connectionId + 1,
        section: 'browse',
        selectedCollectionKey: null,
        selectedUploadPrefix: null,
        taggerUser: '',
        ...emptyIdentityState,
        autoAdvanceOnTag: true,
      }));
    },
    setSection: (section) => set({ section }),
    toggleTheme: () =>
      set((s) => {
        const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
        saveSharedTheme(theme);
        return { theme };
      }),
    selectCollection: (key) =>
      set({ selectedCollectionKey: key, selectedUploadPrefix: null, syncState: 'local-only' }),
    selectUpload: (prefix) =>
      set({
        selectedUploadPrefix: prefix,
        section: prefix ? 'tag' : 'browse',
        syncState: 'local-only',
      }),
    openUploadForSnapshots: (collectionKey, uploadPrefix) =>
      set({
        selectedCollectionKey: collectionKey,
        selectedUploadPrefix: uploadPrefix,
        section: 'tag',
        syncState: 'local-only',
        pendingSnapshots: true,
      }),
    clearPendingSnapshots: () => set({ pendingSnapshots: false }),
    setSyncState: (state) => set({ syncState: state }),
    beginTaggerIdentityEdit: () => set({ identityEditing: true }),
    setTaggerUser: (value) => {
      const { s3Config } = get();
      if (!s3Config) saveLocalBatchIdentity(value);
      const saved = s3Config ? saveLoginIdentity(s3Config.accessKey, value) : true;
      set({
        taggerUser: value,
        identityPersistenceError: !!s3Config && !saved,
        identityUnsavedCustom: s3Config && !saved ? value : null,
      });
    },
    ensureTaggerIdentity: () => {
      const state = get();
      if (!state.s3Config) return;
      const preference = loadLoginIdentityPreference(state.s3Config.accessKey);
      set({
        identityEditing: false,
        taggerUser: effectiveIdentity({ ...state, identityEditing: false }, preference),
      });
      if (state.identityResolutionStatus === 'idle') void get().refreshTaggerIdentity();
    },
    refreshTaggerIdentity: async () => {
      const { s3Config, connectionId } = get();
      if (!s3Config) return;
      const login = s3Config.accessKey.trim();
      const requestGeneration = ++identityLookupGeneration;
      const initialPreference = loadLoginIdentityPreference(login);
      set({
        taggerUser: effectiveIdentity(get(), initialPreference),
        identityResolutionStatus: 'loading',
        identityResolutionError: null,
      });
      try {
        const result = await fetchWhoAmI(s3Config);
        const current = get();
        if (requestGeneration !== identityLookupGeneration || current.connectionId !== connectionId || current.s3Config?.accessKey.trim() !== login) return;
        const identity = result.kind === 'unsupported' ? login : result.name;
        const source = result.kind === 'unsupported' ? 'access-key' : 'whoami';
        const saved = saveLoginIdentityDefault(login, identity, source);
        const preference = loadLoginIdentityPreference(login);
        set({
          taggerUser: effectiveIdentity(current, preference, identity),
          identityResolvedDefault: identity,
          identityDefaultSource: source,
          identityPersistenceError: current.identityUnsavedCustom !== null || !saved,
          identityResolutionStatus: 'ready',
          identityResolutionError: null,
        });
      } catch (error) {
        const current = get();
        if (requestGeneration !== identityLookupGeneration || current.connectionId !== connectionId || current.s3Config?.accessKey.trim() !== login) return;
        const preference = loadLoginIdentityPreference(login);
        const priorName = current.identityDefaultSource === 'whoami'
          ? current.identityResolvedDefault
          : preference.defaultSource === 'whoami' ? preference.defaultIdentity : null;
        set({
          taggerUser: effectiveIdentity(current, preference, priorName ?? ''),
          identityResolvedDefault: priorName,
          identityDefaultSource: priorName ? 'whoami' : null,
          identityResolutionStatus: 'error',
          identityResolutionError: error instanceof Error
            ? error.message
            : 'The account name could not be loaded. Check the connection and retry.',
        });
      }
    },
    setDryRun: (value) => set({ dryRun: value }),
    setBurstGrouping: (value) => set({ burstGroupingEnabled: value }),
    setBurstThreshold: (value) => set({ burstThresholdSec: value }),
    setDateFormat: (dateFormat) =>
      set((s) => {
        const preferences = { dateFormat, timeFormat: s.timeFormat, distanceUnit: s.distanceUnit };
        saveDisplayPreferences(preferences);
        return { dateFormat };
      }),
    setTimeFormat: (timeFormat) =>
      set((s) => {
        const preferences = { dateFormat: s.dateFormat, timeFormat, distanceUnit: s.distanceUnit };
        saveDisplayPreferences(preferences);
        return { timeFormat };
      }),
    setDistanceUnit: (distanceUnit) =>
      set((s) => {
        const preferences = { dateFormat: s.dateFormat, timeFormat: s.timeFormat, distanceUnit };
        saveDisplayPreferences(preferences);
        return { distanceUnit };
      }),
    setAutoAdvanceOnTag: (autoAdvanceOnTag) => {
      saveAutoAdvance(autoAdvanceOnTag);
      set({ autoAdvanceOnTag });
    },
  }),
);

// React to login/logout in OTHER tabs open right now, live (never persisted —
// see session.ts). Mirror the new connection into this store and bump
// connectionId so client-side caches scoped to a connection are invalidated.
// Also answers a sibling tab's own request with our current s3Config, if any.
subscribeSharedConnection((cfg) => {
  if (localBatchId) return;
  const currentState = useStore.getState();
  const current = currentState.s3Config;
  if (cfg && current && cfg.accessKey === current.accessKey && cfg.endpoint === current.endpoint &&
      cfg.secretKey === current.secretKey && cfg.region === current.region &&
      cfg.secure === current.secure && cfg.forcePathStyle === current.forcePathStyle) return;
  const sameLogin = !!cfg && !!current && cfg.accessKey.trim() === current.accessKey.trim();
  const transient = sameLogin ? useStore.getState().identityUnsavedCustom : null;
  clearClientCache();
  useStore.setState((s) => ({
    s3Config: cfg,
    connectionId: s.connectionId + 1,
    ...emptyIdentityState,
    taggerUser: sameLogin && currentState.identityEditing ? currentState.taggerUser : transient ?? connectedIdentity(cfg),
    identityEditing: sameLogin && currentState.identityEditing,
    identityUnsavedCustom: transient,
    identityPersistenceError: transient !== null,
    identityResolvedDefault: sameLogin ? currentState.identityResolvedDefault : null,
    identityDefaultSource: sameLogin ? currentState.identityDefaultSource : null,
    ...(cfg
      ? {}
      : {
          section: 'browse' as const,
          selectedCollectionKey: null,
          selectedUploadPrefix: null,
        }),
  }));
  if (cfg) void useStore.getState().refreshTaggerIdentity();
}, () => (localBatchId ? null : useStore.getState().s3Config));

subscribeLoginIdentityChanges(({ preferenceKey }) => {
  const state = useStore.getState();
  if (!state.s3Config || localBatchId) return;
  if (preferenceKey !== null && preferenceKey !== loginIdentityPreferenceKey(state.s3Config.accessKey.trim())) return;
  const preference = loadLoginIdentityPreference(state.s3Config.accessKey);
  const acceptDefault = preference.defaultSource === 'whoami' || state.identityResolutionStatus !== 'error';
  const defaultIdentity = acceptDefault ? preference.defaultIdentity ?? state.identityResolvedDefault : state.identityResolvedDefault;
  useStore.setState({
    taggerUser: effectiveIdentity(state, preference, defaultIdentity ?? ''),
    identityResolvedDefault: defaultIdentity,
    identityDefaultSource: acceptDefault ? preference.defaultSource ?? state.identityDefaultSource : state.identityDefaultSource,
  });
  if (!state.identityEditing && !useStore.getState().taggerUser.trim()) void state.refreshTaggerIdentity();
});
