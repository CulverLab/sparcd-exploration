import { create } from 'zustand';
import { clearSharedConnection, loadSessionConnection, saveSharedConnection } from '@sparcd/auth-ui';
import type { CollectionRef } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import {
  DEFAULT_PRECISION,
  NO_FILTERS,
  accountKey,
  buildModel,
  clearFilter,
  isFiltered,
  resetFilters,
  type FilterDimension,
  type FilterState,
  type LoadedCollection,
  type Model,
  type RegistryLocation,
  type Species,
} from '@/data';
import type { Display } from '@/lib/format';
import { readStored, writeStored } from '@/lib/storage';

export type View = 'locations' | 'species' | 'photos' | 'charts';
export type PhotoLayout = 'grid' | 'list';
export type Registries = { species: Species[][]; registry: RegistryLocation[] };

type Toast = { id: number; message: string; undo?: () => void };

/** Everything a reset or a data-check shortcut can change, so Undo can put it back. */
type Snapshot = { filters: FilterState; separate: boolean; view: View };

type State = {
  config: S3Config | null;
  account: string;
  screen: 'chooser' | 'workspace';
  /** Collection keys ticked in the chooser. */
  picks: string[];
  refs: CollectionRef[];
  loaded: LoadedCollection[];
  registries: Registries;
  model: Model | null;
  checking: boolean;
  checkedAt: number | null;
  checkError: string | null;
  filters: FilterState;
  /** "Show each location ID separately", in Data checks. */
  separate: boolean;
  view: View;
  photoLayout: PhotoLayout;
  display: Display;
  toast: Toast | null;

  signIn: (config: S3Config, remember: boolean) => void;
  adoptSession: (config: S3Config | null) => void;
  signOut: () => void;
  showChooser: () => void;
  setPicks: (picks: string[]) => void;
  enterWorkspace: (refs: CollectionRef[], loaded: LoadedCollection[], registries: Registries) => void;
  applyRefresh: (loaded: LoadedCollection[], registries: Registries) => void;
  setChecking: (checking: boolean, error?: string | null) => void;
  setFilters: (change: (f: FilterState) => FilterState) => void;
  clearFilter: (dim: FilterDimension) => void;
  /** Apply a change to filters and view state with an Undo toast. */
  withUndo: (message: string, change: (s: Snapshot) => Snapshot) => void;
  resetFilters: () => void;
  setSeparate: (separate: boolean) => void;
  setView: (view: View) => void;
  setPhotoLayout: (layout: PhotoLayout) => void;
  setDisplay: (display: Partial<Display>) => void;
  showToast: (message: string, undo?: () => void) => void;
  hideToast: () => void;
};

const DISPLAY_KEY = 'sparcd-explorer-display';
const VIEW_KEY = 'sparcd-explorer-view';
const VIEWS: View[] = ['locations', 'species', 'photos', 'charts'];

const DEFAULT_DISPLAY: Display = { coords: 'latlon', precision: DEFAULT_PRECISION, elevation: 'm' };
const isDisplay = (v: unknown): v is Display => {
  const d = v as Display;
  return (
    typeof d === 'object' &&
    d !== null &&
    (d.coords === 'latlon' || d.coords === 'utm') &&
    (d.elevation === 'm' || d.elevation === 'ft') &&
    (d.precision?.method === 'round' || d.precision?.method === 'truncate') &&
    (d.precision.digits === null || (Number.isInteger(d.precision.digits) && d.precision.digits >= 0 && d.precision.digits <= 5))
  );
};

/** The last combination opened by this account, for "Continue with …". */
export const lastKey = (account: string) => `sparcd-explorer-last:${account}`;
export const readLast = (account: string): string[] =>
  readStored<string[]>(lastKey(account), [], (v): v is string[] => Array.isArray(v) && v.every((k) => typeof k === 'string'));

const initial = loadSessionConnection();
let toastId = 0;

function model(loaded: LoadedCollection[], registries: Registries): Model {
  return buildModel(loaded, { species: registries.species, registry: registries.registry });
}

export const useStore = create<State>((set, get) => ({
  config: initial,
  account: initial ? accountKey(initial) : '',
  screen: 'chooser',
  picks: [],
  refs: [],
  loaded: [],
  registries: { species: [], registry: [] },
  model: null,
  checking: false,
  checkedAt: null,
  checkError: null,
  filters: NO_FILTERS,
  separate: false,
  view: readStored<View>(VIEW_KEY, 'locations', (v): v is View => VIEWS.includes(v as View)),
  // Grid arrives in a later phase; List is the working layout until then.
  photoLayout: 'list',
  display: readStored(DISPLAY_KEY, DEFAULT_DISPLAY, isDisplay),
  toast: null,

  signIn: (config, remember) => {
    saveSharedConnection(config, remember);
    get().adoptSession(config);
  },

  adoptSession: (config) => {
    const account = config ? accountKey(config) : '';
    if (config && account === get().account && get().config) {
      set({ config });
      return;
    }
    set({
      config,
      account,
      screen: 'chooser',
      picks: [],
      refs: [],
      loaded: [],
      model: null,
      filters: NO_FILTERS,
      toast: null,
    });
  },

  signOut: () => {
    clearSharedConnection();
    get().adoptSession(null);
  },

  showChooser: () => set({ screen: 'chooser', picks: get().refs.map((r) => r.key), toast: null }),
  setPicks: (picks) => set({ picks }),

  enterWorkspace: (refs, loaded, registries) => {
    writeStored(lastKey(get().account), refs.map((r) => r.key));
    set({
      screen: 'workspace',
      refs,
      loaded,
      registries,
      model: model(loaded, registries),
      checkedAt: Math.min(...loaded.map((c) => c.checkedAt)),
      checkError: null,
      filters: NO_FILTERS,
      separate: false,
      toast: null,
    });
  },

  applyRefresh: (loaded, registries) => {
    const changed =
      loaded.some((c) => c.changed) ||
      registries.species.flat().length !== get().registries.species.flat().length ||
      registries.registry.length !== get().registries.registry.length;
    set({
      loaded,
      registries,
      checkedAt: Date.now(),
      checkError: null,
      ...(changed ? { model: model(loaded, registries) } : {}),
    });
  },

  setChecking: (checking, error = null) => set({ checking, ...(error !== null ? { checkError: error } : {}) }),

  setFilters: (change) => set({ filters: change(get().filters) }),
  clearFilter: (dim) => set({ filters: clearFilter(get().filters, dim) }),

  withUndo: (message, change) => {
    const { filters, separate, view } = get();
    const before: Snapshot = { filters, separate, view };
    const after = change(before);
    get().setView(after.view);
    set({ filters: after.filters, separate: after.separate });
    get().showToast(message, () => {
      get().setView(before.view);
      set({ filters: before.filters, separate: before.separate });
      get().showToast('Filters restored');
    });
  },

  resetFilters: () => {
    if (!isFiltered(get().filters)) return;
    get().withUndo('Filters reset', (s) => ({ ...s, filters: resetFilters(s.filters).state }));
  },

  setSeparate: (separate) => set({ separate }),
  setView: (view) => {
    writeStored(VIEW_KEY, view);
    set({ view });
  },
  setPhotoLayout: (photoLayout) => set({ photoLayout }),
  setDisplay: (patch) => {
    const display = { ...get().display, ...patch };
    writeStored(DISPLAY_KEY, display);
    set({ display });
  },

  showToast: (message, undo) => set({ toast: { id: ++toastId, message, undo } }),
  hideToast: () => set({ toast: null }),
}));
