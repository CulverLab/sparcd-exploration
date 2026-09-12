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
} from '@sparcd/auth-ui';
import { clearClientCache } from './lib/s3';
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

  // Settings (the login gate stays three-field; identity + dry-run live here).
  taggerUser: string; // logical userId for snapshot paths + editComments
  dryRun: boolean; // on by default; P4 sync logs and writes nothing until off
  burstGroupingEnabled: boolean; // off by default — our cameras shoot no bursts
  burstThresholdSec: number; // sequence grouping threshold (5–600s), used when enabled
  dateFormat: DateFormat; // display only — media.csv col 4 is always stored as full ISO
  timeFormat: TimeFormat; // display only, ditto
  distanceUnit: DistanceUnit; // not yet consumed — no location/elevation display exists

  connect: (config: S3Config, remember: boolean) => void;
  disconnect: () => void;
  setSection: (section: Section) => void;
  toggleTheme: () => void;
  selectCollection: (key: string | null) => void;
  selectUpload: (prefix: string | null) => void;
  openUploadForSnapshots: (collectionKey: string, uploadPrefix: string) => void;
  clearPendingSnapshots: () => void;
  setSyncState: (state: SyncState) => void;
  setTaggerUser: (value: string) => void;
  setDryRun: (value: boolean) => void;
  setBurstGrouping: (value: boolean) => void;
  setBurstThreshold: (value: number) => void;
  setDateFormat: (value: DateFormat) => void;
  setTimeFormat: (value: TimeFormat) => void;
  setDistanceUnit: (value: DistanceUnit) => void;
};

// This tab's own session, if it has one — same tab, so a BrandSwitcher hop to
// another SPARC'd tool or a reload lands straight back in the app. Nothing is
// cached yet at module init, so unlike the cross-tab handler below this needs
// no cache clear and no connectionId bump.
const initialSession = loadSessionConnection();

const LEGACY_THEME_KEY = 'sparcd-tagger-session';
const DISPLAY_PREFERENCES_KEY = 'sparcd-tagger-display-preferences';

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

function clearDisplayPreferences() {
  try {
    localStorage.removeItem(DISPLAY_PREFERENCES_KEY);
  } catch {
    // Disconnect still clears the active connection and in-memory preferences.
  }
}

const initialDisplayPreferences = loadDisplayPreferences();

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

export const useStore = create<TaggerState>()(
  // The secret key never reaches localStorage — only non-secret connection
  // fields live there (see @sparcd/auth-ui's session module), to pre-fill the
  // Connect form on a machine with no session running. s3Config starts from
  // this tab's own sessionStorage session, so switching tools or reloading
  // keeps the user in; failing that, a sibling tab's live relay
  // (`subscribeSharedConnection`) supplies one within a message round-trip of
  // mount, and otherwise the user enters the secret. Nothing else here is
  // written to disk by this store: the theme lives in the shared home every
  // SPARC'd tool reads, and transient state (selection, sync, pendingSnapshots)
  // is dropped on reload by design.
  (set) => ({
    s3Config: initialSession,
    connectionId: 0,
    section: 'browse',
    theme: initialTheme(),
    syncState: 'local-only',
    selectedCollectionKey: null,
    selectedUploadPrefix: null,
    pendingSnapshots: false,
    taggerUser: '',
    dryRun: true,
    burstGroupingEnabled: false,
    burstThresholdSec: 60,
    ...initialDisplayPreferences,

    connect: (config, remember) => {
      clearClientCache();
      saveSharedConnection(config, remember);
      set((s) => ({
        s3Config: config,
        connectionId: s.connectionId + 1,
        selectedCollectionKey: null,
        selectedUploadPrefix: null,
      }));
    },
    disconnect: () => {
      clearClientCache();
      clearSharedConnection();
      clearDisplayPreferences();
      set((s) => ({
        s3Config: null,
        connectionId: s.connectionId + 1,
        section: 'browse',
        selectedCollectionKey: null,
        selectedUploadPrefix: null,
        taggerUser: '',
        ...defaultDisplayPreferences,
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
    setTaggerUser: (value) => set({ taggerUser: value }),
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
  }),
);

// React to login/logout in OTHER tabs open right now, live (never persisted —
// see session.ts). Mirror the new connection into this store and bump
// connectionId so client-side caches scoped to a connection are invalidated.
// Also answers a sibling tab's own request with our current s3Config, if any.
subscribeSharedConnection((cfg) => {
  clearClientCache();
  useStore.setState((s) => ({
    s3Config: cfg,
    connectionId: s.connectionId + 1,
    ...(cfg
      ? {}
      : {
          section: 'browse' as const,
          selectedCollectionKey: null,
          selectedUploadPrefix: null,
          taggerUser: '',
        }),
  }));
}, () => useStore.getState().s3Config);
