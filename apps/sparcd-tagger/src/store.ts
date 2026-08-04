import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { S3Config } from '@sparcd/types';
import {
  saveSharedConnection,
  clearSharedConnection,
  subscribeSharedConnection,
} from '@sparcd/auth-ui';
import { clearClientCache } from './lib/s3';

export type Section = 'browse' | 'tag' | 'history' | 'settings';
export type Theme = 'light' | 'dark';

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

  connect: (config: S3Config) => void;
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
};

export const useStore = create<TaggerState>()(
  // The secret key is NEVER persisted to disk — only non-secret connection
  // fields live in localStorage (see @sparcd/auth-ui's session module), purely
  // to pre-fill the Connect form on reload. s3Config always starts null here;
  // the user re-enters the secret every time, UNLESS another tab in this
  // browser session is already connected, in which case
  // `subscribeSharedConnection`'s live (never-persisted) cross-tab relay picks
  // it up within a message round-trip of mount. Zustand's own persist here
  // covers only cheap UI prefs (theme). Transient state (selection, sync,
  // pendingSnapshots) is excluded too.
  persist(
    (set) => ({
      s3Config: null,
      connectionId: 0,
      section: 'browse',
      theme: 'light',
      syncState: 'local-only',
      selectedCollectionKey: null,
      selectedUploadPrefix: null,
      pendingSnapshots: false,
      taggerUser: '',
      dryRun: true,
      burstGroupingEnabled: false,
      burstThresholdSec: 60,

      connect: (config) => {
        clearClientCache();
        saveSharedConnection(config);
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
        set((s) => ({
          s3Config: null,
          connectionId: s.connectionId + 1,
          section: 'browse',
          selectedCollectionKey: null,
          selectedUploadPrefix: null,
          taggerUser: '',
        }));
      },
      setSection: (section) => set({ section }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
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
    }),
    {
      name: 'sparcd-tagger-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
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
